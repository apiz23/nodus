import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CopyOperationJournal, validateCopyJournalPreparedEvent, type CopyOperationPlanInput } from '../src/storage/fs/copy-operation-journal.js';
import { withVaultRootLock } from '../src/storage/fs/root-lock.js';
import {
  assessCopyPublicationEvidence,
  assessCopyPublicationTemporalPlausibility,
  copyPublicationReceiptDigest,
  createCopyPublicationIdentity,
  deriveCopyPublicationPreparedEventDigest,
  matchesPreparedCopyIdentity,
  validateCopyPublicationIdentity,
  type CopyPublicationReceiptDigestInput,
  type CopyPublicationIdentity,
} from '../src/storage/copy-publication.js';
import {
  FILESYSTEM_PUBLICATION_ALLOWLIST,
  assessFilesystemPublicationCapability,
  requireFilesystemPublicationCapability,
} from '../src/storage/fs/publication-capability.js';

const roots: string[] = [];
const now = '2026-11-20T00:00:00Z';
const operationId = '33333333-3333-4333-8333-333333333333';
const attemptId = '44444444-4444-4444-8444-444444444444';
const sourceId = '11111111-1111-4111-8111-111111111111';
const destinationId = '22222222-2222-4222-8222-222222222222';

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function identityInput(): Record<string, unknown> {
  return {
    format: 'nodus-copy-publication-identity',
    version: 1,
    ownerJournalOperationId: operationId,
    preparedOperationId: operationId,
    preparedEventSha256: 'c'.repeat(64),
    attemptId,
    vault: {
      instanceId: '55555555-5555-4555-8555-555555555555',
      lineageId: '66666666-6666-4666-8666-666666666666',
    },
    source: { noteId: sourceId, path: 'notes/source.md', rawSha256: 'a'.repeat(64) },
    destination: {
      noteId: destinationId,
      path: 'notes/copy.md',
      collisionKey: 'notes/copy.md',
      contentSha256: 'b'.repeat(64),
      contentBytes: 128,
    },
  };
}

function validIdentity(): CopyPublicationIdentity {
  const result = validateCopyPublicationIdentity(identityInput());
  if (result.kind !== 'valid') throw new Error(result.reason);
  return result.identity;
}

function evidenceInput(): Record<string, unknown> {
  return {
    format: 'nodus-copy-publication-evidence',
    version: 1,
    identity: identityInput(),
    provenance: {
      observerId: 'test.filesystem-observer.v1',
      observedAt: now,
      capability: {
        requested: true,
        platform: 'darwin',
        filesystem: 'apfs',
        primitiveSupport: 'supported',
      },
    },
    attempt: { state: 'not-started', preparedEventSha256: 'c'.repeat(64) },
    source: { state: 'unchanged', observedSha256: 'a'.repeat(64) },
    destination: { state: 'absent' },
    receipt: null,
  };
}

function receiptInput(overrides: Partial<CopyPublicationReceiptDigestInput> = {}): Record<string, unknown> {
  const body: CopyPublicationReceiptDigestInput = {
    kind: 'exclusive-no-replace-receipt',
    ownerJournalOperationId: operationId,
    attemptId,
    destinationNoteId: destinationId,
    destinationPath: 'notes/copy.md',
    contentSha256: 'b'.repeat(64),
    objectIdentity: { deviceId: '1', fileId: '2' },
    ...overrides,
  };
  return { ...body, receiptSha256: copyPublicationReceiptDigest(body) };
}

function planInput(): CopyOperationPlanInput {
  return {
    previewTokenSha256: '1'.repeat(64),
    previewBindingSha256: '2'.repeat(64),
    snapshotSha256: '3'.repeat(64),
    confirmedAt: now,
    source: { id: sourceId, path: 'notes/source.md', rawSha256: 'a'.repeat(64), createdAt: now, updatedAt: now },
    destination: { path: 'notes/copy.md', collisionKey: 'notes/copy.md' },
    copy: { id: destinationId, instant: now, serializedSha256: 'b'.repeat(64), serializedBytes: 128, noteFormatVersion: 1 },
    resolverProjectionSha256: 'd'.repeat(64),
  };
}

async function createVaultRoot(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'nodus-m6-1-contract-'));
  roots.push(parent);
  const root = join(parent, 'vault');
  await mkdir(root);
  return root;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const M6_SOURCE_FILES = ['src/storage/copy-publication.ts', 'src/storage/fs/publication-capability.ts'];
const FORBIDDEN_FS_MODULE = /from\s+['"]node:fs(?:\/promises)?['"]|require\(\s*['"]node:fs/;
const FORBIDDEN_FS_CALLS = /\b(writeFile|appendFile|copyFile|rename|unlink|rm|mkdir|rmdir|symlink|link|open|truncate|chmod|chown)\s*\(/;

/**
 * M6.1 must be a pure contract. These modules make no filesystem call and
 * import no writer module, so no write, staging, publication, or overwrite is
 * reachable through them. The journal module they import for the canonical
 * digest does have filesystem capability; none of its writers is referenced.
 */
async function readM6Sources(): Promise<Array<{ path: string; source: string }>> {
  return Promise.all(M6_SOURCE_FILES.map(async (path) => ({ path, source: await readFile(new URL(`../${path}`, import.meta.url), 'utf8') })));
}

async function publishIdentityFromRealJournal(): Promise<{
  root: string;
  preparedEvent: Record<string, unknown>;
  attemptId: string;
  identity: CopyPublicationIdentity;
}> {
  const root = await createVaultRoot();
  const journal = new CopyOperationJournal(root);
  const prepared = await withVaultRootLock(root, () => journal.prepare(planInput()));
  const eventPath = join(root, '.nodus-copy-journal', 'operations', prepared.operationId, 'event-000000.json');
  const preparedEvent = JSON.parse(await readFile(eventPath, 'utf8')) as Record<string, unknown>;
  const created = createCopyPublicationIdentity({ preparedEvent, attemptId: randomUUID() });
  if (created.kind !== 'valid') throw new Error(`identity construction from a real journal event failed: ${created.reason}`);
  return { root, preparedEvent, attemptId: created.identity.attemptId, identity: created.identity };
}

describe('Phase 19 M6.1 publication identity contract', () => {
  it('accepts a complete identity bound to one prepared operation, source and destination', () => {
    const result = validateCopyPublicationIdentity(identityInput());
    expect(result.kind).toBe('valid');
    if (result.kind === 'valid') {
      expect(result.identity.ownerJournalOperationId).toBe(result.identity.preparedOperationId);
      expect(result.identity.destination.collisionKey).toBe('notes/copy.md');
      expect(Object.isFrozen(result.identity)).toBe(true);
      expect(Object.isFrozen(result.identity.destination)).toBe(true);
    }
  });

  it('rejects missing and malformed owner, source and destination identities', () => {
    const missingOperation = identityInput();
    delete missingOperation.ownerJournalOperationId;
    expect(validateCopyPublicationIdentity(missingOperation).kind).toBe('invalid');

    const invalidOperation = { ...identityInput(), preparedOperationId: 'not-a-uuid' };
    expect(validateCopyPublicationIdentity(invalidOperation).kind).toBe('invalid');

    const invalidSource = identityInput();
    invalidSource.source = { noteId: 'bad', path: 'notes/source.md', rawSha256: 'a'.repeat(64) };
    expect(validateCopyPublicationIdentity(invalidSource).kind).toBe('invalid');

    const invalidDestination = identityInput();
    invalidDestination.destination = { noteId: 'bad', path: 'notes/copy.md', collisionKey: 'notes/copy.md', contentSha256: 'b'.repeat(64), contentBytes: 128 };
    expect(validateCopyPublicationIdentity(invalidDestination).kind).toBe('invalid');
  });

  it('rejects cross-operation, duplicate and conflicting identities', () => {
    const differentOwner = { ...identityInput(), ownerJournalOperationId: '77777777-7777-4777-8777-777777777777' };
    expect(validateCopyPublicationIdentity(differentOwner).kind).toBe('invalid');

    const duplicateAttempt = { ...identityInput(), attemptId: operationId };
    expect(validateCopyPublicationIdentity(duplicateAttempt).kind).toBe('invalid');

    const duplicateNote = identityInput();
    duplicateNote.destination = {
      noteId: sourceId, path: 'notes/copy.md', collisionKey: 'notes/copy.md',
      contentSha256: 'b'.repeat(64), contentBytes: 128,
    };
    expect(validateCopyPublicationIdentity(duplicateNote).kind).toBe('invalid');

    const pathCollision = identityInput();
    pathCollision.destination = {
      noteId: destinationId, path: 'NOTES/source.md', collisionKey: 'notes/source.md',
      contentSha256: 'b'.repeat(64), contentBytes: 128,
    };
    expect(validateCopyPublicationIdentity(pathCollision).kind).toBe('invalid');
  });

  it('rejects traversal and a destination collision key that does not derive from its path', () => {
    const traversal = identityInput();
    traversal.destination = {
      noteId: destinationId, path: '../copy.md', collisionKey: '../copy.md',
      contentSha256: 'b'.repeat(64), contentBytes: 128,
    };
    expect(validateCopyPublicationIdentity(traversal).kind).toBe('invalid');

    const mismatchedKey = identityInput();
    mismatchedKey.destination = {
      noteId: destinationId, path: 'notes/copy.md', collisionKey: 'other/copy.md',
      contentSha256: 'b'.repeat(64), contentBytes: 128,
    };
    expect(validateCopyPublicationIdentity(mismatchedKey).kind).toBe('invalid');
  });

  it('matches every operation, vault, source and destination field against the validated Prepared plan', () => {
    const identity = validIdentity();
    const binding = {
      operationId,
      preparedEventSha256: 'c'.repeat(64),
      vaultInstanceId: identity.vault.instanceId,
      vaultLineageId: identity.vault.lineageId,
      source: { id: sourceId, path: 'notes/source.md', rawSha256: 'a'.repeat(64) },
      destination: { path: 'notes/copy.md', collisionKey: 'notes/copy.md' },
      copy: { id: destinationId, serializedSha256: 'b'.repeat(64), serializedBytes: 128 },
    };
    expect(matchesPreparedCopyIdentity(identity, binding)).toBe(true);
    expect(matchesPreparedCopyIdentity(identity, { ...binding, operationId: '77777777-7777-4777-8777-777777777777' })).toBe(false);
    expect(matchesPreparedCopyIdentity(identity, { ...binding, source: { ...binding.source, rawSha256: 'e'.repeat(64) } })).toBe(false);
    expect(matchesPreparedCopyIdentity(identity, { ...binding, copy: { ...binding.copy, id: '88888888-8888-4888-8888-888888888888' } })).toBe(false);
  });
});

describe('Phase 19 M6.1 publication evidence contract', () => {
  it('validates complete evidence structurally but keeps it ambiguous on an unqualified filesystem', () => {
    const assessment = assessCopyPublicationEvidence(evidenceInput(), validIdentity());
    expect(assessment).toMatchObject({ classification: 'ambiguous' });
    if (assessment.classification === 'ambiguous') expect(assessment.reason).toMatch(/not-qualified/);
  });

  it('treats missing evidence as ambiguous rather than proof of non-publication', () => {
    const missing = evidenceInput();
    delete missing.destination;
    expect(assessCopyPublicationEvidence(missing, validIdentity())).toMatchObject({ classification: 'ambiguous' });

    const unknown = evidenceInput();
    unknown.attempt = { state: 'unknown', preparedEventSha256: 'c'.repeat(64) };
    unknown.source = { state: 'unknown' };
    unknown.destination = { state: 'unknown' };
    expect(assessCopyPublicationEvidence(unknown, validIdentity())).toMatchObject({ classification: 'ambiguous' });
  });

  it('rejects malformed, contradictory, cross-operation and wrong-destination evidence', () => {
    const malformed = evidenceInput();
    malformed.version = 2;
    expect(assessCopyPublicationEvidence(malformed, validIdentity())).toMatchObject({ classification: 'invalid' });

    const contradictory = evidenceInput();
    contradictory.attempt = { state: 'started', preparedEventSha256: 'c'.repeat(64) };
    contradictory.receipt = receiptInput();
    expect(assessCopyPublicationEvidence(contradictory, validIdentity())).toMatchObject({ classification: 'invalid' });

    const wrongOperation = evidenceInput();
    wrongOperation.identity = { ...identityInput(), ownerJournalOperationId: '77777777-7777-4777-8777-777777777777', preparedOperationId: '77777777-7777-4777-8777-777777777777' };
    expect(assessCopyPublicationEvidence(wrongOperation, validIdentity())).toMatchObject({ classification: 'invalid' });

    const foreignReceipt = evidenceInput();
    foreignReceipt.attempt = { state: 'started', preparedEventSha256: 'c'.repeat(64) };
    foreignReceipt.destination = {
      state: 'matches-expected', noteId: destinationId, contentSha256: 'b'.repeat(64),
      objectIdentity: { deviceId: '1', fileId: '2' },
    };
    foreignReceipt.receipt = receiptInput({ ownerJournalOperationId: '77777777-7777-4777-8777-777777777777' });
    expect(assessCopyPublicationEvidence(foreignReceipt, validIdentity())).toMatchObject({ classification: 'invalid' });

    const stalePreparedEvent = evidenceInput();
    stalePreparedEvent.attempt = { state: 'not-started', preparedEventSha256: 'e'.repeat(64) };
    expect(assessCopyPublicationEvidence(stalePreparedEvent, validIdentity())).toMatchObject({ classification: 'invalid' });

    const wrongDestination = evidenceInput();
    wrongDestination.destination = {
      state: 'matches-expected', noteId: '88888888-8888-4888-8888-888888888888',
      contentSha256: 'b'.repeat(64), objectIdentity: { deviceId: '1', fileId: '2' },
    };
    expect(assessCopyPublicationEvidence(wrongDestination, validIdentity())).toMatchObject({ classification: 'invalid' });
  });

  it('does not infer operation ownership from a matching destination file without a bound receipt', () => {
    const destinationPresent = evidenceInput();
    destinationPresent.attempt = { state: 'started', preparedEventSha256: 'c'.repeat(64) };
    destinationPresent.destination = {
      state: 'matches-expected', noteId: destinationId, contentSha256: 'b'.repeat(64),
      objectIdentity: { deviceId: '1', fileId: '2' },
    };
    expect(assessCopyPublicationEvidence(destinationPresent, validIdentity())).toMatchObject({ classification: 'ambiguous' });
  });

  it('refuses internally consistent receipt evidence at the capability gate, never as published', () => {
    const complete = evidenceInput();
    complete.attempt = { state: 'started', preparedEventSha256: 'c'.repeat(64) };
    complete.destination = {
      state: 'matches-expected', noteId: destinationId, contentSha256: 'b'.repeat(64),
      objectIdentity: { deviceId: '1', fileId: '2' },
    };
    complete.receipt = receiptInput();
    expect(assessCopyPublicationEvidence(complete, validIdentity())).toMatchObject({ classification: 'ambiguous' });

    const altered = evidenceInput();
    altered.attempt = { state: 'started', preparedEventSha256: 'c'.repeat(64) };
    altered.destination = {
      state: 'matches-expected', noteId: destinationId, contentSha256: 'b'.repeat(64),
      objectIdentity: { deviceId: '1', fileId: '2' },
    };
    altered.receipt = { ...receiptInput(), contentSha256: 'e'.repeat(64) };
    expect(assessCopyPublicationEvidence(altered, validIdentity())).toMatchObject({ classification: 'invalid' });
  });
});

describe('Phase 19 M6.1 filesystem capability gate', () => {
  it('keeps the native filesystem publication allowlist empty', () => {
    expect(FILESYSTEM_PUBLICATION_ALLOWLIST).toEqual([]);
    expect(Object.isFrozen(FILESYSTEM_PUBLICATION_ALLOWLIST)).toBe(true);
  });

  it('distinguishes unsupported, unqualified, unavailable and explicitly disabled capability', () => {
    expect(assessFilesystemPublicationCapability({
      requested: true, platform: 'darwin', filesystem: 'apfs', primitiveSupport: 'unsupported',
    }).status).toBe('unsupported');
    expect(assessFilesystemPublicationCapability({
      requested: true, platform: 'darwin', filesystem: 'apfs', primitiveSupport: 'supported',
    }).status).toBe('not-qualified');
    expect(assessFilesystemPublicationCapability({
      requested: true, platform: 'linux', filesystem: 'ext4', primitiveSupport: 'supported',
    }).status).toBe('not-qualified');
    expect(assessFilesystemPublicationCapability({
      requested: true, platform: 'win32', filesystem: 'ntfs', primitiveSupport: 'supported',
    }).status).toBe('not-qualified');
    expect(assessFilesystemPublicationCapability({
      requested: true, platform: null, filesystem: null, primitiveSupport: 'unknown',
    }).status).toBe('unavailable');
    expect(assessFilesystemPublicationCapability({
      requested: false,
    }).status).toBe('disabled');
    expect(assessFilesystemPublicationCapability({
      requested: true, platform: 'plan9', filesystem: 'unknownfs', primitiveSupport: 'supported',
    }).status).toBe('unsupported');
  });

  it('refuses capability with no filesystem call and no fallback available', async () => {
    for (const probe of [
      { requested: true, platform: 'darwin', filesystem: 'apfs', primitiveSupport: 'supported' },
      { requested: true, platform: 'linux', filesystem: 'ext4', primitiveSupport: 'supported' },
      { requested: true, platform: 'win32', filesystem: 'ntfs', primitiveSupport: 'supported' },
      { requested: false },
    ]) {
      expect(() => requireFilesystemPublicationCapability(probe)).toThrow(/PUBLICATION|refused/i);
      try {
        requireFilesystemPublicationCapability(probe);
        throw new Error('capability check must never return');
      } catch (error) {
        expect((error as { code?: string }).code).toBe('PUBLICATION_CAPABILITY_REFUSED');
      }
    }
    // The meaningful guarantee is structural: these modules never touch the
    // filesystem and import no writer, so no write, staging, publication, or
    // overwrite fallback is reachable from them — not merely unexecuted here.
    for (const { path, source } of await readM6Sources()) {
      expect(FORBIDDEN_FS_MODULE.test(source), `${path} imports node:fs`).toBe(false);
      expect(FORBIDDEN_FS_CALLS.test(source), `${path} calls a filesystem mutation API`).toBe(false);
    }
  });
});

describe('Phase 19 M6.1 v1 Prepared journal compatibility', () => {
  it('keeps v1 Prepared bytes readable, unresolved, and admission-blocking', async () => {
    const root = await createVaultRoot();
    const journal = new CopyOperationJournal(root);
    const prepared = await withVaultRootLock(root, () => journal.prepare(planInput()));
    const eventPath = join(root, '.nodus-copy-journal', 'operations', prepared.operationId, 'event-000000.json');
    const before = await readFile(eventPath);
    const parsed: unknown = JSON.parse(before.toString('utf8'));
    if (!isRecord(parsed)) throw new Error('Prepared journal event was not a JSON object.');
    expect(parsed).toMatchObject({ format: 'nodus-copy-operation-event', version: 1, state: 'Prepared' });
    expect(parsed.plan).toMatchObject({ format: 'nodus-copy-operation-plan', version: 1 });

    const recovery = await withVaultRootLock(root, () => journal.recover(async () => true));
    expect(recovery).toMatchObject({ prepared: 1, terminal: 0, unresolved: true });
    await expect(withVaultRootLock(root, () => journal.assertNoUnresolved())).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    expect(await readFile(eventPath)).toEqual(before);
    await expect(withVaultRootLock(root, () => journal.list())).resolves.toMatchObject([{ operationId: prepared.operationId, state: 'Prepared' }]);
  });
});

describe('Phase 19 M6.1R prepared-event digest binding', () => {
  it('derives the identity digest from a real journal Prepared event and matches the plan', async () => {
    const { preparedEvent, identity } = await publishIdentityFromRealJournal();
    const validated = validateCopyJournalPreparedEvent(preparedEvent);
    expect(validated.kind).toBe('valid');
    if (validated.kind !== 'valid') return;
    expect(identity.preparedEventSha256).toBe(validated.event.digestSha256);
    // The digest is the journal event's own canonical sha256 field, not a hash
    // of the serialized file bytes.
    expect(identity.preparedEventSha256).toBe(preparedEvent.sha256);
    expect(identity.ownerJournalOperationId).toBe(validated.event.operationId);
    expect(identity.source.rawSha256).toBe(validated.event.plan.source.rawSha256);
    expect(identity.destination.contentSha256).toBe(validated.event.plan.copy.serializedSha256);
    expect(matchesPreparedCopyIdentity(identity, {
      operationId: validated.event.operationId,
      preparedEventSha256: validated.event.digestSha256,
      vaultInstanceId: validated.event.vaultInstanceId,
      vaultLineageId: validated.event.vaultLineageId,
      source: validated.event.plan.source,
      destination: validated.event.plan.destination,
      copy: validated.event.plan.copy,
    })).toBe(true);
  });

  it('derives the same canonical digest as the journal and rejects tampered event content', async () => {
    const { preparedEvent } = await publishIdentityFromRealJournal();
    const derived = deriveCopyPublicationPreparedEventDigest(preparedEvent);
    expect(derived.kind).toBe('valid');
    const tampered = structuredClone(preparedEvent);
    (tampered.plan as Record<string, unknown>).copy = {
      ...((tampered.plan as Record<string, unknown>).copy as Record<string, unknown>),
      serializedSha256: 'f'.repeat(64),
    };
    expect(deriveCopyPublicationPreparedEventDigest(tampered).kind).toBe('invalid');
    expect(validateCopyJournalPreparedEvent(tampered)).toMatchObject({
      kind: 'invalid', reason: expect.stringMatching(/checksum/i),
    });
    const rebadged = structuredClone(preparedEvent);
    rebadged.state = 'Cancelled';
    expect(validateCopyJournalPreparedEvent(rebadged)).toMatchObject({ kind: 'invalid' });
    const appended = structuredClone(preparedEvent);
    appended.evidence = { kind: 'no-publication' };
    expect(validateCopyJournalPreparedEvent(appended)).toMatchObject({ kind: 'invalid' });
    const extraField = structuredClone(preparedEvent);
    extraField.unexpected = true;
    expect(validateCopyJournalPreparedEvent(extraField)).toMatchObject({ kind: 'invalid' });
    expect(validateCopyJournalPreparedEvent(null).kind).toBe('invalid');
    expect(validateCopyJournalPreparedEvent([]).kind).toBe('invalid');
  });

  it('refuses identity construction from a foreign or non-Prepared event', () => {
    const base = identityInput();
    const foreignChain = { ...base, preparedEventSha256: 'z'.repeat(64) };
    expect(deriveCopyPublicationPreparedEventDigest(foreignChain).kind).toBe('invalid');
    expect(createCopyPublicationIdentity({ preparedEvent: base, attemptId }).kind).toBe('invalid');
    expect(createCopyPublicationIdentity({ preparedEvent: null, attemptId }).kind).toBe('invalid');
    expect(createCopyPublicationIdentity({ preparedEvent: { ...base }, attemptId: 'not-a-uuid' }).kind).toBe('invalid');
  });
});

describe('Phase 19 M6.1R publication path authorization policy', () => {
  it.each([
    ['.nodus-copy-journal/operations/x.md', 'the copy journal directory'],
    ['.nodus-copy-journal/vault.json', 'journal identity storage'],
    ['.nodus-tmp-secret.md', 'a temporary artifact name'],
    ['.nodus-vault-write.lock.md', 'the root lock namespace'],
    ['notes/.hidden/x.md', 'a nested hidden segment'],
    ['databases/x.md', 'the database namespace'],
    ['database-views/x.md', 'the database-view namespace'],
    ['attachments/x.md', 'the managed attachments namespace'],
    ['ATTACHMENTS/x.md', 'a case-variant attachments namespace'],
  ])('rejects %s as an unauthorized publication destination', (path) => {
    const input = identityInput();
    input.destination = {
      noteId: destinationId, path, collisionKey: path.normalize('NFC').toLowerCase(),
      contentSha256: 'b'.repeat(64), contentBytes: 128,
    };
    expect(validateCopyPublicationIdentity(input)).toMatchObject({ kind: 'invalid' });
  });

  it('rejects the same namespaces when they appear as the copy source', () => {
    const input = identityInput();
    input.source = { noteId: sourceId, path: 'databases/source.md', rawSha256: 'a'.repeat(64) };
    expect(validateCopyPublicationIdentity(input)).toMatchObject({ kind: 'invalid' });
  });

  it('still authorizes ordinary note destinations and preserves collision rules', () => {
    const input = identityInput();
    input.destination = {
      noteId: destinationId, path: 'notes/Sub/Copy of Source.md', collisionKey: 'notes/sub/copy of source.md',
      contentSha256: 'b'.repeat(64), contentBytes: 128,
    };
    expect(validateCopyPublicationIdentity(input).kind).toBe('valid');

    const badKey = structuredClone(input);
    (badKey.destination as Record<string, unknown>).collisionKey = 'notes/sub/other.md';
    expect(validateCopyPublicationIdentity(badKey).kind).toBe('invalid');
  });
});

describe('Phase 19 M6.1R evidence cannot self-attest a definitive outcome', () => {
  const definitive = new Set(['definitely-published', 'definitely-not-published']);

  function variants(): Array<[string, Record<string, unknown>]> {
    const missingProvenance = evidenceInput();
    delete missingProvenance.provenance;
    const missingAttempt = evidenceInput();
    delete missingAttempt.attempt;
    const missingSource = evidenceInput();
    delete missingSource.source;
    const missingDestination = evidenceInput();
    delete missingDestination.destination;
    const missingReceipt = evidenceInput();
    delete missingReceipt.receipt;
    const contradictory = evidenceInput();
    contradictory.attempt = { state: 'started', preparedEventSha256: 'c'.repeat(64) };
    contradictory.receipt = receiptInput();
    const consistent = structuredClone(contradictory);
    consistent.destination = {
      state: 'matches-expected', noteId: destinationId, contentSha256: 'b'.repeat(64),
      objectIdentity: { deviceId: '1', fileId: '2' },
    };
    const notPublished = evidenceInput();
    notPublished.attempt = { state: 'not-started', preparedEventSha256: 'c'.repeat(64) };
    const exotic = evidenceInput();
    exotic.version = 2;
    return [
      ['complete evidence', evidenceInput()],
      ['missing provenance', missingProvenance],
      ['missing attempt', missingAttempt],
      ['missing source', missingSource],
      ['missing destination', missingDestination],
      ['missing receipt', missingReceipt],
      ['contradictory receipt', contradictory],
      ['internally consistent published evidence', consistent],
      ['evidence asserting non-publication', notPublished],
      ['unknown version', exotic],
      [ 'null evidence', null as unknown as Record<string, unknown>],
    ];
  }

  it.each(variants())('classifies %s only as ambiguous or invalid, never definitive', (_label, evidence) => {
    const result = assessCopyPublicationEvidence(evidence, validIdentity());
    expect(definitive.has(result.classification)).toBe(false);
    expect(['ambiguous', 'invalid']).toContain(result.classification);
  });

  it('never resolves evidence regardless of caller-supplied capability claims', () => {
    for (const primitiveSupport of ['supported', 'unsupported', 'unknown'] as const) {
      for (const platform of ['darwin', 'linux', 'win32', 'plan9'] as const) {
        const evidence = evidenceInput();
        evidence.provenance = {
          observerId: 'probe.observer.v1', observedAt: now,
          capability: { requested: true, platform, filesystem: 'apfs', primitiveSupport },
        };
        evidence.attempt = { state: 'started', preparedEventSha256: 'c'.repeat(64) };
        evidence.destination = {
          state: 'matches-expected', noteId: destinationId, contentSha256: 'b'.repeat(64),
          objectIdentity: { deviceId: '1', fileId: '2' },
        };
        evidence.receipt = receiptInput();
        const result = assessCopyPublicationEvidence(evidence, validIdentity());
        expect(result.classification).toBe('ambiguous');
        expect(definitive.has(result.classification)).toBe(false);
      }
    }
  });
});

describe('Phase 19 M6.1R evidence negative cases', () => {
  function publishedEvidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      format: 'nodus-copy-publication-evidence', version: 1, identity: identityInput(),
      provenance: {
        observerId: 'probe.observer.v1', observedAt: now,
        capability: { requested: true, platform: 'darwin', filesystem: 'apfs', primitiveSupport: 'supported' },
      },
      attempt: { state: 'started', preparedEventSha256: 'c'.repeat(64) },
      source: { state: 'unchanged', observedSha256: 'a'.repeat(64) },
      destination: {
        state: 'matches-expected', noteId: destinationId, contentSha256: 'b'.repeat(64),
        objectIdentity: { deviceId: '1', fileId: '2' },
      },
      receipt: receiptInput(),
      ...overrides,
    };
  }

  it('rejects receipt attempt substitution and cross-attempt evidence', () => {
    expect(assessCopyPublicationEvidence(publishedEvidence({ receipt: receiptInput({ attemptId: randomUUID() }) }), validIdentity()))
      .toMatchObject({ classification: 'invalid' });
    const foreignAttempt = publishedEvidence();
    foreignAttempt.identity = { ...identityInput(), attemptId: randomUUID() };
    expect(assessCopyPublicationEvidence(foreignAttempt, validIdentity())).toMatchObject({ classification: 'invalid' });
  });

  it('rejects receipt/destination object-identity mismatch and receipt-plus-absent contradiction', () => {
    expect(assessCopyPublicationEvidence(publishedEvidence({ receipt: receiptInput({ objectIdentity: { deviceId: '9', fileId: '9' } }) }), validIdentity()))
      .toMatchObject({ classification: 'invalid' });
    expect(assessCopyPublicationEvidence(publishedEvidence({ destination: { state: 'absent' } }), validIdentity()))
      .toMatchObject({ classification: 'invalid' });
  });

  it('rejects unknown fields on identity and receipt documents', () => {
    const extraIdentity = identityInput();
    extraIdentity.extra = 1;
    expect(validateCopyPublicationIdentity(extraIdentity).kind).toBe('invalid');
    const extraEvidence = publishedEvidence();
    extraEvidence.extra = 1;
    expect(assessCopyPublicationEvidence(extraEvidence, validIdentity())).toMatchObject({ classification: 'invalid' });
    const extraReceipt = publishedEvidence();
    extraReceipt.receipt = { ...receiptInput(), extra: 1 };
    expect(assessCopyPublicationEvidence(extraReceipt, validIdentity())).toMatchObject({ classification: 'invalid' });
  });

  it('rejects prototype-inherited, __proto__, circular, and scalar inputs without throwing', () => {
    const inherited = Object.create({ ownerJournalOperationId: operationId, version: 1 });
    expect(validateCopyPublicationIdentity(inherited).kind).toBe('invalid');
    expect(validateCopyPublicationIdentity(JSON.parse('{"__proto__":{"admin":true},"format":"nodus-copy-publication-identity","version":1}')).kind).toBe('invalid');
    for (const scalar of [null, undefined, [], 1, 'identity', true]) {
      expect(validateCopyPublicationIdentity(scalar).kind).toBe('invalid');
      expect(['invalid', 'ambiguous']).toContain(assessCopyPublicationEvidence(scalar, validIdentity()).classification);
    }
    const circular: Record<string, unknown> = publishedEvidence();
    circular.identity = circular;
    expect(() => assessCopyPublicationEvidence(circular, validIdentity())).not.toThrow();
    expect(['invalid', 'ambiguous']).toContain(assessCopyPublicationEvidence(circular, validIdentity()).classification);
  });

  it('detects binding drift for every journal field that identifies the copy', () => {
    const identity = validIdentity();
    const base = {
      operationId,
      preparedEventSha256: 'c'.repeat(64),
      vaultInstanceId: identity.vault.instanceId,
      vaultLineageId: identity.vault.lineageId,
      source: { id: sourceId, path: 'notes/source.md', rawSha256: 'a'.repeat(64) },
      destination: { path: 'notes/copy.md', collisionKey: 'notes/copy.md' },
      copy: { id: destinationId, serializedSha256: 'b'.repeat(64), serializedBytes: 128 },
    };
    expect(matchesPreparedCopyIdentity(identity, base)).toBe(true);
    for (const drift of [
      { vaultLineageId: randomUUID() },
      { preparedEventSha256: 'e'.repeat(64) },
      { destination: { path: 'notes/other.md', collisionKey: 'notes/other.md' } },
      { copy: { id: destinationId, serializedSha256: 'f'.repeat(64), serializedBytes: 128 } },
      { copy: { id: destinationId, serializedSha256: 'b'.repeat(64), serializedBytes: 129 } },
      { source: { id: sourceId, path: 'notes/other.md', rawSha256: 'a'.repeat(64) } },
    ]) {
      expect(matchesPreparedCopyIdentity(identity, { ...base, ...drift })).toBe(false);
    }
  });

  it('makes no filesystem call and imports no writer module in either M6.1 contract module', async () => {
    for (const { path, source } of await readM6Sources()) {
      expect(FORBIDDEN_FS_MODULE.test(source), `${path} imports node:fs`).toBe(false);
      expect(FORBIDDEN_FS_CALLS.test(source), `${path} calls a filesystem mutation API`).toBe(false);
      expect(source, `${path} must not stage or publish`).not.toMatch(/stagingDirectory|publishCopy|writeDestination/);
    }
  });
});

describe('Phase 19 M6.1R temporal plausibility contract', () => {
  const prepared = '2026-11-20T00:00:00Z';
  const reference = '2026-11-20T00:01:00Z';

  it('separates malformed timestamps from implausible and merely plausible ones', () => {
    expect(assessCopyPublicationTemporalPlausibility({ preparedRecordedAt: prepared, observedAt: 'nope', referenceTime: reference }).status).toBe('malformed');
    expect(assessCopyPublicationTemporalPlausibility({ preparedRecordedAt: prepared, observedAt: '1970-01-01T00:00:00Z', referenceTime: reference }).status).toBe('not-after-prepared');
    expect(assessCopyPublicationTemporalPlausibility({ preparedRecordedAt: prepared, observedAt: '2100-01-01T00:00:00Z', referenceTime: reference }).status).toBe('future-dated');
    expect(assessCopyPublicationTemporalPlausibility({
      preparedRecordedAt: '2026-11-19T20:00:00Z', observedAt: '2026-11-19T20:00:05Z', referenceTime: reference,
    }).status).toBe('stale');
    const plausible = assessCopyPublicationTemporalPlausibility({ preparedRecordedAt: prepared, observedAt: '2026-11-20T00:00:30Z', referenceTime: reference });
    expect(plausible.status).toBe('plausible-unverified');
    expect(plausible.attested).toBe(false);
  });

  it('keeps stale and future-dated evidence ambiguous rather than resolvable', () => {
    for (const observedAt of ['1970-01-01T00:00:00Z', '2100-01-01T00:00:00Z', '2026-11-20T00:00:30Z']) {
      const evidence = evidenceInput();
      (evidence.provenance as Record<string, unknown>).observedAt = observedAt;
      const result = assessCopyPublicationEvidence(evidence, validIdentity());
      expect(['ambiguous', 'invalid']).toContain(result.classification);
      expect(result.classification).not.toBe('definitely-published');
    }
  });

  it('documents that a receipt cannot authenticate its own observation time', () => {
    const assessment = assessCopyPublicationTemporalPlausibility({ preparedRecordedAt: prepared, observedAt: '2026-11-20T00:00:30Z', referenceTime: reference });
    expect(assessment.attested).toBe(false);
    expect(assessment.detail).toMatch(/nothing here attests/i);
  });
});

describe('Phase 19 M6.1R capability diagnostics', () => {
  it('reports the established target for an uninspectable primitive while still refusing', () => {
    const unknown = assessFilesystemPublicationCapability({
      requested: true, platform: 'darwin', filesystem: 'apfs', primitiveSupport: 'unknown',
    });
    expect(unknown.status).toBe('unavailable');
    expect(unknown).toMatchObject({ target: { platform: 'darwin', filesystem: 'apfs', operation: 'exclusive-create-no-replace' } });
    expect(assessFilesystemPublicationCapability({
      requested: true, platform: null, filesystem: null, primitiveSupport: 'unknown',
    })).toMatchObject({ status: 'unavailable' });
    expect(FILESYSTEM_PUBLICATION_ALLOWLIST).toEqual([]);
    expect(Object.isFrozen(FILESYSTEM_PUBLICATION_ALLOWLIST)).toBe(true);
  });

  it('cannot be satisfied or mutated by any caller-supplied evidence', () => {
    const list = FILESYSTEM_PUBLICATION_ALLOWLIST as unknown as unknown[];
    expect(() => list.push({ platform: 'darwin', filesystem: 'apfs', operation: 'exclusive-create-no-replace' })).toThrow();
    expect(list).toHaveLength(0);
    expect(assessFilesystemPublicationCapability(new Proxy({
      requested: true, platform: 'darwin', filesystem: 'apfs', primitiveSupport: 'supported',
    }, {}))).not.toMatchObject({ status: 'supported' });
  });
});

describe('Phase 19 M6.1R2 journal timestamp domain', () => {
  async function realPublicationFixture() {
    const { preparedEvent, attemptId, identity } = await publishIdentityFromRealJournal();
    const derived = deriveCopyPublicationPreparedEventDigest(preparedEvent);
    if (derived.kind !== 'valid') throw new Error(`real journal digest failed: ${derived.reason}`);
    const preparedEventSha256 = derived.preparedEventSha256;
    function evidenceWith(observedAt: string, overrides: Record<string, unknown> = {}) {
      const body: CopyPublicationReceiptDigestInput = {
        kind: 'exclusive-no-replace-receipt', ownerJournalOperationId: identity.ownerJournalOperationId, attemptId,
        destinationNoteId: identity.destination.noteId, destinationPath: identity.destination.path,
        contentSha256: identity.destination.contentSha256, objectIdentity: { deviceId: '1', fileId: '2' },
      };
      return {
        format: 'nodus-copy-publication-evidence', version: 1, identity,
        provenance: {
          observerId: 'review.probe.v1', observedAt,
          capability: { requested: true, platform: 'darwin', filesystem: 'apfs', primitiveSupport: 'supported' },
        },
        attempt: { state: 'started', preparedEventSha256 },
        source: { state: 'unchanged', observedSha256: identity.source.rawSha256 },
        destination: {
          state: 'matches-expected', noteId: identity.destination.noteId,
          contentSha256: identity.destination.contentSha256, objectIdentity: { deviceId: '1', fileId: '2' },
        },
        receipt: { ...body, receiptSha256: copyPublicationReceiptDigest(body) },
        ...overrides,
      };
    }
    return { preparedEvent, identity, derived, evidenceWith };
  }

  it('accepts the real Prepared recordedAt value in temporal plausibility', async () => {
    const { derived } = await realPublicationFixture();
    expect(derived.recordedAt).toMatch(/\.\d{3}Z$/);
    const observedAt = new Date(Date.parse(derived.recordedAt) + 1_000).toISOString();
    const referenceTime = new Date(Date.parse(observedAt) + 1_000).toISOString();
    const assessment = assessCopyPublicationTemporalPlausibility({
      preparedRecordedAt: derived.recordedAt, observedAt, referenceTime,
    });
    expect(assessment.status).toBe('plausible-unverified');
    expect(assessment.attested).toBe(false);
    const predating = assessCopyPublicationTemporalPlausibility({
      preparedRecordedAt: derived.recordedAt, observedAt: new Date(Date.parse(derived.recordedAt) - 60_000).toISOString(), referenceTime,
    });
    expect(predating.status).toBe('not-after-prepared');
  });

  it('parses evidence whose provenance uses the journal millisecond idiom', async () => {
    const { identity, evidenceWith } = await realPublicationFixture();
    const msEvidence = evidenceWith(new Date().toISOString());
    expect(msEvidence.provenance.observedAt).toMatch(/\.\d{3}Z$/);
    expect(assessCopyPublicationEvidence(msEvidence, identity)).toMatchObject({ classification: 'ambiguous' });

    const secondEvidence = evidenceWith('2026-11-20T00:00:00Z');
    const second = assessCopyPublicationEvidence(secondEvidence, identity);
    expect(second).toMatchObject({ classification: 'ambiguous' });
    // Precision choice never changes the resolution: both stay unresolved and
    // neither is treated as attested or fresh.
    expect(second.classification).toBe(assessCopyPublicationEvidence(msEvidence, identity).classification);
  });

  it.each([
    ['nope', 'free text'],
    ['', 'empty string'],
    ['2026-13-45T99:99:99Z', 'impossible date'],
    ['2026-11-20T00:00:00.1234Z', 'sub-millisecond precision'],
    ['2026-11-20T00:00:00+00:00', 'offset form'],
    ['2026-11-20 00:00:00Z', 'space separator'],
  ])('fails closed on %s (%s)', async (observedAt) => {
    const { identity, evidenceWith } = await realPublicationFixture();
    expect(assessCopyPublicationTemporalPlausibility({
      preparedRecordedAt: observedAt, observedAt: '2026-11-20T00:00:00Z', referenceTime: '2026-11-20T00:00:30Z',
    }).status).toBe('malformed');
    expect(assessCopyPublicationEvidence(evidenceWith(observedAt), identity)).toMatchObject({ classification: 'invalid' });
  });

  it('reports the bounds it applied instead of silently clamping', () => {
    const assessment = assessCopyPublicationTemporalPlausibility({
      preparedRecordedAt: '2026-11-20T00:00:00Z', observedAt: '2026-11-20T00:00:10Z', referenceTime: '2026-11-20T00:00:20Z',
      maxClockSkewMs: -5, maxObservationAgeMs: 400 * 24 * 60 * 60 * 1000,
    });
    expect(assessment.status).toBe('plausible-unverified');
    expect(assessment.detail).toMatch(/Applied bounds: skew=30000ms, maxAge=300000ms/);
  });
});

describe('Phase 19 M6.1R2 path normalization parity', () => {
  const nfc = 'notes/café.md';
  const nfd = nfc.normalize('NFD');

  it('accepts both NFC and NFD spellings, folded to one collision key domain', () => {
    expect(nfc).not.toBe(nfd);
    for (const path of [nfc, nfd]) {
      const input = identityInput();
      input.destination = {
        noteId: destinationId, path, collisionKey: path.normalize('NFC').toLowerCase(),
        contentSha256: 'b'.repeat(64), contentBytes: 128,
      };
      expect(validateCopyPublicationIdentity(input).kind).toBe('valid');
    }
  });

  it('treats NFC and NFD spellings of the same visible path as one identity', () => {
    const input = identityInput();
    input.source = { noteId: sourceId, path: nfc, rawSha256: 'a'.repeat(64) };
    input.destination = {
      noteId: destinationId, path: nfd, collisionKey: nfd.normalize('NFC').toLowerCase(),
      contentSha256: 'b'.repeat(64), contentBytes: 128,
    };
    expect(validateCopyPublicationIdentity(input)).toMatchObject({
      kind: 'invalid', reason: expect.stringMatching(/identities conflict/i),
    });
  });

  it.each([
    ['a case-folded collision key', (path: string) => path.toLowerCase()],
    ['an unfolded collision key', (path: string) => path.normalize('NFD').toLowerCase()],
  ])('rejects %s for an NFD destination', (_label, fold) => {
    const input = identityInput();
    input.destination = {
      noteId: destinationId, path: nfd, collisionKey: fold(nfd),
      contentSha256: 'b'.repeat(64), contentBytes: 128,
    };
    expect(validateCopyPublicationIdentity(input).kind).toBe('invalid');
  });
});

describe('Phase 19 M6.1R2 contract import isolation', () => {
  const WRITER_CAPABLE = /(?:^|\/)(?:atomic|vault|attachments-fs|executor-lock)\.js$|node:fs/;

  function importSpecifiers(source: string): string[] {
    return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1] as string);
  }

  function journalImportNames(source: string): string[] {
    const statement = source.match(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*copy-operation-journal\.js['"]/);
    if (statement === null) return [];
    const clause = statement[1];
    if (clause === undefined) return [];
    return clause.split(',').map((entry) => (entry.trim().split(/\s+as\s+/)[0] ?? '').trim()).filter((entry) => entry.length > 0);
  }

  it('imports no filesystem, writer, or publication module into the contract layer', async () => {
    const allowedJournalImports = new Set(['isCopyJournalTimestamp', 'validateCopyJournalPreparedEvent']);
    for (const { path, source } of await readM6Sources()) {
      const specifiers = importSpecifiers(source);
      expect(specifiers.filter((specifier) => WRITER_CAPABLE.test(specifier)), `${path} imports: ${specifiers.join(', ')}`).toEqual([]);
      for (const name of journalImportNames(source)) {
        expect(allowedJournalImports.has(name), `${path} imports writer-capable journal symbol ${name}`).toBe(true);
      }
      expect(FORBIDDEN_FS_MODULE.test(source), `${path} imports node:fs`).toBe(false);
      expect(FORBIDDEN_FS_CALLS.test(source), `${path} calls a filesystem mutation API`).toBe(false);
    }
  });

  it('contains no reference to a journal writer or atomic publication helper', async () => {
    const forbiddenTokens = ['new CopyOperationJournal', '.prepare(', '.cancel(', 'appendTransition', 'writeEvent(', 'writeFileAtomic', 'linkFileAtomic'];
    for (const { path, source } of await readM6Sources()) {
      for (const token of forbiddenTokens) {
        expect(source.includes(token), `${path} references ${token}`).toBe(false);
      }
    }
  });
});
