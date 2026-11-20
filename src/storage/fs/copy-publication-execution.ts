import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { chmod, link, lstat, mkdir, open, readdir, rmdir, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { StorageError } from '../errors.js';
import { CopyOperationJournal } from './copy-operation-journal.js';
import {
  assessFilesystemPublicationCapability,
  type FilesystemPublicationCapabilityProbe,
  type PublicationCapabilityAssessment,
} from './publication-capability.js';
import { withVaultRootLock } from './root-lock.js';
import { createCopyPublicationIdentity, type CopyPublicationIdentity } from '../copy-publication.js';
import { resolveInsideRoot } from './safe-path.js';

/**
 * Phase 19 M6.2 — bounded, capability-gated no-replace copy publication.
 *
 * This module is the only place that can create a destination note for a
 * prepared copy. It is intentionally not exported from any package barrel and
 * no vault method invokes it yet: M6.2 delivers the execution machinery, while
 * enabling it on a filesystem remains M6.4 (native qualification + allowlist)
 * and resolving a published operation requires M6.3 (recovery/attestation).
 *
 * Safety properties:
 * - production capability assessment runs against the frozen, empty allowlist
 *   with an explicit "no runtime probe" input, so every production call is
 *   refused before any filesystem mutation;
 * - the identity is re-derived from the durable journal record, never from a
 *   caller-supplied identity;
 * - destination publication uses an exclusive hard link, so an existing path
 *   can never be replaced;
 * - live vault state (parent chain, existing destination, case/NFC sibling
 *   collisions) is re-checked under the vault root lock;
 * - staged bytes are written under a private hidden directory and verified by
 *   inode and content digest before they are published;
 * - a durable receipt is written after publication; staging and receipt
 *   evidence is inspectable and any leftover blocks transfer admission.
 */

export const COPY_PUBLICATION_STAGING_DIR = '.nodus-copy-staging';
export const COPY_PUBLICATION_RECEIPT_DIR = '.nodus-copy-publication';

const RECORD_BYTES_MAX = 8 * 1024;
const STAGE_BYTES_MAX = 32 * 1024 * 1024;
const PRIVATE_FILE_MODE = 0o600;
const PUBLISHED_FILE_MODE = 0o644;
const STAGING_OPERATIONS_MAX = 64;
const STAGING_ATTEMPTS_PER_OPERATION_MAX = 4;
const RECEIPT_OPERATIONS_MAX = 256;
const RECEIPTS_PER_OPERATION_MAX = 8;
const MAX_ISSUES = 32;

export interface CopyPublicationStagingDescriptor {
  readonly format: 'nodus-copy-publication-staging';
  readonly version: 1;
  readonly operationId: string;
  readonly attemptId: string;
  readonly preparedEventSha256: string;
  readonly destinationPath: string;
  readonly destinationNoteId: string;
  readonly contentSha256: string;
  readonly contentBytes: number;
  readonly recordedAt: string;
  readonly descriptorSha256: string;
}

export interface CopyPublicationReceipt {
  readonly format: 'nodus-copy-publication-receipt';
  readonly version: 1;
  readonly operationId: string;
  readonly attemptId: string;
  readonly preparedEventSha256: string;
  readonly destination: {
    readonly path: string;
    readonly noteId: string;
    readonly contentSha256: string;
    readonly contentBytes: number;
  };
  /** Opaque observed device/file identity, ≤64 characters (the stricter v1 domain). */
  readonly objectIdentity: { readonly deviceId: string; readonly fileId: string };
  readonly publishedAt: string;
  readonly receiptDigestSha256: string;
}

export interface CopyPublicationRequest {
  readonly operationId: string;
  readonly attemptId: string;
  /** Serialized note bytes exactly as approved by the immutable Prepared plan. */
  readonly serializedBytes: Uint8Array;
}

/**
 * Test seam only. Production callers must pass no dependencies: the default
 * path uses the frozen allowlist and an explicit unavailable runtime probe, so
 * publication cannot be enabled by importing anything.
 */
export interface CopyPublicationExecutionDependencies {
  readonly assessCapability?: (probe: FilesystemPublicationCapabilityProbe) => PublicationCapabilityAssessment;
  readonly probe?: FilesystemPublicationCapabilityProbe;
}

export type CopyPublicationExecution =
  | { readonly kind: 'already-published'; readonly receipt: CopyPublicationReceipt }
  | {
    readonly kind: 'published';
    readonly operationId: string;
    readonly attemptId: string;
    readonly destinationPath: string;
    readonly contentSha256: string;
    readonly objectIdentity: CopyPublicationReceipt['objectIdentity'];
    readonly receiptSha256: string;
  };

export interface CopyPublicationEvidenceReport {
  readonly unresolved: readonly string[];
  readonly receipts: readonly string[];
  readonly issuesTruncated: boolean;
}

const DEFAULT_PRODUCTION_PROBE: FilesystemPublicationCapabilityProbe = Object.freeze({
  requested: true,
  platform: process.platform,
  filesystem: null,
  primitiveSupport: 'unknown',
});

/**
 * Publishes one prepared copy. Must not be called while already holding the
 * vault root lock; this function acquires it for the whole operation.
 */
export async function executeCopyPublication(
  root: string,
  request: CopyPublicationRequest,
  dependencies: CopyPublicationExecutionDependencies = {},
): Promise<CopyPublicationExecution> {
  // 1. Capability gate before any path work or filesystem mutation.
  const probe = dependencies.probe ?? DEFAULT_PRODUCTION_PROBE;
  const assessment = (dependencies.assessCapability ?? assessFilesystemPublicationCapability)(probe);
  if (assessment.status !== 'supported') throw publicationRefused(assessment);

  return withVaultRootLock(root, () => executeCopyPublicationUnlocked(root, request));
}

async function executeCopyPublicationUnlocked(
  root: string,
  request: CopyPublicationRequest,
): Promise<CopyPublicationExecution> {
  // 2. Bind to durable journal evidence; never to caller-supplied identity data.
  if (typeof request?.operationId !== 'string' || typeof request?.attemptId !== 'string') {
    throw new StorageError('INVALID_INPUT', 'Copy publication requires an operation ID and an attempt ID.');
  }
  const journal = new CopyOperationJournal(root);
  const prepared = await journal.readPreparedEvent(request.operationId);
  if (prepared.kind !== 'valid') {
    throw new StorageError(prepared.code, `Copy publication cannot bind to durable journal evidence: ${prepared.reason}`, {
      path: request.operationId,
    });
  }
  const identity = createCopyPublicationIdentity({ preparedEvent: prepared.record, attemptId: request.attemptId });
  if (identity.kind !== 'valid') {
    throw new StorageError('INVALID_INPUT', `Copy publication identity is invalid: ${identity.reason}`);
  }
  const bound = identity.identity;

  // 3. Bytes must be exactly the approved serialized copy.
  const bytes = Buffer.isBuffer(request.serializedBytes) ? request.serializedBytes : Buffer.from(request.serializedBytes ?? []);
  if (bytes.byteLength > STAGE_BYTES_MAX) {
    throw new StorageError('INVALID_CONTENT', 'Copy publication bytes exceed the 32 MiB serialized-copy limit.');
  }
  const contentSha256 = sha256Hex(bytes);
  if (contentSha256 !== bound.destination.contentSha256 || bytes.byteLength !== bound.destination.contentBytes) {
    throw new StorageError('INVALID_CONTENT', 'Copy publication bytes do not match the immutable Prepared plan.');
  }

  // 4. Idempotency and receipt integrity, before touching staging or destination.
  const receiptPath = join(root, COPY_PUBLICATION_RECEIPT_DIR, bound.ownerJournalOperationId, `${bound.attemptId}.json`);
  const existing = await readReceipt(receiptPath, bound);
  if (existing.kind === 'valid') {
    try {
      const destination = await resolveLiveDestination(root, bound.destination.path);
      await verifyPublishedDestination(destination, existing.receipt);
    } catch (error) {
      throw new StorageError('PARTIAL_WRITE', 'The live destination does not verify against its copy publication receipt. Preserve both for manual review.', {
        cause: error,
        path: bound.destination.path,
        details: { paths: [bound.destination.path, `${COPY_PUBLICATION_RECEIPT_DIR}/${bound.ownerJournalOperationId}/${bound.attemptId}.json`] },
      });
    }
    return { kind: 'already-published', receipt: existing.receipt };
  }
  if (existing.kind === 'invalid') {
    throw new StorageError('PARTIAL_WRITE', `Existing copy publication receipt is unusable: ${existing.reason}. Preserve it for manual review.`, {
      path: `${COPY_PUBLICATION_RECEIPT_DIR}/${bound.ownerJournalOperationId}/${bound.attemptId}.json`,
    });
  }

  // 5. Live destination authorization under the root lock.
  const destinationAbsolute = await authorizeLiveDestination(root, bound.destination.path);

  // 6. Stage private bytes and the ownership descriptor beside the journal,
  //    never inside the operation directory (the accepted temporary-artifact
  //    contract recognizes only its own cancellation sibling there).
  const stagingRoot = join(root, COPY_PUBLICATION_STAGING_DIR);
  const stagingDirectory = join(stagingRoot, bound.ownerJournalOperationId);
  await ensurePrivateDirectory(stagingRoot, root);
  await ensurePrivateDirectory(stagingDirectory, stagingRoot);
  const stagePath = join(stagingDirectory, `${bound.attemptId}.stage`);
  const descriptorPath = join(stagingDirectory, `${bound.attemptId}.json`);
  const recordedAt = new Date().toISOString();
  const descriptor = makeStagingDescriptor(bound, contentSha256, bytes.byteLength, recordedAt);
  await writePrivateFile(descriptorPath, encodeJson(descriptor), stagingDirectory);
  const staged = await writePrivateFile(stagePath, bytes, stagingDirectory);

  // 7. Publish by exclusive hard link: `link` refuses to replace an existing
  //    path, so a racing writer can never be overwritten.
  try {
    await link(stagePath, destinationAbsolute);
  } catch (error) {
    await removeOwnStaging(descriptorPath, stagePath, stagingDirectory);
    if (isAlreadyExists(error)) {
      throw new StorageError('CONFLICT', 'Copy publication destination appeared after authorization; nothing was replaced.', {
        path: bound.destination.path,
      });
    }
    throw new StorageError('STORAGE_FAILURE', 'Copy publication link failed; staged bytes were removed and no destination was written.', {
      path: bound.destination.path,
      cause: error,
    });
  }

  // 8. Verify the published inode is the staged inode, normalize the note mode,
  //    then make the destination entry durable before dropping staging evidence.
  const publishedInfo = await lstatOrNull(destinationAbsolute);
  if (publishedInfo === null || publishedInfo.isSymbolicLink() || !publishedInfo.isFile()
    || publishedInfo.dev !== staged.device || publishedInfo.ino !== staged.inode || publishedInfo.size !== bytes.byteLength
    || staged.size !== bytes.byteLength) {
    throw new StorageError('PARTIAL_WRITE', 'Published copy could not be verified against the staged inode. Preserve the destination and staging evidence.', {
      path: bound.destination.path,
      details: { paths: [bound.destination.path, `${COPY_PUBLICATION_STAGING_DIR}/${bound.ownerJournalOperationId}`] },
    });
  }
  await chmod(destinationAbsolute, PUBLISHED_FILE_MODE);
  await syncDirectory(dirname(destinationAbsolute));

  // The descriptor intentionally survives until the receipt is durable: a crash
  // between removing the staged bytes and recording the receipt then still leaves
  // owned publication evidence that blocks admission for manual review.
  await unlink(stagePath);
  await syncDirectory(stagingDirectory);

  // 9. Record durable receipt evidence. A failure here leaves an unrecorded but
  //    verified destination with its descriptor intact: fail closed, no rollback.
  const receipt = makeReceipt(bound, {
    deviceId: String(publishedInfo.dev), fileId: String(publishedInfo.ino),
    publishedAt: new Date().toISOString(), contentSha256, contentBytes: bytes.byteLength,
  });
  try {
    await ensurePrivateDirectory(join(root, COPY_PUBLICATION_RECEIPT_DIR), root);
    await ensurePrivateDirectory(join(root, COPY_PUBLICATION_RECEIPT_DIR, bound.ownerJournalOperationId), join(root, COPY_PUBLICATION_RECEIPT_DIR));
    await writePrivateFile(receiptPath, encodeJson(receipt), dirname(receiptPath));
  } catch (error) {
    throw new StorageError('PARTIAL_WRITE', `The copy was published but its receipt could not be recorded: ${describe(error)}. Preserve the destination and review the journal.`, {
      cause: error,
      path: bound.destination.path,
      details: { paths: [bound.destination.path, receiptPath] },
    });
  }

  await unlink(descriptorPath);
  await syncDirectory(stagingDirectory);
  await rmdir(stagingDirectory).catch(() => undefined);
  await syncDirectory(stagingRoot).catch(() => undefined);

  return {
    kind: 'published',
    operationId: bound.ownerJournalOperationId,
    attemptId: bound.attemptId,
    destinationPath: bound.destination.path,
    contentSha256,
    objectIdentity: receipt.objectIdentity,
    receiptSha256: receipt.receiptDigestSha256,
  };
}

/**
 * Inspects staging and receipt evidence without mutating anything. Any staging
 * residue (interrupted or in-progress publication) and any unreadable or
 * mismatched receipt is unresolved; valid receipts are reported but do not by
 * themselves unblock anything — the journal still governs resolution until M6.3.
 */
export async function inspectCopyPublicationEvidence(root: string): Promise<CopyPublicationEvidenceReport> {
  const unresolved: string[] = [];
  const receipts: string[] = [];
  let truncated = false;
  const add = (issue: string) => {
    if (unresolved.length < MAX_ISSUES) unresolved.push(issue);
    else truncated = true;
  };

  const stagingRoot = join(root, COPY_PUBLICATION_STAGING_DIR);
  const stagingInfo = await lstatOrNull(stagingRoot);
  if (stagingInfo !== null) {
    if (stagingInfo.isSymbolicLink() || !stagingInfo.isDirectory() || (stagingInfo.mode & 0o077) !== 0) {
      add(`${COPY_PUBLICATION_STAGING_DIR}: staging root is not a private regular directory.`);
    } else {
      const operations = await boundedDirectoryNames(stagingRoot, STAGING_OPERATIONS_MAX);
      if (operations.truncated) add(`${COPY_PUBLICATION_STAGING_DIR}: staging operation count exceeds its structural bound.`);
      for (const operationName of operations.names) {
        if (!isUuidV4(operationName)) { add(`${COPY_PUBLICATION_STAGING_DIR}/${operationName}: unrecognized staging entry.`); continue; }
        const operationInfo = await lstatOrNull(join(stagingRoot, operationName));
        if (operationInfo === null || operationInfo.isSymbolicLink() || !operationInfo.isDirectory() || (operationInfo.mode & 0o077) !== 0) {
          add(`${COPY_PUBLICATION_STAGING_DIR}/${operationName}: unrecognized staging entry.`);
          continue;
        }
        const attempts = await boundedDirectoryNames(join(stagingRoot, operationName), STAGING_ATTEMPTS_PER_OPERATION_MAX);
        if (attempts.truncated) add(`${COPY_PUBLICATION_STAGING_DIR}/${operationName}: staging attempt count exceeds its structural bound.`);
        for (const attemptName of attempts.names) {
          add(`${COPY_PUBLICATION_STAGING_DIR}/${operationName}/${attemptName}: interrupted or in-progress publication staging evidence; preserve it for review.`);
        }
      }
    }
  }

  const receiptsRoot = join(root, COPY_PUBLICATION_RECEIPT_DIR);
  const receiptsInfo = await lstatOrNull(receiptsRoot);
  if (receiptsInfo !== null) {
    if (receiptsInfo.isSymbolicLink() || !receiptsInfo.isDirectory() || (receiptsInfo.mode & 0o077) !== 0) {
      add(`${COPY_PUBLICATION_RECEIPT_DIR}: receipt root is not a private regular directory.`);
    } else {
      const operations = await boundedDirectoryNames(receiptsRoot, RECEIPT_OPERATIONS_MAX);
      if (operations.truncated) add(`${COPY_PUBLICATION_RECEIPT_DIR}: receipt operation count exceeds its structural bound.`);
      for (const operationName of operations.names) {
        if (!isUuidV4(operationName)) { add(`${COPY_PUBLICATION_RECEIPT_DIR}/${operationName}: unrecognized receipt entry.`); continue; }
        const directory = join(receiptsRoot, operationName);
        const attempts = await boundedDirectoryNames(directory, RECEIPTS_PER_OPERATION_MAX);
        if (attempts.truncated) add(`${COPY_PUBLICATION_RECEIPT_DIR}/${operationName}: receipt count exceeds its structural bound.`);
        for (const attemptName of attempts.names) {
          const relative = `${COPY_PUBLICATION_RECEIPT_DIR}/${operationName}/${attemptName}`;
          if (!attemptName.endsWith('.json')) { add(`${relative}: unrecognized receipt file.`); continue; }
          const checked = await readReceipt(join(directory, attemptName), undefined);
          if (checked.kind === 'valid') {
            if (checked.receipt.operationId !== operationName || `${checked.receipt.attemptId}.json` !== attemptName) {
              add(`${relative}: receipt identity does not match its operation directory or attempt filename.`);
            } else {
              receipts.push(`${operationName}/${attemptName}`);
            }
          }
          else if (checked.kind === 'invalid') add(`${relative}: ${checked.reason}`);
        }
      }
    }
  }

  return Object.freeze({ unresolved: Object.freeze([...unresolved]), receipts: Object.freeze([...receipts]), issuesTruncated: truncated });
}

/** Fail closed when publication evidence needs a human; message mirrors the journal gate. */
export async function assertNoUnresolvedPublicationEvidence(root: string): Promise<void> {
  const report = await inspectCopyPublicationEvidence(root);
  if (report.unresolved.length === 0) return;
  throw new StorageError('PARTIAL_WRITE', `Unresolved copy publication evidence blocks this action: ${report.unresolved[0]}. Preserve it for manual review.`, {
    path: COPY_PUBLICATION_STAGING_DIR,
    details: { paths: [COPY_PUBLICATION_STAGING_DIR, COPY_PUBLICATION_RECEIPT_DIR], issues: [...report.unresolved] },
  });
}

async function resolveLiveDestination(root: string, notePath: string): Promise<string> {
  let absolute: string;
  try { absolute = resolveInsideRoot(root, notePath); }
  catch (error) { throw new StorageError('UNSAFE_PATH', 'Copy publication destination escapes the vault.', { path: notePath, cause: error }); }

  const segments = notePath.split('/');
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    const siblings = await boundedDirectoryNames(current, 50_000);
    if (siblings.truncated) {
      throw new StorageError('INVALID_CONTENT', 'Copy publication destination directory exceeds the inventory bound.', { path: notePath });
    }
    if (siblings.names.some((name) => name !== segment && foldName(name) === foldName(segment))) {
      throw new StorageError('CONFLICT', 'Copy publication destination parent collides by case or Unicode normalization with an existing entry.', { path: notePath });
    }
    current = join(current, segment);
    const info = await lstatOrNull(current);
    if (info === null) throw new StorageError('NOT_FOUND', 'Copy publication destination parent directory does not exist.', { path: notePath });
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new StorageError('UNSAFE_PATH', 'Copy publication destination parent is not a regular directory.', { path: notePath });
    }
  }

  return absolute;
}

async function verifyPublishedDestination(absolute: string, receipt: CopyPublicationReceipt): Promise<void> {
  const initial = await lstat(absolute, { bigint: true });
  const expectedSize = BigInt(receipt.destination.contentBytes);
  const matchesReceipt = (info: typeof initial) => info.isFile() && info.size === expectedSize
    && String(info.dev) === receipt.objectIdentity.deviceId && String(info.ino) === receipt.objectIdentity.fileId;
  if (!matchesReceipt(initial)) throw new Error('Destination type, size, or identity differs from the receipt.');

  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!matchesReceipt(opened)) throw new Error('Destination changed while opening.');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let remaining = receipt.destination.contentBytes;
    while (remaining > 0) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(remaining, buffer.length), null);
      if (bytesRead === 0) throw new Error('Destination ended before the recorded size.');
      hash.update(buffer.subarray(0, bytesRead));
      remaining -= bytesRead;
    }
    const expectedName = basename(receipt.destination.path);
    const siblings = await boundedDirectoryNames(dirname(absolute), 50_000);
    if (siblings.truncated || !siblings.names.includes(expectedName)
      || siblings.names.some((name) => name !== expectedName && foldName(name) === foldName(expectedName))) {
      throw new Error('Destination basename does not uniquely match the exact name in the receipt.');
    }

    const final = await lstat(absolute, { bigint: true });
    if (!matchesReceipt(final) || final.mtimeNs !== opened.mtimeNs || final.ctimeNs !== opened.ctimeNs
      || hash.digest('hex') !== receipt.destination.contentSha256) {
      throw new Error('Destination content or identity differs from the receipt.');
    }
  } finally {
    await handle.close();
  }
}

async function authorizeLiveDestination(root: string, notePath: string): Promise<string> {
  const absolute = await resolveLiveDestination(root, notePath);
  const existing = await lstatOrNull(absolute);
  if (existing !== null) {
    throw new StorageError('CONFLICT', 'Copy publication destination already exists.', { path: notePath });
  }

  const foldedDestination = foldName(basename(notePath));
  const siblings = await boundedDirectoryNames(dirname(absolute), 50_000);
  if (siblings.truncated) {
    throw new StorageError('INVALID_CONTENT', 'Copy publication destination directory exceeds the inventory bound.', { path: notePath });
  }
  for (const sibling of siblings.names) {
    if (foldName(sibling) === foldedDestination) {
      throw new StorageError('CONFLICT', 'Copy publication destination collides by case or Unicode normalization with an existing entry.', { path: notePath });
    }
  }
  return absolute;
}

function makeStagingDescriptor(
  identity: CopyPublicationIdentity,
  contentSha256: string,
  contentBytes: number,
  recordedAt: string,
): CopyPublicationStagingDescriptor {
  const body = {
    format: 'nodus-copy-publication-staging' as const,
    version: 1 as const,
    operationId: identity.ownerJournalOperationId,
    attemptId: identity.attemptId,
    preparedEventSha256: identity.preparedEventSha256,
    destinationPath: identity.destination.path,
    destinationNoteId: identity.destination.noteId,
    contentSha256,
    contentBytes,
    recordedAt,
  };
  return Object.freeze({ ...body, descriptorSha256: sha256Hex(JSON.stringify(body)) });
}

function makeReceipt(
  identity: CopyPublicationIdentity,
  evidence: { deviceId: string; fileId: string; publishedAt: string; contentSha256: string; contentBytes: number },
): CopyPublicationReceipt {
  const body = {
    format: 'nodus-copy-publication-receipt' as const,
    version: 1 as const,
    operationId: identity.ownerJournalOperationId,
    attemptId: identity.attemptId,
    preparedEventSha256: identity.preparedEventSha256,
    destination: {
      path: identity.destination.path, noteId: identity.destination.noteId,
      contentSha256: evidence.contentSha256, contentBytes: evidence.contentBytes,
    },
    objectIdentity: { deviceId: evidence.deviceId, fileId: evidence.fileId },
    publishedAt: evidence.publishedAt,
  };
  return Object.freeze({ ...body, receiptDigestSha256: sha256Hex(JSON.stringify(body)) });
}

type ReceiptRead =
  | { readonly kind: 'absent' }
  | { readonly kind: 'valid'; readonly receipt: CopyPublicationReceipt }
  | { readonly kind: 'invalid'; readonly reason: string };

async function readReceipt(path: string, identity: CopyPublicationIdentity | undefined): Promise<ReceiptRead> {
  const info = await lstatOrNull(path);
  if (info === null) return { kind: 'absent' };
  if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1 || (info.mode & 0o077) !== 0 || info.size > RECORD_BYTES_MAX) {
    return { kind: 'invalid', reason: 'receipt file is not a private single-link regular file' };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(await readBoundedFile(path)); }
  catch { return { kind: 'invalid', reason: 'receipt is not readable JSON' }; }
  const receipt = parsed as CopyPublicationReceipt;
  if (!isRecord(receipt) || receipt.format !== 'nodus-copy-publication-receipt' || receipt.version !== 1
    || !isUuidV4(receipt.operationId) || !isUuidV4(receipt.attemptId) || !isSha256(receipt.preparedEventSha256)
    || !isRecord(receipt.destination) || typeof receipt.destination.path !== 'string' || !isUuidV4(receipt.destination.noteId)
    || !isSha256(receipt.destination.contentSha256) || !Number.isSafeInteger(receipt.destination.contentBytes)
    || !isRecord(receipt.objectIdentity) || !isOpaqueIdentityString(receipt.objectIdentity.deviceId)
    || !isOpaqueIdentityString(receipt.objectIdentity.fileId) || !isTimestamp(receipt.publishedAt)
    || !isSha256(receipt.receiptDigestSha256)) {
    return { kind: 'invalid', reason: 'receipt schema is invalid' };
  }
  const body = {
    format: receipt.format, version: receipt.version, operationId: receipt.operationId, attemptId: receipt.attemptId,
    preparedEventSha256: receipt.preparedEventSha256,
    destination: {
      path: receipt.destination.path, noteId: receipt.destination.noteId,
      contentSha256: receipt.destination.contentSha256, contentBytes: receipt.destination.contentBytes,
    },
    objectIdentity: { deviceId: receipt.objectIdentity.deviceId, fileId: receipt.objectIdentity.fileId },
    publishedAt: receipt.publishedAt,
  };
  if (sha256Hex(JSON.stringify(body)) !== receipt.receiptDigestSha256) {
    return { kind: 'invalid', reason: 'receipt digest does not match its canonical fields' };
  }
  if (identity !== undefined) {
    const matches = receipt.operationId === identity.ownerJournalOperationId
      && receipt.attemptId === identity.attemptId
      && receipt.preparedEventSha256 === identity.preparedEventSha256
      && receipt.destination.path === identity.destination.path
      && receipt.destination.noteId === identity.destination.noteId
      && receipt.destination.contentSha256 === identity.destination.contentSha256
      && receipt.destination.contentBytes === identity.destination.contentBytes;
    if (!matches) return { kind: 'invalid', reason: 'receipt belongs to a different operation, attempt, or destination' };
  }
  return { kind: 'valid', receipt };
}

async function ensurePrivateDirectory(absolute: string, parent: string): Promise<void> {
  const existing = await lstatOrNull(absolute);
  if (existing !== null) {
    if (existing.isSymbolicLink() || !existing.isDirectory() || (existing.mode & 0o077) !== 0) {
      throw new StorageError('UNSAFE_PATH', 'Copy publication storage path is not a private regular directory.', { path: absolute });
    }
    return;
  }
  try { await mkdir(absolute, { mode: 0o700 }); }
  catch (error) {
    if (!isAlreadyExists(error)) throw new StorageError('STORAGE_FAILURE', 'Copy publication directory could not be created.', { path: absolute, cause: error });
    const raced = await lstatOrNull(absolute);
    if (raced === null || raced.isSymbolicLink() || !raced.isDirectory() || (raced.mode & 0o077) !== 0) {
      throw new StorageError('UNSAFE_PATH', 'Copy publication directory changed during creation.', { path: absolute });
    }
  }
  await syncDirectory(parent);
}

interface StagedFile { readonly device: number; readonly inode: number; readonly size: number }

async function writePrivateFile(absolute: string, bytes: Uint8Array, directory: string): Promise<StagedFile> {
  let handle: FileHandle | undefined;
  let primary: unknown;
  let failed = false;
  let staged: StagedFile | undefined;
  try {
    handle = await open(absolute, 'wx', PRIVATE_FILE_MODE);
    await handle.writeFile(bytes);
    const owned = await handle.stat();
    if (!owned.isFile() || owned.nlink !== 1 || (owned.mode & 0o077) !== 0 || owned.size !== bytes.byteLength) {
      throw new StorageError('PARTIAL_WRITE', 'Copy publication staging file is not the expected private single-link regular file.', { path: absolute });
    }
    await handle.sync();
    await handle.close();
    handle = undefined;
    await syncDirectory(directory);
    const named = await lstat(absolute);
    if (named.isSymbolicLink() || !named.isFile() || named.nlink !== 1 || (named.mode & 0o077) !== 0
      || named.dev !== owned.dev || named.ino !== owned.ino || named.size !== owned.size) {
      throw new StorageError('PARTIAL_WRITE', 'Copy publication staging file identity changed while writing.', { path: absolute });
    }
    staged = { device: named.dev, inode: named.ino, size: named.size };
  } catch (error) { failed = true; primary = error; }
  if (handle !== undefined) {
    try { await handle.close(); }
    catch (cleanupError) {
      if (failed) throw new AggregateError([primary, cleanupError], 'Copy publication staging write and handle cleanup failed');
      throw cleanupError;
    }
  }
  if (failed) throw primary;
  return staged!;
}

async function removeOwnStaging(descriptorPath: string, stagePath: string, directory: string): Promise<void> {
  await unlink(stagePath).catch(() => undefined);
  await unlink(descriptorPath).catch(() => undefined);
  await syncDirectory(directory).catch(() => undefined);
  await rmdir(directory).catch(() => undefined);
}

async function syncDirectory(absolute: string): Promise<void> {
  let handle: FileHandle | undefined;
  try { handle = await open(absolute, 'r'); await handle.sync(); }
  finally { await handle?.close().catch(() => undefined); }
}

async function boundedDirectoryNames(absolute: string, maximum: number): Promise<{ names: string[]; truncated: boolean }> {
  const info = await lstatOrNull(absolute);
  if (info === null) return { names: [], truncated: false };
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new StorageError('UNSAFE_PATH', 'Copy publication path is not a regular directory.', { path: absolute });
  }
  const names: string[] = [];
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    if (names.length >= maximum) return { names, truncated: true };
    names.push(entry.name);
  }
  names.sort();
  return { names, truncated: false };
}

async function readBoundedFile(absolute: string): Promise<string> {
  const handle = await open(absolute, 'r');
  try {
    const buffer = Buffer.alloc(RECORD_BYTES_MAX + 1);
    const { bytesRead } = await handle.read(buffer, 0, RECORD_BYTES_MAX + 1, 0);
    if (bytesRead > RECORD_BYTES_MAX) throw new Error('receipt exceeds its read bound');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
}

async function lstatOrNull(absolute: string) {
  try { return await lstat(absolute); }
  catch (error) { if (isMissing(error)) return null; throw error; }
}

/** Builds the same refusal error the accepted capability gate throws. */
function publicationRefused(assessment: Exclude<PublicationCapabilityAssessment, { readonly status: 'supported' }>): StorageError {
  return new StorageError('PUBLICATION_CAPABILITY_REFUSED', `Filesystem copy publication refused: ${assessment.status}. ${assessment.reason}`, {
    details: { issues: [assessment.status, assessment.reason] },
  });
}

function foldName(name: string): string { return name.normalize('NFC').toLowerCase(); }
function sha256Hex(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function encodeJson(value: unknown): Buffer { return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8'); }
function isSha256(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
function isUuidV4(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value); }
function isOpaqueIdentityString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && /^[A-Za-z0-9._:-]+$/.test(value);
}
function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 40 && Number.isFinite(Date.parse(value));
}
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'; }
function isAlreadyExists(error: unknown): boolean { return (error as NodeJS.ErrnoException | undefined)?.code === 'EEXIST'; }
function describe(error: unknown): string { return error instanceof Error ? error.message : String(error); }
