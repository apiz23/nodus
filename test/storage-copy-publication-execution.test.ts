import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import * as rootLock from '../src/storage/fs/root-lock.js';
import { withVaultRootLock } from '../src/storage/fs/root-lock.js';
import { CopyOperationJournal, type CopyOperationPlanInput } from '../src/storage/fs/copy-operation-journal.js';
import {
  COPY_PUBLICATION_RECEIPT_DIR,
  COPY_PUBLICATION_STAGING_DIR,
  assertNoUnresolvedPublicationEvidence,
  executeCopyPublication,
  inspectCopyPublicationEvidence,
  type CopyPublicationExecutionDependencies,
} from '../src/storage/fs/copy-publication-execution.js';

const roots: string[] = [];
const now = '2026-11-20T00:00:00Z';
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'nodus-m62-'));
  roots.push(parent);
  const root = join(parent, 'vault');
  await mkdir(root);
  return root;
}

function qualified(): CopyPublicationExecutionDependencies {
  return {
    probe: { requested: true, platform: 'darwin', filesystem: 'apfs', primitiveSupport: 'supported' },
    assessCapability: () => ({ status: 'supported', target: { platform: 'darwin', filesystem: 'apfs', operation: 'exclusive-create-no-replace' } }),
  };
}

const CONTENT_ID = '22222222-2222-4222-8222-222222222222';
const bytesFor = () => Buffer.from(`---\nid: ${CONTENT_ID}\n---\n\nCopy body\n`, 'utf8');

function planInput(bytes: Buffer, destination = 'copy.md'): CopyOperationPlanInput {
  return {
    previewTokenSha256: '1'.repeat(64),
    previewBindingSha256: '2'.repeat(64),
    snapshotSha256: '3'.repeat(64),
    confirmedAt: now,
    source: {
      id: '11111111-1111-4111-8111-111111111111', path: 'source.md', rawSha256: '4'.repeat(64),
      createdAt: now, updatedAt: now,
    },
    destination: { path: destination, collisionKey: destination.normalize('NFC').toLowerCase() },
    copy: {
      id: CONTENT_ID, instant: now,
      serializedSha256: digest(bytes), serializedBytes: bytes.byteLength, noteFormatVersion: 1,
    },
    resolverProjectionSha256: '6'.repeat(64),
  };
}

async function prepareOperation(root: string, bytes: Buffer, destination = 'copy.md') {
  const journal = new CopyOperationJournal(root);
  const prepared = await withVaultRootLock(root, () => journal.prepare(planInput(bytes, destination)));
  return { journal, operationId: prepared.operationId, attemptId: randomUUID() };
}

async function inventory(root: string, relative = ''): Promise<string[]> {
  const directory = relative === '' ? root : join(root, relative);
  const entries: string[] = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) entries.push(`dir:${path}`, ...await inventory(root, path));
    else if (entry.isFile()) entries.push(`file:${path}:${digest(await readFile(join(root, path)))}`);
    else entries.push(`other:${path}`);
  }
  return entries;
}

function publish(root: string, operationId: string, attemptId: string, bytes: Buffer, deps: CopyPublicationExecutionDependencies = qualified()) {
  return executeCopyPublication(root, { operationId, attemptId, serializedBytes: bytes }, deps);
}

describe('Phase 19 M6.2 publication capability gate', () => {
  it('refuses production publication before any filesystem mutation', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { operationId, attemptId } = await prepareOperation(root, bytes);
    const before = await inventory(root);

    await expect(publish(root, operationId, attemptId, bytes, {})).rejects.toMatchObject({ code: 'PUBLICATION_CAPABILITY_REFUSED' });

    expect(await inventory(root)).toEqual(before);
    await expect(lstat(join(root, COPY_PUBLICATION_STAGING_DIR))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(join(root, COPY_PUBLICATION_RECEIPT_DIR))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(root, 'copy.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses unsupported capability without attempting to acquire the vault root lock', async () => {
    const root = await tempRoot();
    const lock = vi.spyOn(rootLock, 'withVaultRootLock');
    try {
      await expect(publish(root, randomUUID(), randomUUID(), bytesFor(), {}))
        .rejects.toMatchObject({ code: 'PUBLICATION_CAPABILITY_REFUSED' });
      expect(lock).not.toHaveBeenCalled();
      await expect(lstat(join(root, rootLock.VAULT_PROCESS_LOCK_FILE))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      lock.mockRestore();
    }
  });

  it('refuses when a qualified-looking probe is still declined by policy', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { operationId, attemptId } = await prepareOperation(root, bytes);
    const before = await inventory(root);
    await expect(publish(root, operationId, attemptId, bytes, {
      probe: { requested: true, platform: 'darwin', filesystem: 'apfs', primitiveSupport: 'supported' },
      assessCapability: () => ({ status: 'not-qualified', reason: 'no allowlist entry', target: { platform: 'darwin', filesystem: 'apfs', operation: 'exclusive-create-no-replace' } }),
    })).rejects.toMatchObject({ code: 'PUBLICATION_CAPABILITY_REFUSED' });
    expect(await inventory(root)).toEqual(before);
  });
});

describe('Phase 19 M6.2 publication execution', () => {
  it('publishes the approved bytes and records durable receipt evidence', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { operationId, attemptId } = await prepareOperation(root, bytes);

    const result = await publish(root, operationId, attemptId, bytes);
    expect(result.kind).toBe('published');
    if (result.kind !== 'published') return;
    expect(result.destinationPath).toBe('copy.md');
    expect(result.contentSha256).toBe(digest(bytes));

    expect((await readFile(join(root, 'copy.md'))).equals(bytes)).toBe(true);
    expect((await lstat(join(root, 'copy.md'))).mode & 0o777).toBe(0o644);

    const receiptPath = join(root, COPY_PUBLICATION_RECEIPT_DIR, operationId, `${attemptId}.json`);
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    expect(receipt).toMatchObject({
      format: 'nodus-copy-publication-receipt', version: 1, operationId, attemptId,
      destination: { path: 'copy.md', noteId: CONTENT_ID, contentBytes: bytes.byteLength },
    });
    expect(receipt.receiptDigestSha256).toBe(result.receiptSha256);

    await expect(lstat(join(root, COPY_PUBLICATION_STAGING_DIR, operationId))).rejects.toMatchObject({ code: 'ENOENT' });
    const evidence = await inspectCopyPublicationEvidence(root);
    expect(evidence.unresolved).toEqual([]);
    expect(evidence.receipts).toEqual([`${operationId}/${attemptId}.json`]);

    const vault = await FileSystemVault.open(root);
    await expect(vault.listCopyOperations()).resolves.toMatchObject([{ operationId, state: 'Prepared' }]);
    await expect(vault.assertNoUnresolvedOperations()).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
  });

  it('is idempotent for an existing valid receipt and never publishes twice', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { operationId, attemptId } = await prepareOperation(root, bytes);
    expect((await publish(root, operationId, attemptId, bytes)).kind).toBe('published');
    const before = await inventory(root);
    expect((await publish(root, operationId, attemptId, bytes)).kind).toBe('already-published');
    expect(await inventory(root)).toEqual(before);
  });

  it('rejects a receipt retry after a case-only rename preserves the destination inode', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { operationId, attemptId } = await prepareOperation(root, bytes);
    expect((await publish(root, operationId, attemptId, bytes)).kind).toBe('published');
    const original = await lstat(join(root, 'copy.md'));
    await rename(join(root, 'copy.md'), join(root, 'Copy.md'));
    const renamed = await lstat(join(root, 'Copy.md'));
    expect(renamed).toMatchObject({ dev: original.dev, ino: original.ino });
    expect(await readdir(root)).not.toContain('copy.md');
    const before = await inventory(root);
    await expect(publish(root, operationId, attemptId, bytes)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    expect(await inventory(root)).toEqual(before);
  });

  it.each(['deleted', 'modified', 'replaced', 'symlink'] as const)('preserves evidence when a previously published destination is %s', async (change) => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { operationId, attemptId } = await prepareOperation(root, bytes);
    expect((await publish(root, operationId, attemptId, bytes)).kind).toBe('published');
    const path = join(root, 'copy.md');
    if (change === 'deleted') await rm(path);
    if (change === 'modified') await writeFile(path, Buffer.alloc(bytes.length, 0x61));
    if (change === 'replaced' || change === 'symlink') {
      await rename(path, join(root, 'original.md'));
      if (change === 'replaced') await writeFile(path, bytes);
      else await symlink('original.md', path);
    }
    const before = await inventory(root);
    await expect(publish(root, operationId, attemptId, bytes)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    expect(await inventory(root)).toEqual(before);
  });

  it.each([
    ['notes', 'Notes'],
    ['café'.normalize('NFD'), 'café'],
  ])('rejects a folded intermediate parent alias %s → %s', async (existing, requested) => {
    const root = await tempRoot();
    const bytes = bytesFor();
    await mkdir(join(root, 'outer', existing, 'inner'), { recursive: true });
    const { operationId, attemptId } = await prepareOperation(root, bytes, `outer/${requested}/inner/copy.md`);
    const before = await inventory(root);
    await expect(publish(root, operationId, attemptId, bytes)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await inventory(root)).toEqual(before);
  });

  it('accepts exact nested parent names', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    await mkdir(join(root, 'Outer', 'Inner'), { recursive: true });
    const { operationId, attemptId } = await prepareOperation(root, bytes, 'Outer/Inner/copy.md');
    expect((await publish(root, operationId, attemptId, bytes)).kind).toBe('published');
    expect(await readFile(join(root, 'Outer/Inner/copy.md'))).toEqual(bytes);
  });

  it.each(['operation', 'attempt'] as const)('blocks a receipt stored under the wrong %s', async (mismatch) => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { operationId, attemptId } = await prepareOperation(root, bytes);
    expect((await publish(root, operationId, attemptId, bytes)).kind).toBe('published');
    const directory = join(root, COPY_PUBLICATION_RECEIPT_DIR, operationId);
    if (mismatch === 'operation') await rename(directory, join(dirname(directory), randomUUID()));
    else await rename(join(directory, `${attemptId}.json`), join(directory, `${randomUUID()}.json`));
    const before = await inventory(root);
    const report = await inspectCopyPublicationEvidence(root);
    expect(report.receipts).toEqual([]);
    expect(report.unresolved).toHaveLength(1);
    await expect(assertNoUnresolvedPublicationEvidence(root)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    expect(await inventory(root)).toEqual(before);
  });

  it('refuses when the destination already exists and leaves no staging residue', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { operationId, attemptId } = await prepareOperation(root, bytes);
    const foreign = Buffer.from('foreign destination bytes');
    await writeFile(join(root, 'copy.md'), foreign, { flag: 'wx' });

    await expect(publish(root, operationId, attemptId, bytes)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await readFile(join(root, 'copy.md'))).toEqual(foreign);
    await expect(lstat(join(root, COPY_PUBLICATION_STAGING_DIR, operationId))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a destination that collides by case with a live sibling', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { operationId, attemptId } = await prepareOperation(root, bytes);
    await writeFile(join(root, 'COPY.md'), 'foreign', { flag: 'wx' });
    await expect(publish(root, operationId, attemptId, bytes)).rejects.toMatchObject({ code: 'CONFLICT' });
    // On a case-insensitive filesystem the sibling *is* `copy.md`; either way the
    // foreign bytes must survive and no publication may occur.
    expect((await readFile(join(root, 'copy.md'))).toString()).toBe('foreign');
  });

  it('refuses a destination that collides by Unicode normalization with a live sibling', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const nfc = 'café.md';
    const nfd = nfc.normalize('NFD');
    const { operationId, attemptId } = await prepareOperation(root, bytes, nfc);
    await writeFile(join(root, nfd), 'foreign', { flag: 'wx' });

    const evidence = await readdir(root);
    expect(evidence.some((name) => name.normalize('NFC').toLowerCase() === nfc)).toBe(true);
    await expect(publish(root, operationId, attemptId, bytes)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses a destination behind a symlinked directory without following it', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { operationId, attemptId } = await prepareOperation(root, bytes, 'linked/copy.md');
    const outside = join(dirname(root), 'outside');
    await mkdir(outside);
    await symlink(outside, join(root, 'linked'), 'dir');

    await expect(publish(root, operationId, attemptId, bytes)).rejects.toMatchObject({ code: 'UNSAFE_PATH' });
    await expect(readFile(join(outside, 'copy.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a missing destination parent instead of creating directories', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { operationId, attemptId } = await prepareOperation(root, bytes, 'missing/copy.md');
    await expect(publish(root, operationId, attemptId, bytes)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(lstat(join(root, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses bytes that differ from the prepared plan and stages nothing', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { operationId, attemptId } = await prepareOperation(root, bytes);
    const before = await inventory(root);
    await expect(publish(root, operationId, attemptId, Buffer.from('different bytes')))
      .rejects.toMatchObject({ code: 'INVALID_CONTENT' });
    expect(await inventory(root)).toEqual(before);
  });

  it('refuses an absent operation', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    await prepareOperation(root, bytes);
    await expect(publish(root, randomUUID(), randomUUID(), bytes)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a cancelled operation', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { journal, operationId, attemptId } = await prepareOperation(root, bytes);
    await withVaultRootLock(root, () => journal.cancel(operationId, async () => true));
    await expect(publish(root, operationId, attemptId, bytes)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('refuses a corrupt operation without staging anything', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { operationId, attemptId } = await prepareOperation(root, bytes);
    await writeFile(join(root, '.nodus-copy-journal', 'operations', operationId, 'event-000000.json'), '{broken');
    await expect(publish(root, operationId, attemptId, bytes)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(lstat(join(root, COPY_PUBLICATION_STAGING_DIR))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed when an existing receipt is unreadable, without touching the destination', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { operationId, attemptId } = await prepareOperation(root, bytes);
    const receiptDir = join(root, COPY_PUBLICATION_RECEIPT_DIR, operationId);
    await mkdir(receiptDir, { recursive: true, mode: 0o700 });
    await writeFile(join(receiptDir, `${attemptId}.json`), 'not-json', { mode: 0o600 });

    await expect(publish(root, operationId, attemptId, bytes)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(readFile(join(root, 'copy.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('treats a receipt from another attempt as unusable evidence', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { operationId, attemptId } = await prepareOperation(root, bytes);
    await publish(root, operationId, attemptId, bytes);
    const secondAttempt = randomUUID();
    const directory = join(root, COPY_PUBLICATION_RECEIPT_DIR, operationId);
    await writeFile(join(directory, `${secondAttempt}.json`), await readFile(join(directory, `${attemptId}.json`)));

    await expect(publish(root, operationId, secondAttempt, bytes)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    expect(await readFile(join(root, 'copy.md'))).toEqual(bytes);
  });

  it('refuses a second attempt while the destination exists, even without a receipt', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { operationId, attemptId } = await prepareOperation(root, bytes);
    await publish(root, operationId, attemptId, bytes);
    await expect(publish(root, operationId, randomUUID(), bytes)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('Phase 19 M6.2 publication evidence and admission', () => {
  it('blocks transfer admission while staging residue exists', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { operationId } = await prepareOperation(root, bytes);
    const vault = await FileSystemVault.open(root);
    const source = createNote({ id: randomUUID(), title: 'Source', path: 'source.md', body: 'Body', now });
    await vault.createNote(source);

    const directory = join(root, COPY_PUBLICATION_STAGING_DIR, operationId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, `${randomUUID()}.stage`), bytes, { mode: 0o600 });
    await writeFile(join(directory, `${randomUUID()}.json`), '{}', { mode: 0o600 });

    const evidence = await inspectCopyPublicationEvidence(root);
    expect(evidence.unresolved[0]).toMatch(/interrupted or in-progress publication staging/i);

    await expect(vault.assertNoUnresolvedOperations()).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(vault.recoverCopyOperations()).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(vault.cancelPreparedCopyOperation(operationId)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(vault.previewNoteCopy(source.id, 'other.md')).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
  });

  it('treats an unsafe staging root as unresolved evidence', async () => {
    const root = await tempRoot();
    const outside = join(dirname(root), 'outside-staging');
    await mkdir(outside);
    await symlink(outside, join(root, COPY_PUBLICATION_STAGING_DIR), 'dir');
    const evidence = await inspectCopyPublicationEvidence(root);
    expect(evidence.unresolved[0]).toMatch(/not a private regular directory/i);
    const vault = await FileSystemVault.open(root);
    await expect(vault.assertNoUnresolvedOperations()).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
  });

  it('treats a lone descriptor (crash before receipt) as unresolved evidence', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { operationId, attemptId } = await prepareOperation(root, bytes);
    const directory = join(root, COPY_PUBLICATION_STAGING_DIR, operationId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(join(directory, `${attemptId}.json`), '{"format":"nodus-copy-publication-staging"}', { mode: 0o600 });
    const evidence = await inspectCopyPublicationEvidence(root);
    expect(evidence.unresolved.length).toBe(1);
    const vault = await FileSystemVault.open(root);
    await expect(vault.assertNoUnresolvedOperations()).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
  });

  it('treats unrecognized staging entries as unresolved rather than ignoring them', async () => {
    const root = await tempRoot();
    await mkdir(join(root, COPY_PUBLICATION_STAGING_DIR), { recursive: true, mode: 0o700 });
    await writeFile(join(root, COPY_PUBLICATION_STAGING_DIR, 'not-a-uuid'), 'x', { mode: 0o600 });
    const evidence = await inspectCopyPublicationEvidence(root);
    expect(evidence.unresolved.join(' ')).toMatch(/unrecognized staging entry/i);
  });

  it('leaves untouched vaults fully admissible', async () => {
    const root = await tempRoot();
    const vault = await FileSystemVault.open(root);
    await vault.createNote(createNote({ id: randomUUID(), title: 'Plain', path: 'plain.md', body: 'Body', now }));
    await expect(vault.assertNoUnresolvedOperations()).resolves.toBeUndefined();
    expect(await inspectCopyPublicationEvidence(root)).toMatchObject({ unresolved: [], receipts: [], issuesTruncated: false });
  });
});

describe('Phase 19 M6.2 boundaries', () => {
  it('is not exported from package or storage barrels', async () => {
    const rootFile = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    const barrel = await readFile(new URL('../src/storage/index.ts', import.meta.url), 'utf8');
    for (const name of ['executeCopyPublication', 'inspectCopyPublicationEvidence', 'assertNoUnresolvedPublicationEvidence', 'COPY_PUBLICATION_STAGING_DIR']) {
      expect(rootFile.includes(name), `package root exports ${name}`).toBe(false);
      expect(barrel.includes(name), `storage barrel exports ${name}`).toBe(false);
    }
  });

  it('reads the durable Prepared record with its canonical digest', async () => {
    const root = await tempRoot();
    const bytes = bytesFor();
    const { journal, operationId } = await prepareOperation(root, bytes);
    const read = await withVaultRootLock(root, () => journal.readPreparedEvent(operationId));
    expect(read.kind).toBe('valid');
    if (read.kind !== 'valid') return;
    const stored = JSON.parse(await readFile(join(root, '.nodus-copy-journal', 'operations', operationId, 'event-000000.json'), 'utf8'));
    expect(read.event.digestSha256).toBe(stored.sha256);
    expect(read.event.plan.destination.path).toBe('copy.md');

    expect(await withVaultRootLock(root, () => journal.readPreparedEvent(randomUUID())))
      .toMatchObject({ kind: 'invalid', code: 'NOT_FOUND' });
    expect(await withVaultRootLock(root, () => journal.readPreparedEvent('not-a-uuid')))
      .toMatchObject({ kind: 'invalid', code: 'INVALID_INPUT' });
  });
});
