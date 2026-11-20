import { createHash } from 'node:crypto';
import { isUuidV4 } from '../domain/ids.js';
import { isTimestamp as isNoteTimestamp } from '../domain/note.js';
import { validateNotePath } from '../domain/paths.js';
import {
  assessFilesystemPublicationCapability,
  parseFilesystemPublicationCapabilityProbe,
  type FilesystemPublicationCapabilityProbe,
} from './fs/publication-capability.js';

declare const sourceNoteIdBrand: unique symbol;
declare const destinationNoteIdBrand: unique symbol;
declare const operationIdBrand: unique symbol;
declare const attemptIdBrand: unique symbol;
declare const vaultIdBrand: unique symbol;
declare const notePathBrand: unique symbol;
declare const collisionKeyBrand: unique symbol;
declare const sha256Brand: unique symbol;

export type CopySourceNoteId = string & { readonly [sourceNoteIdBrand]: true };
export type CopyDestinationNoteId = string & { readonly [destinationNoteIdBrand]: true };
export type CopyJournalOperationId = string & { readonly [operationIdBrand]: true };
export type CopyPublicationAttemptId = string & { readonly [attemptIdBrand]: true };
export type CopyPublicationVaultId = string & { readonly [vaultIdBrand]: true };
export type CopyPublicationNotePath = string & { readonly [notePathBrand]: true };
export type CopyPublicationCollisionKey = string & { readonly [collisionKeyBrand]: true };
export type CopyPublicationSha256 = string & { readonly [sha256Brand]: true };

export interface CopyPublicationIdentity {
  readonly format: 'nodus-copy-publication-identity';
  readonly version: 1;
  /** The journal operation that owns the publication attempt. */
  readonly ownerJournalOperationId: CopyJournalOperationId;
  /** Must be the operation whose v1 Prepared plan is being extended. */
  readonly preparedOperationId: CopyJournalOperationId;
  /** Binds the identity to the exact immutable v1 Prepared event bytes. */
  readonly preparedEventSha256: CopyPublicationSha256;
  /** Distinguishes one future attempt from another attempt for the same plan. */
  readonly attemptId: CopyPublicationAttemptId;
  readonly vault: {
    readonly instanceId: CopyPublicationVaultId;
    readonly lineageId: CopyPublicationVaultId;
  };
  readonly source: {
    readonly noteId: CopySourceNoteId;
    readonly path: CopyPublicationNotePath;
    readonly rawSha256: CopyPublicationSha256;
  };
  readonly destination: {
    readonly noteId: CopyDestinationNoteId;
    readonly path: CopyPublicationNotePath;
    readonly collisionKey: CopyPublicationCollisionKey;
    readonly contentSha256: CopyPublicationSha256;
    readonly contentBytes: number;
  };
}

export type IdentityValidation =
  | { readonly kind: 'valid'; readonly identity: CopyPublicationIdentity }
  | { readonly kind: 'invalid'; readonly reason: string };

/** Parse untrusted input into a fully bound, immutable publication identity. */
export function validateCopyPublicationIdentity(input: unknown): IdentityValidation {
  try {
    return parseCopyPublicationIdentity(input);
  } catch {
    return { kind: 'invalid', reason: 'Identity input could not be read safely.' };
  }
}

export interface PreparedCopyIdentityBinding {
  readonly operationId: string;
  readonly preparedEventSha256: string;
  readonly vaultInstanceId: string;
  readonly vaultLineageId: string;
  readonly source: { readonly id: string; readonly path: string; readonly rawSha256: string };
  readonly destination: { readonly path: string; readonly collisionKey: string };
  readonly copy: { readonly id: string; readonly serializedSha256: string; readonly serializedBytes: number };
}

/** Compare an identity to fields from an already validated v1 Prepared plan. */
export function matchesPreparedCopyIdentity(
  identity: CopyPublicationIdentity,
  prepared: PreparedCopyIdentityBinding,
): boolean {
  return identity.ownerJournalOperationId === prepared.operationId
    && identity.preparedOperationId === prepared.operationId
    && identity.preparedEventSha256 === prepared.preparedEventSha256
    && identity.vault.instanceId === prepared.vaultInstanceId
    && identity.vault.lineageId === prepared.vaultLineageId
    && identity.source.noteId === prepared.source.id
    && identity.source.path === prepared.source.path
    && identity.source.rawSha256 === prepared.source.rawSha256
    && identity.destination.path === prepared.destination.path
    && identity.destination.collisionKey === prepared.destination.collisionKey
    && identity.destination.noteId === prepared.copy.id
    && identity.destination.contentSha256 === prepared.copy.serializedSha256
    && identity.destination.contentBytes === prepared.copy.serializedBytes;
}

export interface PublicationFilesystemObjectIdentity {
  readonly deviceId: string;
  readonly fileId: string;
}

export type PublicationSourceObservation =
  | { readonly state: 'unchanged'; readonly observedSha256: CopyPublicationSha256 }
  | { readonly state: 'changed'; readonly observedSha256: CopyPublicationSha256 }
  | { readonly state: 'unknown' };

export type PublicationDestinationObservation =
  | { readonly state: 'absent' }
  | {
    readonly state: 'matches-expected';
    readonly noteId: CopyDestinationNoteId;
    readonly contentSha256: CopyPublicationSha256;
    readonly objectIdentity: PublicationFilesystemObjectIdentity;
  }
  | {
    readonly state: 'conflicting';
    readonly observedNoteId?: string;
    readonly observedSha256?: string;
  }
  | { readonly state: 'unknown' };

export interface CopyPublicationReceiptEvidence {
  readonly kind: 'exclusive-no-replace-receipt';
  readonly ownerJournalOperationId: CopyJournalOperationId;
  readonly attemptId: CopyPublicationAttemptId;
  readonly destinationNoteId: CopyDestinationNoteId;
  readonly destinationPath: CopyPublicationNotePath;
  readonly contentSha256: CopyPublicationSha256;
  readonly objectIdentity: PublicationFilesystemObjectIdentity;
  readonly receiptSha256: CopyPublicationSha256;
}

export interface CopyPublicationReceiptDigestInput {
  readonly kind: 'exclusive-no-replace-receipt';
  readonly ownerJournalOperationId: string;
  readonly attemptId: string;
  readonly destinationNoteId: string;
  readonly destinationPath: string;
  readonly contentSha256: string;
  readonly objectIdentity: PublicationFilesystemObjectIdentity;
}

export interface CopyPublicationEvidenceDocument {
  readonly format: 'nodus-copy-publication-evidence';
  readonly version: 1;
  readonly identity: CopyPublicationIdentity;
  readonly provenance: {
    readonly observerId: string;
    readonly observedAt: string;
    readonly capability: FilesystemPublicationCapabilityProbe;
  };
  readonly attempt: {
    readonly state: 'not-started' | 'started' | 'unknown';
    readonly preparedEventSha256: CopyPublicationSha256;
  };
  readonly source: PublicationSourceObservation;
  readonly destination: PublicationDestinationObservation;
  readonly receipt: CopyPublicationReceiptEvidence | null;
}

export type PublicationEvidenceClassification =
  | { readonly classification: 'definitely-not-published'; readonly identity: CopyPublicationIdentity }
  | { readonly classification: 'definitely-published'; readonly identity: CopyPublicationIdentity; readonly objectIdentity: PublicationFilesystemObjectIdentity }
  | { readonly classification: 'ambiguous'; readonly reason: string; readonly identity?: CopyPublicationIdentity }
  | { readonly classification: 'invalid'; readonly reason: string };

/**
 * Validates identity, provenance and cross-field consistency. The current
 * empty qualification allowlist intentionally makes every non-contradictory
 * filesystem outcome ambiguous, even when the supplied facts look complete.
 * A later qualified adapter must also independently establish provenance and
 * freshness before this parser's observations can resolve an operation.
 */
export function assessCopyPublicationEvidence(
  input: unknown,
  expectedIdentity: unknown,
): PublicationEvidenceClassification {
  const expected = validateCopyPublicationIdentity(expectedIdentity);
  if (expected.kind !== 'valid') return { classification: 'invalid', reason: 'Expected publication identity is invalid.' };
  try {
    return assessEvidence(input, expected.identity);
  } catch {
    return { classification: 'invalid', reason: 'Publication evidence could not be read safely.' };
  }
}

function parseCopyPublicationIdentity(input: unknown): IdentityValidation {
  if (!isRecord(input) || !hasExactlyKeys(input, [
    'format', 'version', 'ownerJournalOperationId', 'preparedOperationId', 'preparedEventSha256', 'attemptId', 'vault', 'source', 'destination',
  ])) return { kind: 'invalid', reason: 'Publication identity has an invalid shape.' };
  if (input.format !== 'nodus-copy-publication-identity' || input.version !== 1) {
    return { kind: 'invalid', reason: 'Publication identity format or version is unsupported.' };
  }
  if (!isOperationId(input.ownerJournalOperationId) || !isOperationId(input.preparedOperationId)
    || !isSha256(input.preparedEventSha256) || !isAttemptId(input.attemptId)
    || !sameText(input.ownerJournalOperationId, input.preparedOperationId)
    || sameText(input.attemptId, input.ownerJournalOperationId)) {
    return { kind: 'invalid', reason: 'Publication owner, prepared operation, or attempt identity is invalid or inconsistent.' };
  }
  if (!isRecord(input.vault) || !hasExactlyKeys(input.vault, ['instanceId', 'lineageId'])
    || !isVaultId(input.vault.instanceId) || !isVaultId(input.vault.lineageId)) {
    return { kind: 'invalid', reason: 'Publication vault identity is invalid.' };
  }
  if (!isRecord(input.source) || !hasExactlyKeys(input.source, ['noteId', 'path', 'rawSha256'])
    || !isSourceNoteId(input.source.noteId) || !isNotePath(input.source.path) || !isSha256(input.source.rawSha256)) {
    return { kind: 'invalid', reason: 'Publication source identity is invalid.' };
  }
  if (!isRecord(input.destination) || !hasExactlyKeys(input.destination, [
    'noteId', 'path', 'collisionKey', 'contentSha256', 'contentBytes',
  ]) || !isDestinationNoteId(input.destination.noteId) || !isNotePath(input.destination.path)
    || !isCollisionKey(input.destination.collisionKey) || !isSha256(input.destination.contentSha256)
    || typeof input.destination.contentBytes !== 'number' || !Number.isSafeInteger(input.destination.contentBytes)
    || input.destination.contentBytes < 0 || input.destination.contentBytes > 32 * 1024 * 1024) {
    return { kind: 'invalid', reason: 'Publication destination identity is invalid.' };
  }
  const sourcePath = input.source.path;
  const destinationPath = input.destination.path;
  if (input.destination.collisionKey !== foldPath(destinationPath)
    || sameText(input.source.noteId, input.destination.noteId)
    || foldPath(sourcePath) === foldPath(destinationPath)) {
    return { kind: 'invalid', reason: 'Publication source and destination identities conflict.' };
  }
  const identity: CopyPublicationIdentity = Object.freeze({
    format: 'nodus-copy-publication-identity', version: 1,
    ownerJournalOperationId: input.ownerJournalOperationId,
    preparedOperationId: input.preparedOperationId,
    preparedEventSha256: input.preparedEventSha256,
    attemptId: input.attemptId,
    vault: Object.freeze({ instanceId: input.vault.instanceId, lineageId: input.vault.lineageId }),
    source: Object.freeze({ noteId: input.source.noteId, path: sourcePath, rawSha256: input.source.rawSha256 }),
    destination: Object.freeze({
      noteId: input.destination.noteId, path: destinationPath,
      collisionKey: input.destination.collisionKey, contentSha256: input.destination.contentSha256,
      contentBytes: input.destination.contentBytes,
    }),
  });
  return { kind: 'valid', identity };
}

function assessEvidence(input: unknown, expected: CopyPublicationIdentity): PublicationEvidenceClassification {
  if (!isRecord(input) || input.format !== 'nodus-copy-publication-evidence' || input.version !== 1) {
    return { classification: 'invalid', reason: 'Publication evidence format or version is invalid.' };
  }
  if (!hasOnlyKeys(input, ['format', 'version', 'identity', 'provenance', 'attempt', 'source', 'destination', 'receipt'])) {
    return { classification: 'invalid', reason: 'Publication evidence contains unknown fields.' };
  }
  const parsedIdentity = validateCopyPublicationIdentity(input.identity);
  if (parsedIdentity.kind !== 'valid') return { classification: 'invalid', reason: 'Publication evidence identity is invalid.' };
  const identity = parsedIdentity.identity;
  if (!samePublicationIdentity(identity, expected)) {
    return { classification: 'invalid', reason: 'Publication evidence belongs to a different operation, attempt, source, destination, or vault.' };
  }

  const missing = ['provenance', 'attempt', 'source', 'destination', 'receipt'].find((key) => !Object.hasOwn(input, key));
  if (missing !== undefined) return { classification: 'ambiguous', reason: `Publication evidence is missing ${missing}.`, identity };

  const provenance = parseProvenance(input.provenance);
  const attempt = parseAttempt(input.attempt);
  const source = parseSourceObservation(input.source, identity);
  const destination = parseDestinationObservation(input.destination, identity);
  const receipt = parseReceipt(input.receipt);
  for (const result of [provenance, attempt, source, destination, receipt]) {
    if (result.kind === 'invalid') return { classification: 'invalid', reason: result.reason };
  }
  if (provenance.kind !== 'valid' || attempt.kind !== 'valid' || source.kind !== 'valid'
    || destination.kind !== 'valid' || receipt.kind !== 'valid') {
    return { classification: 'ambiguous', reason: 'Publication evidence is incomplete.', identity };
  }

  const receiptValue = receipt.value;
  if (attempt.value.preparedEventSha256 !== identity.preparedEventSha256) {
    return { classification: 'invalid', reason: 'Evidence is bound to different Prepared journal event bytes.' };
  }
  if (receiptValue !== null) {
    if (receiptValue.ownerJournalOperationId !== identity.ownerJournalOperationId
      || receiptValue.attemptId !== identity.attemptId
      || receiptValue.destinationNoteId !== identity.destination.noteId
      || receiptValue.destinationPath !== identity.destination.path
      || receiptValue.contentSha256 !== identity.destination.contentSha256) {
      return { classification: 'invalid', reason: 'Publication receipt identity does not match the prepared operation.' };
    }
    if (attempt.value.state !== 'started' || destination.value.state === 'absent') {
      return { classification: 'invalid', reason: 'Publication receipt contradicts attempt or destination observations.' };
    }
    if (destination.value.state === 'matches-expected'
      && (!sameObjectIdentity(receiptValue.objectIdentity, destination.value.objectIdentity)
        || receiptValue.destinationNoteId !== destination.value.noteId
        || receiptValue.contentSha256 !== destination.value.contentSha256)) {
      return { classification: 'invalid', reason: 'Publication receipt contradicts the observed destination identity.' };
    }
  }
  if (source.value.state === 'unchanged' && source.value.observedSha256 !== identity.source.rawSha256) {
    return { classification: 'invalid', reason: 'Unchanged source evidence does not match the prepared source digest.' };
  }
  if (source.value.state === 'changed' && source.value.observedSha256 === identity.source.rawSha256) {
    return { classification: 'invalid', reason: 'Changed source evidence repeats the prepared source digest.' };
  }
  if (destination.value.state === 'matches-expected'
    && (destination.value.noteId !== identity.destination.noteId
      || destination.value.contentSha256 !== identity.destination.contentSha256)) {
    return { classification: 'invalid', reason: 'Destination observation does not match the expected publication identity.' };
  }

  const capability = assessFilesystemPublicationCapability(provenance.value.capability);
  if (capability.status !== 'supported') {
    return { classification: 'ambiguous', reason: `Publication evidence has no qualified filesystem provenance (${capability.status}).`, identity };
  }
  // API support and a future qualification entry still do not authenticate
  // serialized observations. M6.1 has no trusted fresh-read verifier, so it
  // cannot resolve a publication outcome from caller-supplied evidence.
  return { classification: 'ambiguous', reason: 'No trusted fresh-evidence verifier is implemented.', identity };
}

type ParseResult<T> = { readonly kind: 'valid'; readonly value: T } | { readonly kind: 'invalid'; readonly reason: string };

function parseProvenance(input: unknown): ParseResult<CopyPublicationEvidenceDocument['provenance']> {
  if (!isRecord(input) || !hasExactlyKeys(input, ['observerId', 'observedAt', 'capability'])
    || typeof input.observerId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(input.observerId)
    || typeof input.observedAt !== 'string' || !isNoteTimestamp(input.observedAt)) return invalid('Publication evidence provenance is malformed.');
  const capability = parseFilesystemPublicationCapabilityProbe(input.capability);
  if (capability === undefined) return invalid('Publication evidence capability provenance is malformed.');
  return valid({ observerId: input.observerId, observedAt: input.observedAt, capability });
}

function parseAttempt(input: unknown): ParseResult<CopyPublicationEvidenceDocument['attempt']> {
  if (!isRecord(input) || !hasExactlyKeys(input, ['state', 'preparedEventSha256'])
    || (input.state !== 'not-started' && input.state !== 'started' && input.state !== 'unknown')
    || !isSha256(input.preparedEventSha256)) return invalid('Publication attempt evidence is malformed.');
  return valid({ state: input.state, preparedEventSha256: input.preparedEventSha256 });
}

function parseSourceObservation(input: unknown, identity: CopyPublicationIdentity): ParseResult<PublicationSourceObservation> {
  if (!isRecord(input) || typeof input.state !== 'string') return invalid('Publication source observation is malformed.');
  if (input.state === 'unknown' && hasExactlyKeys(input, ['state'])) return valid({ state: 'unknown' });
  if ((input.state === 'unchanged' || input.state === 'changed')
    && hasExactlyKeys(input, ['state', 'observedSha256']) && isSha256(input.observedSha256)) {
    if (input.state === 'unchanged' && input.observedSha256 !== identity.source.rawSha256) {
      return invalid('Unchanged source observation contradicts the expected source digest.');
    }
    if (input.state === 'changed' && input.observedSha256 === identity.source.rawSha256) {
      return invalid('Changed source observation contradicts the expected source digest.');
    }
    return valid({ state: input.state, observedSha256: input.observedSha256 });
  }
  return invalid('Publication source observation is malformed.');
}

function parseDestinationObservation(input: unknown, identity: CopyPublicationIdentity): ParseResult<PublicationDestinationObservation> {
  if (!isRecord(input) || typeof input.state !== 'string') return invalid('Publication destination observation is malformed.');
  if (input.state === 'absent' && hasExactlyKeys(input, ['state'])) return valid({ state: 'absent' });
  if (input.state === 'unknown' && hasExactlyKeys(input, ['state'])) return valid({ state: 'unknown' });
  if (input.state === 'matches-expected' && hasExactlyKeys(input, ['state', 'noteId', 'contentSha256', 'objectIdentity'])
    && isDestinationNoteId(input.noteId) && isSha256(input.contentSha256)) {
    const objectIdentity = parseObjectIdentity(input.objectIdentity);
    if (objectIdentity.kind === 'invalid') return objectIdentity;
    if (input.noteId !== identity.destination.noteId || input.contentSha256 !== identity.destination.contentSha256) {
      return invalid('Destination observation contradicts the expected note identity or content digest.');
    }
    return valid({ state: 'matches-expected', noteId: input.noteId, contentSha256: input.contentSha256, objectIdentity: objectIdentity.value });
  }
  if (input.state === 'conflicting' && (hasExactlyKeys(input, ['state'])
    || hasExactlyKeys(input, ['state', 'observedNoteId'])
    || hasExactlyKeys(input, ['state', 'observedSha256'])
    || hasExactlyKeys(input, ['state', 'observedNoteId', 'observedSha256']))) {
    if (Object.hasOwn(input, 'observedNoteId')
      && (typeof input.observedNoteId !== 'string' || !isUuidV4(input.observedNoteId))) return invalid('Conflicting destination note identity is malformed.');
    if (Object.hasOwn(input, 'observedSha256') && !isSha256(input.observedSha256)) return invalid('Conflicting destination digest is malformed.');
    return valid({
      state: 'conflicting',
      ...(typeof input.observedNoteId === 'string' ? { observedNoteId: input.observedNoteId } : {}),
      ...(typeof input.observedSha256 === 'string' ? { observedSha256: input.observedSha256 } : {}),
    });
  }
  return invalid('Publication destination observation is malformed.');
}

function parseReceipt(input: unknown): ParseResult<CopyPublicationReceiptEvidence | null> {
  if (input === null) return valid(null);
  if (!isRecord(input) || !hasExactlyKeys(input, [
    'kind', 'ownerJournalOperationId', 'attemptId', 'destinationNoteId', 'destinationPath',
    'contentSha256', 'objectIdentity', 'receiptSha256',
  ]) || input.kind !== 'exclusive-no-replace-receipt'
    || !isOperationId(input.ownerJournalOperationId) || !isAttemptId(input.attemptId)
    || !isDestinationNoteId(input.destinationNoteId) || !isNotePath(input.destinationPath)
    || !isSha256(input.contentSha256) || !isSha256(input.receiptSha256)) {
    return invalid('Publication receipt evidence is malformed.');
  }
  const objectIdentity = parseObjectIdentity(input.objectIdentity);
  if (objectIdentity.kind === 'invalid') return objectIdentity;
  const receipt: CopyPublicationReceiptEvidence = {
    kind: 'exclusive-no-replace-receipt', ownerJournalOperationId: input.ownerJournalOperationId,
    attemptId: input.attemptId, destinationNoteId: input.destinationNoteId, destinationPath: input.destinationPath,
    contentSha256: input.contentSha256, objectIdentity: objectIdentity.value, receiptSha256: input.receiptSha256,
  };
  if (copyPublicationReceiptDigest(receipt) !== receipt.receiptSha256) {
    return invalid('Publication receipt digest does not match its canonical fields.');
  }
  return valid(receipt);
}

/** Canonical unkeyed digest for corruption detection; it is not a signature. */
export function copyPublicationReceiptDigest(receipt: CopyPublicationReceiptDigestInput): string {
  const body = {
    kind: receipt.kind,
    ownerJournalOperationId: receipt.ownerJournalOperationId,
    attemptId: receipt.attemptId,
    destinationNoteId: receipt.destinationNoteId,
    destinationPath: receipt.destinationPath,
    contentSha256: receipt.contentSha256,
    objectIdentity: { deviceId: receipt.objectIdentity.deviceId, fileId: receipt.objectIdentity.fileId },
  };
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

function parseObjectIdentity(input: unknown): ParseResult<PublicationFilesystemObjectIdentity> {
  if (!isRecord(input) || !hasExactlyKeys(input, ['deviceId', 'fileId'])
    || !isOpaqueIdentity(input.deviceId) || !isOpaqueIdentity(input.fileId)) {
    return invalid('Filesystem object identity is malformed.');
  }
  return valid({ deviceId: input.deviceId, fileId: input.fileId });
}

function samePublicationIdentity(left: CopyPublicationIdentity, right: CopyPublicationIdentity): boolean {
  return left.ownerJournalOperationId === right.ownerJournalOperationId
    && left.preparedOperationId === right.preparedOperationId
    && left.preparedEventSha256 === right.preparedEventSha256
    && left.attemptId === right.attemptId
    && left.vault.instanceId === right.vault.instanceId
    && left.vault.lineageId === right.vault.lineageId
    && left.source.noteId === right.source.noteId
    && left.source.path === right.source.path
    && left.source.rawSha256 === right.source.rawSha256
    && left.destination.noteId === right.destination.noteId
    && left.destination.path === right.destination.path
    && left.destination.collisionKey === right.destination.collisionKey
    && left.destination.contentSha256 === right.destination.contentSha256
    && left.destination.contentBytes === right.destination.contentBytes;
}

function sameText(left: string, right: string): boolean {
  return left === right;
}

function sameObjectIdentity(left: PublicationFilesystemObjectIdentity, right: PublicationFilesystemObjectIdentity): boolean {
  return left.deviceId === right.deviceId && left.fileId === right.fileId;
}

function hasExactlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).every((key) => expected.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isOperationId(value: unknown): value is CopyJournalOperationId {
  return typeof value === 'string' && isUuidV4(value);
}

function isAttemptId(value: unknown): value is CopyPublicationAttemptId {
  return typeof value === 'string' && isUuidV4(value);
}

function isVaultId(value: unknown): value is CopyPublicationVaultId {
  return typeof value === 'string' && isUuidV4(value);
}

function isSourceNoteId(value: unknown): value is CopySourceNoteId {
  return typeof value === 'string' && isUuidV4(value);
}

function isDestinationNoteId(value: unknown): value is CopyDestinationNoteId {
  return typeof value === 'string' && isUuidV4(value);
}

function isNotePath(value: unknown): value is CopyPublicationNotePath {
  if (typeof value !== 'string') return false;
  try { return validateNotePath(value) === value; } catch { return false; }
}

function isCollisionKey(value: unknown): value is CopyPublicationCollisionKey {
  return typeof value === 'string' && value.length > 0 && value.length <= 260 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSha256(value: unknown): value is CopyPublicationSha256 {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isOpaqueIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function foldPath(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

function valid<T>(value: T): ParseResult<T> {
  return { kind: 'valid', value };
}

function invalid(reason: string): ParseResult<never> {
  return { kind: 'invalid', reason };
}
