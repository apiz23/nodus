import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CopyOperationJournal, type CopyOperationPlanInput } from '../src/storage/fs/copy-operation-journal.js';
import { withVaultRootLock } from '../src/storage/fs/root-lock.js';
import {
  assessCopyPublicationEvidence,
  copyPublicationReceiptDigest,
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

  it('does not classify internally consistent receipt evidence as publication without a trusted verifier', () => {
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

  it('refuses capability without trying a filesystem write or overwrite fallback', async () => {
    const before = await createVaultRoot();
    await expect(Promise.resolve().then(() => requireFilesystemPublicationCapability({
      requested: true, platform: 'darwin', filesystem: 'apfs', primitiveSupport: 'supported',
    }))).rejects.toMatchObject({ code: 'PUBLICATION_CAPABILITY_REFUSED' });
    await expect(Promise.resolve().then(() => requireFilesystemPublicationCapability({
      requested: true, platform: 'linux', filesystem: 'ext4', primitiveSupport: 'supported',
    }))).rejects.toThrow(/not-qualified/);
    await expect(readFile(join(before, 'copy.md'))).rejects.toMatchObject({ code: 'ENOENT' });
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
