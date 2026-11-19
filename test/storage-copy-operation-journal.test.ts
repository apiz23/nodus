import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, copyFile, symlink, lstat, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { serializeNote } from '../src/format/note-format.js';
import { createImportPreviewSnapshot, planImport } from '../src/storage/portable/import.js';
import type { ImportConflictDecision } from '../src/storage/portable/preview-session.js';
import { createBackup, previewRestore, restoreBackup } from '../src/storage/backup/backup.js';
import { exportVault } from '../src/storage/portable/export.js';
import {
  CopyOperationJournal,
  COPY_OPERATION_JOURNAL_DIR,
  isLegalCopyOperationTransition,
  type CopyOperationPlanInput,
  type CopyOperationState,
  type CopyJournalBudget,
} from '../src/storage/fs/copy-operation-journal.js';
import { VAULT_PROCESS_LOCK_FILE, withVaultRootLock } from '../src/storage/fs/root-lock.js';
import { IMPORT_TRANSACTION_DIR, TEMP_PREFIX } from '../src/storage/fs/layout.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';

const roots: string[] = [];
const now = '2026-11-17T00:00:00Z';
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempRoot(prefix = 'nodus-copy-journal-') {
  const parent = await mkdtemp(join(tmpdir(), prefix));
  roots.push(parent);
  const root = join(parent, 'vault');
  await mkdir(root);
  return { parent, root };
}

async function createIdentityOnlyJournal(root: string): Promise<Buffer> {
  const journalRoot = join(root, COPY_OPERATION_JOURNAL_DIR);
  await mkdir(journalRoot, { mode: 0o700 });
  const body = {
    format: 'nodus-copy-journal-vault',
    version: 1,
    vaultInstanceId: randomUUID(),
    vaultLineageId: randomUUID(),
    createdAt: now,
  };
  const bytes = Buffer.from(`${JSON.stringify({ ...body, sha256: digest(JSON.stringify(body)) })}\n`);
  await writeFile(join(journalRoot, 'vault.json'), bytes, { flag: 'wx', mode: 0o600 });
  return bytes;
}

function planInput(overrides: Partial<CopyOperationPlanInput> = {}): CopyOperationPlanInput {
  return {
    previewTokenSha256: '1'.repeat(64),
    previewBindingSha256: '2'.repeat(64),
    snapshotSha256: '3'.repeat(64),
    confirmedAt: now,
    source: { id: '11111111-1111-4111-8111-111111111111', path: 'source.md', rawSha256: '4'.repeat(64), createdAt: now, updatedAt: now },
    destination: { path: 'copy.md', collisionKey: 'copy.md' },
    copy: { id: '22222222-2222-4222-8222-222222222222', instant: now, serializedSha256: '5'.repeat(64), serializedBytes: 128, noteFormatVersion: 1 },
    resolverProjectionSha256: '6'.repeat(64),
    ...overrides,
  };
}

async function underLock<T>(root: string, callback: () => Promise<T>): Promise<T> {
  return withVaultRootLock(root, callback);
}

function journal(root: string, faultInjector?: (point: string, path: string) => void | Promise<void>) {
  return new CopyOperationJournal(root, faultInjector === undefined ? {} : { faultInjector: faultInjector as never });
}

async function prepare(root: string, input = planInput()) {
  return underLock(root, () => journal(root).prepare(input));
}

function operationDirectory(root: string, operationId: string) {
  return join(root, COPY_OPERATION_JOURNAL_DIR, 'operations', operationId);
}

async function writeRecoveryRequiredImportJournal(root: string) {
  const operationId = randomUUID();
  const directory = join(root, IMPORT_TRANSACTION_DIR, operationId);
  await mkdir(join(directory, 'staged'), { recursive: true, mode: 0o700 });
  await mkdir(join(directory, 'backup'), { recursive: true, mode: 0o700 });
  const journal = {
    format: 'nodus-import-transaction',
    version: 1,
    operationId,
    state: 'recovery-required',
    sourceFingerprint: 'a'.repeat(64),
    destinationFingerprint: 'b'.repeat(64),
    startedAt: now,
    updatedAt: now,
    files: [],
    decisions: [],
    folders: [],
    baselineResources: [],
    baselineFolders: [],
    baselineExcluded: [],
    failure: { code: 'RECOVERY_REQUIRED', message: 'Test recovery-required state.' },
  };
  const bytes = Buffer.from(`${JSON.stringify({ ...journal, integritySha256: digest(JSON.stringify(journal))})}\n`);
  const path = join(directory, 'journal.json');
  await writeFile(path, bytes, { mode: 0o600 });
  return { operationId, directory, path, bytes };
}

async function vaultInventory(root: string, relative = ''): Promise<string[]> {
  const directory = relative === '' ? root : join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const inventory: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      inventory.push(`directory:${path}`);
      inventory.push(...await vaultInventory(root, path));
    } else if (entry.isFile()) {
      inventory.push(`file:${path}:${digest(await readFile(join(root, path)))}`);
    } else {
      inventory.push(`${entry.isSymbolicLink() ? 'symlink' : 'other'}:${path}`);
    }
  }
  return inventory;
}

async function readEvents(root: string, operationId: string): Promise<Record<string, any>[]> {
  const directory = operationDirectory(root, operationId);
  const names = (await readdir(directory)).sort();
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(join(directory, name), 'utf8')) as Record<string, any>));
}

async function appendSyntheticEvent(
  root: string,
  operationId: string,
  state: CopyOperationState,
  evidence: Record<string, unknown>,
): Promise<Record<string, any>> {
  const events = await readEvents(root, operationId);
  const previous = events.at(-1)!;
  const body = {
    format: 'nodus-copy-operation-event',
    version: 1,
    operationId,
    vaultInstanceId: previous.vaultInstanceId,
    vaultLineageId: previous.vaultLineageId,
    sequence: previous.sequence + 1,
    state,
    recordedAt: now,
    previousSha256: previous.sha256,
    evidence: Object.fromEntries(Object.keys(evidence).sort().map((key) => [key, evidence[key]])),
  };
  const event = { ...body, sha256: digest(JSON.stringify(body)) };
  const file = join(operationDirectory(root, operationId), `event-${String(event.sequence).padStart(6, '0')}.json`);
  await writeFile(file, `${JSON.stringify(event)}\n`, { flag: 'wx', mode: 0o600 });
  return event;
}

async function addPublishing(root: string, operationId: string) {
  const plan = (await readEvents(root, operationId))[0]!.plan;
  const intent = await appendSyntheticEvent(root, operationId, 'Publishing', {
    kind: 'publication-intent', destinationPath: plan.destination.path, expectedSha256: plan.copy.serializedSha256,
  });
  return { plan, intent };
}

async function addPublished(root: string, operationId: string) {
  const { plan } = await addPublishing(root, operationId);
  return appendSyntheticEvent(root, operationId, 'Published', {
    kind: 'publication-receipt', destinationPath: plan.destination.path, sha256: plan.copy.serializedSha256,
    dev: '1', ino: '2', ownershipEvidenceSha256: '7'.repeat(64),
  });
}

async function addSucceeded(root: string, operationId: string) {
  const published = await addPublished(root, operationId);
  return appendSyntheticEvent(root, operationId, 'Succeeded', { kind: 'terminal-receipt', publishedEventSha256: published.sha256 });
}

async function writeCancellationTemporary(root: string, operationId: string, overrides: {
  name?: string;
  bytes?: Buffer;
  state?: CopyOperationState;
  sequenceOffset?: number;
  previousSha256?: string;
} = {}): Promise<string> {
  const events = await readEvents(root, operationId);
  const previous = events.at(-1)!;
  const body = {
    format: 'nodus-copy-operation-event',
    version: 1,
    operationId,
    vaultInstanceId: previous.vaultInstanceId,
    vaultLineageId: previous.vaultLineageId,
    sequence: previous.sequence + (overrides.sequenceOffset ?? 1),
    state: overrides.state ?? 'Cancelled',
    recordedAt: now,
    previousSha256: overrides.previousSha256 ?? previous.sha256,
    evidence: { kind: 'no-publication' },
  };
  const bytes = overrides.bytes ?? Buffer.from(`${JSON.stringify({ ...body, sha256: digest(JSON.stringify(body)) })}\n`);
  const name = overrides.name ?? `${TEMP_PREFIX}${randomUUID()}`;
  const path = join(operationDirectory(root, operationId), name);
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
  return path;
}

async function temporaryArtifacts(root: string, operationId: string): Promise<string[]> {
  const names = await readdir(operationDirectory(root, operationId));
  return names.filter((name) => name.startsWith(TEMP_PREFIX) && /^[0-9a-f-]{36}$/.test(name.slice(TEMP_PREFIX.length)));
}

async function interruptCancellationInChild(root: string, operationId: string): Promise<void> {
  const child = `
    import { createServer } from 'vite';
    const [root, operationId] = process.argv.slice(1);
    const vite = await createServer({ configFile: false, server: { middlewareMode: true, ws: false } });
    const { CopyOperationJournal } = await vite.ssrLoadModule('/src/storage/fs/copy-operation-journal.ts');
    const { withVaultRootLock } = await vite.ssrLoadModule('/src/storage/fs/root-lock.ts');
    await withVaultRootLock(root, () => new CopyOperationJournal(root, {
      faultInjector(point) {
        if (point === 'before-cancellation-publish') process.exit(77);
      },
    }).cancel(operationId, async () => true));
    process.exit(78);
  `;
  await expect(promisify(execFile)(process.execPath, ['--input-type=module', '-e', child, root, operationId], {
    timeout: 15_000,
  })).rejects.toMatchObject({ code: 77 });
  // The child is confirmed stopped and this temporary vault has no other writers.
  await rm(join(root, VAULT_PROCESS_LOCK_FILE));
}

async function clonePreparedRecord(root: string, operationId: string): Promise<string> {
  const newId = randomUUID();
  const events = await readEvents(root, operationId);
  const record = events[0]!;
  record.operationId = newId;
  record.plan.operationId = newId;
  record.plan.previewTokenSha256 = 'd'.repeat(64);
  delete record.sha256;
  record.sha256 = digest(JSON.stringify(record));
  const directory = operationDirectory(root, newId);
  await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, 'event-000000.json'), `${JSON.stringify(record)}\n`, { mode: 0o600 });
  return newId;
}

describe('copy operation journal state machine', () => {
  it('fails closed for a valid existing identity with no operations directory or known operation', async () => {
    const { root } = await tempRoot();
    const identity = await createIdentityOnlyJournal(root);
    let report: unknown;

    await expect(underLock(root, async () => { report = await journal(root).recover(async () => true); }))
      .rejects.toMatchObject({ code: 'PARTIAL_WRITE', path: 'operations' });

    expect(report).toBeUndefined();
    expect(await readFile(join(root, COPY_OPERATION_JOURNAL_DIR, 'vault.json'))).toEqual(identity);
    await expect(readdir(join(root, COPY_OPERATION_JOURNAL_DIR, 'operations'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(underLock(root, () => journal(root).assertNoUnresolved())).rejects.toThrow('unsafe or corrupt');
  });

  it('preserves a Prepared journal identity and never recreates missing operations on repeated recovery or prepare', async () => {
    const { root } = await tempRoot();
    const prepared = await prepare(root);
    const identityPath = join(root, COPY_OPERATION_JOURNAL_DIR, 'vault.json');
    const identity = await readFile(identityPath);
    const operationsPath = join(root, COPY_OPERATION_JOURNAL_DIR, 'operations');
    await rm(operationsPath, { recursive: true });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(underLock(root, () => journal(root).recover(async () => true)))
        .rejects.toMatchObject({ code: 'PARTIAL_WRITE', path: 'operations' });
      await expect(underLock(root, () => journal(root).assertNoUnresolved())).rejects.toThrow('unsafe or corrupt');
      await expect(prepare(root, planInput({ previewTokenSha256: 'a'.repeat(64) })))
        .rejects.toMatchObject({ code: 'PARTIAL_WRITE', path: 'operations' });
      expect(await readFile(identityPath)).toEqual(identity);
      await expect(readdir(operationsPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }

    expect(prepared.state).toBe('Prepared');
  });

  it('keeps concurrent recovery attempts fail-closed when the operations directory is missing', async () => {
    const { root } = await tempRoot();
    const identity = await createIdentityOnlyJournal(root);
    const outcomes = await Promise.allSettled([
      underLock(root, () => journal(root).recover(async () => true)),
      underLock(root, () => journal(root).recover(async () => true)),
    ]);

    expect(outcomes).toHaveLength(2);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe('rejected');
      if (outcome.status === 'rejected') expect(outcome.reason).toMatchObject({ code: 'PARTIAL_WRITE', path: 'operations' });
    }
    expect(await readFile(join(root, COPY_OPERATION_JOURNAL_DIR, 'vault.json'))).toEqual(identity);
    await expect(readdir(join(root, COPY_OPERATION_JOURNAL_DIR, 'operations'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed when operations disappears after root enumeration and blocks later confirmation and transfer', async () => {
    const { root } = await tempRoot('nodus-copy-disappearing-operations-');
    const vault = await FileSystemVault.open(root);
    const source = createNote({ id: randomUUID(), title: 'Source', path: 'source.md', body: 'Preserve me', now });
    await vault.createNote(source);
    const sourceBytes = await readFile(join(root, source.path));
    const secondPreview = await vault.previewNoteCopy(source.id, 'copy.md');
    const prepared = await prepare(root);
    const confirmation = { state: prepared.state };
    const identityPath = join(root, COPY_OPERATION_JOURNAL_DIR, 'vault.json');
    const identity = await readFile(identityPath);
    const operationsPath = join(root, COPY_OPERATION_JOURNAL_DIR, 'operations');
    let removed = false;
    let report: unknown;
    const disappearing = journal(root, async (point) => {
      if (point === 'after-operations-root-enumerated' && !removed) {
        removed = true;
        await rm(operationsPath, { recursive: true });
      }
    });

    await expect(underLock(root, async () => { report = await disappearing.recover(async () => true); }))
      .rejects.toMatchObject({ code: 'PARTIAL_WRITE', path: 'operations' });
    expect(removed).toBe(true);
    expect(report).toBeUndefined();
    await expect(vault.recoverCopyOperations()).rejects.toMatchObject({ code: 'PARTIAL_WRITE', path: 'operations' });
    await expect(vault.confirmNoteCopy(secondPreview.token)).rejects.toMatchObject({ code: 'PARTIAL_WRITE', path: 'operations' });
    await expect(vault.snapshotForPortableExport()).rejects.toMatchObject({ code: 'PARTIAL_WRITE', path: 'operations' });
    expect(await readFile(identityPath)).toEqual(identity);
    expect(await readFile(join(root, source.path))).toEqual(sourceBytes);
    await expect(readdir(operationsPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(root, 'copy.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(confirmation.state).toBe('Prepared');
  });

  it.each(['symlink', 'file'] as const)('rejects an operations path replaced by a %s', async (replacement) => {
    const { root, parent } = await tempRoot();
    const identity = await createIdentityOnlyJournal(root);
    const operationsPath = join(root, COPY_OPERATION_JOURNAL_DIR, 'operations');
    if (replacement === 'symlink') {
      const outside = join(parent, 'outside-operations');
      await mkdir(outside, { mode: 0o700 });
      await symlink(outside, operationsPath, 'dir');
    } else {
      await writeFile(operationsPath, 'foreign', { mode: 0o600 });
    }

    await expect(underLock(root, () => journal(root).recover(async () => true)))
      .rejects.toMatchObject({ code: 'PARTIAL_WRITE', path: 'operations' });
    expect(await readFile(join(root, COPY_OPERATION_JOURNAL_DIR, 'vault.json'))).toEqual(identity);
    if (replacement === 'symlink') expect((await readdir(operationsPath))).toEqual([]);
    else expect(await readFile(operationsPath, 'utf8')).toBe('foreign');
  });

  it('distinguishes malformed identity from a valid identity missing operations without repairing either', async () => {
    const { root } = await tempRoot();
    const journalRoot = join(root, COPY_OPERATION_JOURNAL_DIR);
    await mkdir(journalRoot, { mode: 0o700 });
    const malformed = Buffer.from('{"format":"nodus-copy-journal-vault"}\n');
    await writeFile(join(journalRoot, 'vault.json'), malformed, { mode: 0o600 });

    await expect(underLock(root, () => journal(root).recover(async () => true)))
      .rejects.toThrow(/vault identity checksum or fields are invalid/i);
    expect(await readFile(join(journalRoot, 'vault.json'))).toEqual(malformed);
    await expect(readdir(join(journalRoot, 'operations'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('still initializes operations for a genuinely new vault journal', async () => {
    const { root } = await tempRoot();
    const prepared = await prepare(root);
    expect(prepared.state).toBe('Prepared');
    expect((await readdir(join(root, COPY_OPERATION_JOURNAL_DIR))).sort()).toEqual(['operations', 'vault.json']);
    expect(await readdir(join(root, COPY_OPERATION_JOURNAL_DIR, 'operations'))).toEqual([prepared.operationId]);
  });

  it('blocks confirmation and transfer checks when an existing identity is missing operations', async () => {
    const { root } = await tempRoot('nodus-copy-missing-operations-');
    const vault = await FileSystemVault.open(root);
    const source = createNote({ id: randomUUID(), title: 'Source', path: 'source.md', body: 'Keep unchanged', now });
    await vault.createNote(source);
    const sourceBytes = await readFile(join(root, source.path));
    const preview = await vault.previewNoteCopy(source.id, 'copy.md');
    const identity = await createIdentityOnlyJournal(root);

    await expect(vault.confirmNoteCopy(preview.token)).rejects.toMatchObject({ code: 'PARTIAL_WRITE', path: 'operations' });
    await expect(vault.assertNoUnresolvedCopyOperations()).rejects.toMatchObject({ code: 'PARTIAL_WRITE', path: 'operations' });
    await expect(vault.snapshotForPortableExport()).rejects.toMatchObject({ code: 'PARTIAL_WRITE', path: 'operations' });
    expect(await readFile(join(root, source.path))).toEqual(sourceBytes);
    expect(await readFile(join(root, COPY_OPERATION_JOURNAL_DIR, 'vault.json'))).toEqual(identity);
    await expect(readdir(join(root, COPY_OPERATION_JOURNAL_DIR, 'operations'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(root, 'copy.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('accepts only the specified state transitions', () => {
    const states: CopyOperationState[] = ['Prepared', 'Publishing', 'Published', 'Succeeded', 'Failed', 'NeedsReview', 'Cancelled'];
    const legal = new Set([
      'Prepared->Cancelled', 'Prepared->Publishing', 'Prepared->Failed', 'Prepared->NeedsReview',
      'Publishing->Published', 'Publishing->Failed', 'Publishing->NeedsReview',
      'Published->Succeeded', 'Published->NeedsReview',
    ]);
    for (const from of states) for (const to of states) {
      expect(isLegalCopyOperationTransition(from, to), `${from} -> ${to}`).toBe(legal.has(`${from}->${to}`));
    }
  });

  it('persists a detached immutable Prepared plan and recovers it without publishing', async () => {
    const { root } = await tempRoot();
    const input = planInput() as CopyOperationPlanInput & { source: { id: string; path: string; rawSha256: string; createdAt: string; updatedAt: string } };
    const result = await prepare(root, input);
    input.source.path = 'mutated-after-prepare.md';
    const eventBytes = await readFile(join(operationDirectory(root, result.operationId), 'event-000000.json'));
    const event = JSON.parse(eventBytes.toString()) as { plan: CopyOperationPlanInput; sha256: string };
    expect(event.plan.source.path).toBe('source.md');
    expect(eventBytes.toString()).not.toContain('raw-preview-token');
    expect(event.sha256).toBe(digest(JSON.stringify(Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'sha256')))));

    let validated: CopyOperationPlanInput | undefined;
    const report = await underLock(root, () => journal(root).recover(async (plan) => { validated = plan; return true; }));
    expect(report).toMatchObject({ scanned: 1, prepared: 1, terminal: 0, needsReview: 0, unresolved: true });
    expect(validated?.source.path).toBe('source.md');
    expect((await readEvents(root, result.operationId)).map((record) => record.state)).toEqual(['Prepared']);
    await expect(underLock(root, () => journal(root).assertNoUnresolved())).rejects.toThrow('blocks this action');
  });

  it('can retry cancellation when interrupted before terminal-event publication', async () => {
    const { root } = await tempRoot();
    const { operationId } = await prepare(root);
    const interrupted = journal(root, (point) => {
      if (point === 'before-cancellation-publish') throw new Error('injected cancellation interruption');
    });
    await expect(underLock(root, () => interrupted.cancel(operationId, async () => true))).rejects.toThrow('interruption');
    expect((await readEvents(root, operationId)).map((event) => event.state)).toEqual(['Prepared']);
    await expect(underLock(root, () => journal(root).cancel(operationId, async () => true))).resolves.toMatchObject({ state: 'Cancelled' });
  });

  it('preserves a terminal-event path that was occupied before cancellation inspection', async () => {
    const { root } = await tempRoot();
    const { operationId } = await prepare(root);
    const eventPath = join(operationDirectory(root, operationId), 'event-000001.json');
    const foreignBytes = Buffer.from('foreign terminal evidence\n');
    await writeFile(eventPath, foreignBytes, { flag: 'wx', mode: 0o600 });
    const vault = await FileSystemVault.open(root);

    await expect(vault.cancelPreparedCopyOperation(operationId)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    expect(await readFile(eventPath)).toEqual(foreignBytes);
    // A fresh operation can reacquire the lock after cancellation rejects.
    await expect(vault.listCopyOperations()).resolves.toMatchObject([{ operationId, state: 'Corrupt' }]);
    await expect(vault.assertNoUnresolvedOperations()).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
  });

  it('does not replace a terminal event created between inspection and cancellation publication', async () => {
    const { root } = await tempRoot();
    const { operationId } = await prepare(root);
    const eventPath = join(operationDirectory(root, operationId), 'event-000001.json');
    const foreignBytes = Buffer.from('raced foreign terminal evidence\n');
    const racing = journal(root, async (point, temporaryPath) => {
      if (point === 'before-cancellation-publish') {
        await writeFile(join(dirname(temporaryPath), 'event-000001.json'), foreignBytes, { flag: 'wx', mode: 0o600 });
      }
    });

    await expect(underLock(root, () => racing.cancel(operationId, async () => true)))
      .rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    expect(await readFile(eventPath)).toEqual(foreignBytes);
    // The operation is corrupt/ambiguous, never falsely reported as Cancelled.
    await expect(underLock(root, () => journal(root).list())).resolves.toMatchObject([{ operationId, state: 'Corrupt' }]);
  });

  it('recovers a Prepared operation after cancellation exits before publication', async () => {
    const { root } = await tempRoot();
    const { operationId } = await prepare(root);
    await interruptCancellationInChild(root, operationId);

    const operationPath = operationDirectory(root, operationId);
    const artifacts = await temporaryArtifacts(root, operationId);
    expect(artifacts).toHaveLength(1);
    await expect(underLock(root, () => journal(root).list())).resolves.toMatchObject([{ operationId, state: 'Prepared' }]);
    await expect(underLock(root, () => journal(root).cancel(operationId, async () => true))).resolves.toMatchObject({ state: 'Cancelled' });
    // Recovery ignores but deliberately retains the unowned crash artifact.
    await expect(underLock(root, () => journal(root).list())).resolves.toMatchObject([{ operationId, state: 'Cancelled' }]);
    expect((await readdir(operationPath)).filter((name) => artifacts.includes(name))).toEqual(artifacts);
  }, 20_000);

  it('recognizes a genuine interrupted cancellation temporary file and preserves it', async () => {
    const { root } = await tempRoot('nodus-copy-temp-genuine-');
    const { operationId } = await prepare(root);
    await interruptCancellationInChild(root, operationId);

    const artifacts = await temporaryArtifacts(root, operationId);
    expect(artifacts).toHaveLength(1);
    const artifactPath = join(operationDirectory(root, operationId), artifacts[0]!);
    const artifactBytes = await readFile(artifactPath);
    const inventoryBefore = await vaultInventory(root);

    await expect(underLock(root, () => journal(root).list())).resolves.toMatchObject([{ operationId, state: 'Prepared' }]);
    await expect(underLock(root, () => journal(root).assertNoUnresolved())).rejects.toThrow('blocks this action');
    await expect(underLock(root, () => journal(root).recover(async () => true)))
      .resolves.toMatchObject({ prepared: 1, needsReview: 0, terminal: 0, unresolved: true });
    expect(await readFile(artifactPath)).toEqual(artifactBytes);
    expect(await vaultInventory(root)).toEqual(inventoryBefore);
  }, 20_000);

  it('keeps a hard-linked leftover from a crash after publication blocked and untouched', async () => {
    const { root } = await tempRoot('nodus-copy-temp-hardlink-');
    const { operationId } = await prepare(root);
    const artifactPath = await writeCancellationTemporary(root, operationId);
    await link(artifactPath, join(operationDirectory(root, operationId), 'event-000001.json'));
    const inventoryBefore = await vaultInventory(root);

    await expect(underLock(root, () => journal(root).list()))
      .resolves.toMatchObject([{ operationId, state: 'Corrupt' }]);
    await expect(underLock(root, () => journal(root).assertNoUnresolved())).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(underLock(root, () => journal(root).recover(async () => true)))
      .resolves.toMatchObject({ terminal: 0, needsReview: 1, unresolved: true });
    expect((await lstat(artifactPath)).nlink).toBe(2);
    expect(await vaultInventory(root)).toEqual(inventoryBefore);
  });

  it('treats a matching-name directory as suspicious journal evidence and preserves it', async () => {
    const { root } = await tempRoot('nodus-copy-temp-directory-');
    const { operationId } = await prepare(root);
    const artifactName = `${TEMP_PREFIX}${randomUUID()}`;
    const artifactPath = join(operationDirectory(root, operationId), artifactName);
    await mkdir(artifactPath, { mode: 0o700 });
    const inventoryBefore = await vaultInventory(root);

    await expect(underLock(root, () => journal(root).list()))
      .resolves.toMatchObject([{ operationId, state: 'Corrupt', issue: expect.stringMatching(/temporary artifact/i) }]);
    await expect(underLock(root, () => journal(root).assertNoUnresolved())).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(underLock(root, () => journal(root).recover(async () => true)))
        .resolves.toMatchObject({ terminal: 0, needsReview: 1, unresolved: true });
    }
    expect((await lstat(artifactPath)).isDirectory()).toBe(true);
    expect(await vaultInventory(root)).toEqual(inventoryBefore);
    await expect(underLock(root, () => journal(root).list())).resolves.toMatchObject([{ state: 'Corrupt' }]);
    await expect(readFile(join(root, VAULT_PROCESS_LOCK_FILE), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('treats a matching-name symlink as suspicious journal evidence without following or altering it', async () => {
    const { parent, root } = await tempRoot('nodus-copy-temp-symlink-');
    const { operationId } = await prepare(root);
    const target = join(parent, 'foreign-target');
    const foreignBytes = Buffer.from('foreign symlink target\n');
    await writeFile(target, foreignBytes, { mode: 0o600 });
    const artifactPath = join(operationDirectory(root, operationId), `${TEMP_PREFIX}${randomUUID()}`);
    await symlink(target, artifactPath, 'file');
    const inventoryBefore = await vaultInventory(root);

    await expect(underLock(root, () => journal(root).list()))
      .resolves.toMatchObject([{ operationId, state: 'Corrupt', issue: expect.stringMatching(/temporary artifact/i) }]);
    await expect(underLock(root, () => journal(root).assertNoUnresolved())).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(underLock(root, () => journal(root).recover(async () => true)))
      .resolves.toMatchObject({ needsReview: 1, unresolved: true });
    expect((await lstat(artifactPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(target)).toEqual(foreignBytes);
    expect(await vaultInventory(root)).toEqual(inventoryBefore);
  });

  it('treats a matching-name malformed file as suspicious journal evidence and preserves its bytes', async () => {
    const { root } = await tempRoot('nodus-copy-temp-malformed-');
    const { operationId } = await prepare(root);
    const validBytes = await readFile(await writeCancellationTemporary(root, operationId));
    const artifactPath = await writeCancellationTemporary(root, operationId, {
      bytes: validBytes.subarray(0, Math.floor(validBytes.length / 2)),
    });
    const artifactBytes = await readFile(artifactPath);
    const inventoryBefore = await vaultInventory(root);

    await expect(underLock(root, () => journal(root).list()))
      .resolves.toMatchObject([{ operationId, state: 'Corrupt', issue: expect.stringMatching(/temporary artifact/i) }]);
    await expect(underLock(root, () => journal(root).assertNoUnresolved())).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(underLock(root, () => journal(root).recover(async () => true)))
      .resolves.toMatchObject({ needsReview: 1, unresolved: true });
    expect(await readFile(artifactPath)).toEqual(artifactBytes);
    expect(await vaultInventory(root)).toEqual(inventoryBefore);
  });

  it('treats a matching-name unrelated journal record as suspicious evidence and preserves it', async () => {
    const { root } = await tempRoot('nodus-copy-temp-unrelated-');
    const { operationId } = await prepare(root);
    const planEventBytes = await readFile(join(operationDirectory(root, operationId), 'event-000000.json'));
    const artifactPath = await writeCancellationTemporary(root, operationId, { bytes: planEventBytes });
    const inventoryBefore = await vaultInventory(root);

    await expect(underLock(root, () => journal(root).list()))
      .resolves.toMatchObject([{ operationId, state: 'Corrupt', issue: expect.stringMatching(/temporary artifact/i) }]);
    await expect(underLock(root, () => journal(root).assertNoUnresolved())).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(underLock(root, () => journal(root).cancel(operationId, async () => true)))
      .rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(underLock(root, () => journal(root).recover(async () => true)))
      .resolves.toMatchObject({ needsReview: 1, unresolved: true });
    expect(await readFile(artifactPath)).toEqual(planEventBytes);
    expect(await vaultInventory(root)).toEqual(inventoryBefore);
  });

  it('does not let a valid-looking temporary event bypass cancellation or admission', async () => {
    const { root } = await tempRoot('nodus-copy-temp-stale-');
    const { operationId } = await prepare(root);
    // A structurally valid cancellation event for the wrong chain tip is not the
    // artifact the writer would leave for this operation.
    const artifactPath = await writeCancellationTemporary(root, operationId, { previousSha256: '9'.repeat(64) });
    const inventoryBefore = await vaultInventory(root);

    await expect(underLock(root, () => journal(root).list()))
      .resolves.toMatchObject([{ operationId, state: 'Corrupt', issue: expect.stringMatching(/temporary artifact/i) }]);
    await expect(underLock(root, () => journal(root).assertNoUnresolved())).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(underLock(root, () => journal(root).cancel(operationId, async () => true)))
      .rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    expect(await readFile(artifactPath)).toBeDefined();
    expect(await vaultInventory(root)).toEqual(inventoryBefore);
    await expect(underLock(root, () => journal(root).list())).resolves.toMatchObject([{ state: 'Corrupt' }]);
    await expect(readFile(join(root, VAULT_PROCESS_LOCK_FILE), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects invalid identity/path evidence before creating journal state', async () => {
    const { root } = await tempRoot();
    await expect(prepare(root, planInput({ destination: { path: 'source.md', collisionKey: 'source.md' } }))).rejects.toThrow();
    await expect(readdir(join(root, COPY_OPERATION_JOURNAL_DIR))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('turns changed or unavailable Prepared evidence into one durable NeedsReview record', async () => {
    const { root } = await tempRoot();
    const { operationId } = await prepare(root);
    const first = await underLock(root, () => journal(root).recover(async () => false));
    expect(first).toMatchObject({ needsReview: 1, unresolved: true });
    expect((await readEvents(root, operationId)).map((record) => record.state)).toEqual(['Prepared', 'NeedsReview']);
    const second = await underLock(root, () => journal(root).recover(async () => true));
    expect(second).toMatchObject({ needsReview: 1, unresolved: true });
    expect((await readEvents(root, operationId)).map((record) => record.state)).toEqual(['Prepared', 'NeedsReview']);
  });

  it.each(['Publishing', 'Published'] as const)('preserves and marks interrupted %s operations NeedsReview', async (state) => {
    const { root } = await tempRoot();
    const { operationId } = await prepare(root);
    if (state === 'Publishing') await addPublishing(root, operationId);
    else await addPublished(root, operationId);
    const before = await readEvents(root, operationId);
    const report = await underLock(root, () => journal(root).recover(async () => true));
    expect(report).toMatchObject({ needsReview: 1, unresolved: true });
    expect((await readEvents(root, operationId)).map((record) => record.state)).toEqual([...before.map((record) => record.state), 'NeedsReview']);
  });

  it('detects a publication intent that contradicts the immutable destination plan', async () => {
    const { root } = await tempRoot();
    const { operationId } = await prepare(root);
    const { intent } = await addPublishing(root, operationId);
    const file = join(operationDirectory(root, operationId), `event-${String(intent.sequence).padStart(6, '0')}.json`);
    const record = JSON.parse(await readFile(file, 'utf8')) as Record<string, any>;
    record.evidence.destinationPath = 'foreign.md';
    delete record.sha256;
    record.sha256 = digest(JSON.stringify(record));
    await writeFile(file, `${JSON.stringify(record)}\n`);
    const original = await readFile(file);
    const report = await underLock(root, () => journal(root).recover(async () => true));
    expect(report.unresolved).toBe(true);
    expect(report.issues.join(' ')).toMatch(/corrupt|contradictory|immutable plan/i);
    expect(await readFile(file)).toEqual(original);
  });

  it.each(['truncated-json', 'unknown-version', 'checksum-mismatch'] as const)('preserves %s records as corrupt evidence', async (failure) => {
    const { root } = await tempRoot();
    const { operationId } = await prepare(root);
    const file = join(operationDirectory(root, operationId), 'event-000000.json');
    const original = await readFile(file, 'utf8');
    if (failure === 'truncated-json') await writeFile(file, original.slice(0, Math.floor(original.length / 2)));
    else {
      const record = JSON.parse(original) as Record<string, any>;
      if (failure === 'unknown-version') {
        record.version = 99;
        const body = Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'sha256'));
        record.sha256 = digest(JSON.stringify(body));
      } else record.plan.copy.serializedSha256 = '9'.repeat(64);
      await writeFile(file, `${JSON.stringify(record)}\n`);
    }
    const corruptBytes = await readFile(file);
    const report = await underLock(root, () => journal(root).recover(async () => true));
    expect(report).toMatchObject({ needsReview: 1, unresolved: true });
    expect(await readFile(file)).toEqual(corruptBytes);
    await expect(underLock(root, () => journal(root).assertNoUnresolved())).rejects.toThrow();
  });

  it('reports an unsupported Succeeded chain as NeedsReview and keeps it blocking', async () => {
    const { root } = await tempRoot('nodus-copy-succeeded-policy-');
    const { operationId } = await prepare(root);
    await addSucceeded(root, operationId);
    const evidenceBefore = await readEvents(root, operationId);
    const inventoryBefore = await vaultInventory(root);

    await expect(underLock(root, () => journal(root).list()))
      .resolves.toMatchObject([{ operationId, state: 'NeedsReview' }]);
    await expect(underLock(root, () => journal(root).assertNoUnresolved())).rejects.toThrow('blocks this action');

    const report = await underLock(root, () => journal(root).recover(async () => true));
    expect(report).toMatchObject({ scanned: 1, terminal: 0, needsReview: 1, unresolved: true });
    expect(report.issues.join(' ')).toMatch(/unsupported Succeeded/i);
    expect(await readEvents(root, operationId)).toEqual(evidenceBefore);
    expect(await vaultInventory(root)).toEqual(inventoryBefore);
  });

  it('reports an unsupported Failed chain as NeedsReview and keeps it blocking', async () => {
    const { root } = await tempRoot('nodus-copy-failed-policy-');
    const { operationId } = await prepare(root);
    const proofBody = {
      source: { path: 'source.md', rawSha256: '4'.repeat(64) },
      destination: { path: 'copy.md', absent: true }, stagingAbsent: true, observedAt: now,
    };
    await appendSyntheticEvent(root, operationId, 'Failed', {
      kind: 'no-effect-proof', ...proofBody, proofSha256: digest(JSON.stringify(proofBody)),
    });
    const evidenceBefore = await readEvents(root, operationId);
    const inventoryBefore = await vaultInventory(root);

    await expect(underLock(root, () => journal(root).list()))
      .resolves.toMatchObject([{ operationId, state: 'NeedsReview' }]);
    await expect(underLock(root, () => journal(root).assertNoUnresolved())).rejects.toThrow('blocks this action');

    const report = await underLock(root, () => journal(root).recover(async () => true));
    expect(report).toMatchObject({ scanned: 1, terminal: 0, needsReview: 1, unresolved: true });
    expect(report.issues.join(' ')).toMatch(/unsupported Failed/i);
    expect(await readEvents(root, operationId)).toEqual(evidenceBefore);
    expect(await vaultInventory(root)).toEqual(inventoryBefore);
  });

  it('keeps repeated recovery of unsupported terminal evidence unchanged and mutation-free', async () => {
    const { root } = await tempRoot('nodus-copy-terminal-idempotent-');
    const { operationId } = await prepare(root);
    await addSucceeded(root, operationId);
    const evidenceBefore = await readEvents(root, operationId);
    const inventoryBefore = await vaultInventory(root);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(underLock(root, () => journal(root).recover(async () => true)))
        .resolves.toMatchObject({ terminal: 0, needsReview: 1, unresolved: true });
      expect(await readEvents(root, operationId)).toEqual(evidenceBefore);
      expect(await vaultInventory(root)).toEqual(inventoryBefore);
    }
  });

  it('keeps a proven Cancelled operation resolved and non-blocking', async () => {
    const { root } = await tempRoot('nodus-copy-cancelled-supported-');
    const { operationId } = await prepare(root);
    await underLock(root, () => journal(root).cancel(operationId, async () => true));

    await expect(underLock(root, () => journal(root).list())).resolves.toMatchObject([{ operationId, state: 'Cancelled' }]);
    await expect(underLock(root, () => journal(root).assertNoUnresolved())).resolves.toBeUndefined();
    await expect(underLock(root, () => journal(root).recover(async () => true)))
      .resolves.toMatchObject({ scanned: 1, terminal: 1, needsReview: 0, unresolved: false });
  });

  it('releases the root lock after an unsupported terminal state rejects admission', async () => {
    const { root } = await tempRoot('nodus-copy-terminal-lock-');
    const { operationId } = await prepare(root);
    await addSucceeded(root, operationId);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(underLock(root, () => journal(root).assertNoUnresolved())).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    }
    // The lock is released, so later callers can still inspect the preserved evidence.
    await expect(underLock(root, () => journal(root).list())).resolves.toMatchObject([{ operationId, state: 'NeedsReview' }]);
    await expect(readFile(join(root, VAULT_PROCESS_LOCK_FILE), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects duplicate unresolved operations without replacing their records', async () => {
    const { root } = await tempRoot();
    const { operationId } = await prepare(root);
    const original = await readFile(join(operationDirectory(root, operationId), 'event-000000.json'));
    await expect(prepare(root)).rejects.toThrow('blocks this action');
    expect(await readFile(join(operationDirectory(root, operationId), 'event-000000.json'))).toEqual(original);
    expect((await readdir(join(root, COPY_OPERATION_JOURNAL_DIR, 'operations')))).toHaveLength(1);
  });

  it('serializes concurrent recovery and repeated inspection appends no duplicate transition', async () => {
    const { root } = await tempRoot();
    const { operationId } = await prepare(root);
    const [first, second] = await Promise.all([
      underLock(root, () => journal(root).recover(async () => false)),
      underLock(root, () => journal(root).recover(async () => false)),
    ]);
    expect(first.unresolved).toBe(true);
    expect(second.unresolved).toBe(true);
    expect((await readEvents(root, operationId)).map((record) => record.state)).toEqual(['Prepared', 'NeedsReview']);
  });

  it('stops invoking prepared validators when the shared recovery budget expires', async () => {
    const { root } = await tempRoot();
    const { operationId } = await prepare(root);
    await clonePreparedRecord(root, operationId);
    let validations = 0;
    let deadlineArmed = false;
    const budget: CopyJournalBudget = { count: 0, max: 100, check: () => {
      if (deadlineArmed && validations >= 1) throw new Error('shared recovery budget expired');
    } };
    const bounded = new CopyOperationJournal(root, { budget });
    await expect(underLock(root, () => bounded.recover(async () => { validations += 1; deadlineArmed = true; return true; })))
      .rejects.toThrow('shared recovery budget expired');
    expect(validations).toBe(1);
    await expect(underLock(root, () => journal(root).assertNoUnresolved())).rejects.toThrow('blocks this action');
  });

  it.each([
    ['after-journal-directory-created', 'clean-empty'],
    ['after-operations-directory-created', 'clean-empty'],
    ['after-vault-identity-created', 'corrupt'],
    ['after-operation-directory-created', 'corrupt'],
    ['after-record-created', 'corrupt'],
    ['after-record-written', 'prepared'],
    ['before-record-file-sync', 'prepared'],
    ['after-record-file-sync', 'prepared'],
    ['after-record-directory-sync', 'prepared'],
    ['before-record-readback', 'prepared'],
  ] as const)('reopens safely after simulated interruption at %s', async (point, expected) => {
    const { root } = await tempRoot();
    const interrupted = journal(root, (actual) => { if (actual === point) throw new Error(`interruption:${point}`); });
    await expect(underLock(root, () => interrupted.prepare(planInput()))).rejects.toThrow(`interruption:${point}`);
    const reopened = journal(root);
    if (expected === 'clean-empty') {
      const report = await underLock(root, () => reopened.recover(async () => true));
      expect(report.unresolved).toBe(false);
    } else if (expected === 'corrupt') {
      await expect(underLock(root, () => reopened.assertNoUnresolved())).rejects.toThrow();
    } else {
      const report = await underLock(root, () => reopened.recover(async () => true));
      expect(report).toMatchObject({ prepared: 1, unresolved: true });
    }
  });

  it('fails closed if directory-entry sync fails, then re-syncs visible records on recovery', async () => {
    const { root } = await tempRoot();
    let syncs = 0;
    const interrupted = journal(root, (point) => {
      if (point === 'before-directory-sync' && ++syncs === 5) throw new Error('directory-sync-interruption');
    });
    await expect(underLock(root, () => interrupted.prepare(planInput()))).rejects.toThrow('Required journal directory sync failed');
    expect(syncs).toBe(5);
    const report = await underLock(root, () => journal(root).recover(async () => true));
    expect(report).toMatchObject({ prepared: 1, unresolved: true });
  });

  it('preserves primary and cleanup failures when a journal handle cleanup also fails', async () => {
    const { root } = await tempRoot();
    const interrupted = journal(root, (point) => {
      if (point === 'after-record-written') throw new Error('primary-write-failure');
      if (point === 'before-record-cleanup-close') throw new Error('cleanup-close-failure');
    });
    let caught: unknown;
    try { await underLock(root, () => interrupted.prepare(planInput())); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors.map((error) => (error as Error).message)).toEqual(['primary-write-failure', 'cleanup-close-failure']);
    await expect(underLock(root, () => journal(root).assertNoUnresolved())).rejects.toThrow();
  });

  it('rejects over-budget journal scans and releases the shared root lock', async () => {
    const { root } = await tempRoot();
    await prepare(root);
    const bounded = new CopyOperationJournal(root, { budget: { count: 0, max: 0 } });
    await expect(underLock(root, () => bounded.assertNoUnresolved())).rejects.toThrow('entry budget');
    await expect(underLock(root, () => journal(root).assertNoUnresolved())).rejects.toThrow('blocks this action');
  });

  it('classifies a journal record from a different vault identity as inert corrupt evidence', async () => {
    const first = await tempRoot('nodus-copy-journal-a-');
    const second = await tempRoot('nodus-copy-journal-b-');
    const a = await prepare(first.root);
    await prepare(second.root, planInput({ previewTokenSha256: 'c'.repeat(64) }));
    const foreignOperation = operationDirectory(first.root, a.operationId);
    const targetOperation = operationDirectory(second.root, a.operationId);
    await mkdir(targetOperation, { mode: 0o700 });
    await copyFile(join(foreignOperation, 'event-000000.json'), join(targetOperation, 'event-000000.json'));
    const report = await underLock(second.root, () => journal(second.root).recover(async () => true));
    expect(report).toMatchObject({ unresolved: true, needsReview: 1 });
    expect(report.issues.join(' ')).toMatch(/identity does not match/i);
    await expect(underLock(second.root, () => journal(second.root).assertNoUnresolved())).rejects.toThrow();
  });
});

describe('Phase 19 unresolved-operation gates', () => {
  async function vaultWithPreparedCopy() {
    const { parent, root } = await tempRoot('nodus-copy-gates-');
    const vault = await FileSystemVault.open(root);
    const source = createNote({ id: randomUUID(), title: 'Source', path: 'source.md', body: 'Body', now });
    await vault.createNote(source);
    const sourceBytes = await readFile(join(root, source.path));
    const preview = await vault.previewNoteCopy(source.id, 'copy.md');
    const proposed = {
      ...source,
      ...preview.intent.note,
      path: 'copy.md',
      tags: [...preview.intent.note.tags],
      aliases: [...preview.intent.note.aliases],
      extraFrontmatter: preview.intent.note.icon === null ? {} : { icon: preview.intent.note.icon },
    };
    const copyBytes = Buffer.from(serializeNote(proposed), 'utf8');
    const internal = vault as unknown as {
      inspectCopyPreviewUnlocked(sourceId: string, destination: string, copyId: string, instant: string): Promise<{
        digest: string; resolverProjectionSha256: string;
      }>;
    };
    const evidence = await internal.inspectCopyPreviewUnlocked(
      source.id, 'copy.md', preview.intent.note.id, preview.intent.note.createdAt,
    );
    const plan: CopyOperationPlanInput = {
      previewTokenSha256: 'a'.repeat(64),
      previewBindingSha256: 'b'.repeat(64),
      snapshotSha256: evidence.digest,
      confirmedAt: now,
      source: {
        id: source.id, path: source.path, rawSha256: digest(sourceBytes),
        createdAt: source.createdAt, updatedAt: source.updatedAt,
      },
      destination: { path: 'copy.md', collisionKey: 'copy.md' },
      copy: {
        id: preview.intent.note.id, instant: preview.intent.note.createdAt,
        serializedSha256: digest(copyBytes), serializedBytes: copyBytes.byteLength,
        noteFormatVersion: 1,
      },
      resolverProjectionSha256: evidence.resolverProjectionSha256,
    };
    await withVaultRootLock(root, () => new CopyOperationJournal(root).prepare(plan));
    return { parent, root, vault, source, sourceBytes, copyBytes };
  }

  it('cancels an unpublished preparation after reopen and can retry cancellation', async () => {
    const { root } = await tempRoot();
    const vault = await FileSystemVault.open(root);
    const source = createNote({ id: randomUUID(), title: 'Source', path: 'source.md', body: 'Body', now });
    await vault.createNote(source);
    const sourceBytes = await readFile(join(root, source.path));
    const preview = await vault.previewNoteCopy(source.id, 'copy.md');
    const prepared = await vault.confirmNoteCopy(preview.token);
    expect(prepared).toMatchObject({ published: false, state: 'Prepared' });
    await expect(vault.confirmNoteCopy(preview.token)).rejects.toMatchObject({ code: 'CONFLICT' });
    const reopened = await FileSystemVault.open(root);
    const [operation] = await reopened.listCopyOperations();
    expect(operation?.state).toBe('Prepared');
    await expect(reopened.cancelPreparedCopyOperation(operation!.operationId)).resolves.toMatchObject({
      state: 'Cancelled', alreadyCancelled: false,
    });
    await expect(vault.cancelPreparedCopyOperation(operation!.operationId)).resolves.toMatchObject({
      state: 'Cancelled', alreadyCancelled: true,
    });
    await expect(reopened.assertNoUnresolvedOperations()).resolves.toBeUndefined();
    await expect(readFile(join(root, 'copy.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(root, source.path))).toEqual(sourceBytes);
  });

  it('preserves both journals and the source when corrupt import evidence blocks cancellation', async () => {
    const { root, vault, source, sourceBytes } = await vaultWithPreparedCopy();
    const [operation] = await vault.listCopyOperations();
    const importDir = join(root, '.nodus-import-transactions', randomUUID());
    await mkdir(importDir, { recursive: true });
    const journalPath = join(importDir, 'journal.json');
    await writeFile(journalPath, 'truncated evidence');
    const before = await vaultInventory(root);
    await expect(vault.cancelPreparedCopyOperation(operation!.operationId)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(vault.previewNoteCopy(source.id, 'other.md')).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    expect(await vault.listCopyOperations()).toEqual([operation]);
    expect(await vaultInventory(root)).toEqual(before);
    expect(await readFile(journalPath, 'utf8')).toBe('truncated evidence');
    expect(await readFile(join(root, source.path))).toEqual(sourceBytes);
    await expect(readFile(join(root, 'copy.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('blocks copy preview, preparation, and cancellation for a recovery-required import', async () => {
    const { parent, root } = await tempRoot('nodus-copy-import-recovery-');
    const vault = await FileSystemVault.open(root);
    const source = createNote({ id: randomUUID(), title: 'Source', path: 'source.md', body: 'Body', now });
    await vault.createNote(source);
    const preview = await vault.previewNoteCopy(source.id, 'copy.md');
    const importJournal = await writeRecoveryRequiredImportJournal(root);
    const before = await vaultInventory(root);

    await expect(vault.previewNoteCopy(source.id, 'other.md')).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(vault.confirmNoteCopy(preview.token)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    expect(await vaultInventory(root)).toEqual(before);
    await expect(vault.listImportOperations()).resolves.toMatchObject([{ operationId: importJournal.operationId, state: 'recovery-required' }]);
    await expect(vault.listCopyOperations()).resolves.toEqual([]);

    const prepared = await vaultWithPreparedCopy();
    const secondImport = await writeRecoveryRequiredImportJournal(prepared.root);
    const preparedBefore = await vaultInventory(prepared.root);
    const [operation] = await prepared.vault.listCopyOperations();
    await expect(prepared.vault.cancelPreparedCopyOperation(operation!.operationId)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    expect(await vaultInventory(prepared.root)).toEqual(preparedBefore);
    await expect(prepared.vault.listImportOperations()).resolves.toMatchObject([{ operationId: secondImport.operationId, state: 'recovery-required' }]);
    await expect(prepared.vault.listCopyOperations()).resolves.toMatchObject([{ operationId: operation!.operationId, state: 'Prepared' }]);
  });

  it.each(['corrupt', 'recovery-required'] as const)('blocks import and restore for a %s copy journal without changing the vault', async (state) => {
    const { parent, root } = await tempRoot('nodus-copy-import-block-');
    const vault = await FileSystemVault.open(root);
    const source = createNote({ id: randomUUID(), title: 'Source', path: 'source.md', body: 'Body', now });
    await vault.createNote(source);
    const sourceBytes = await readFile(join(root, source.path));
    const importSource = await FileSystemVault.open(join(parent, 'import-source'));
    const incoming = createNote({ id: randomUUID(), title: 'Incoming', path: 'incoming.md', body: 'Incoming', now });
    await importSource.createNote(incoming);
    const importDir = join(parent, 'portable-import');
    await exportVault(importSource, importDir);
    const importPreview = await createImportPreviewSnapshot(importDir, vault);
    const importPlan = await planImport(importDir);
    const decisions: ImportConflictDecision[] = importPreview.binding.resourceBindings!.map((resource) => ({
      kind: resource.kind, id: resource.id, path: resource.path, choice: 'add',
    }));
    const copyPreview = await vault.previewNoteCopy(source.id, 'copy.md');
    await vault.confirmNoteCopy(copyPreview.token);
    const [operation] = await vault.listCopyOperations();
    const eventPath = join(operationDirectory(root, operation!.operationId), 'event-000000.json');
    let expectedSourceBytes = sourceBytes;
    if (state === 'corrupt') await writeFile(eventPath, 'corrupt copy journal evidence');
    else {
      expectedSourceBytes = Buffer.concat([sourceBytes, Buffer.from('\nexternal change\n')]);
      await writeFile(join(root, source.path), expectedSourceBytes);
      await expect(vault.recoverCopyOperations()).resolves.toMatchObject({ needsReview: 1, unresolved: true });
    }

    const backupDir = join(parent, 'valid-backup');
    await createBackup(importSource, backupDir);
    const before = await vaultInventory(root);

    await expect(vault.applyReviewedImport(importPlan, importPreview.binding, decisions))
      .rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(restoreBackup(backupDir, root)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });

    expect(await vaultInventory(root)).toEqual(before);
    expect(await readFile(join(root, source.path))).toEqual(expectedSourceBytes);
    await expect(vault.listCopyOperations()).resolves.toMatchObject([{ operationId: operation!.operationId, state: state === 'corrupt' ? 'Corrupt' : 'NeedsReview' }]);
  });

  it('blocks import and restore while a copy journal holds an unsupported Succeeded terminal state', async () => {
    const { parent, root, vault, source, sourceBytes } = await vaultWithPreparedCopy();
    const [operation] = await vault.listCopyOperations();
    await addSucceeded(root, operation!.operationId);
    const evidenceBefore = await readEvents(root, operation!.operationId);
    const before = await vaultInventory(root);

    const backupSource = await FileSystemVault.open(join(parent, 'terminal-backup-source'));
    await backupSource.createNote(createNote({ id: randomUUID(), title: 'Incoming', path: 'incoming.md', body: 'Incoming', now }));
    const backupDir = join(parent, 'terminal-valid-backup');
    await createBackup(backupSource, backupDir);
    const queued = createNote({ id: randomUUID(), title: 'Queued', path: 'queued.md', body: 'Queued', now });

    await expect(vault.assertNoUnresolvedOperations()).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(vault.applyImport({ entries: [], notes: [queued], databases: [], databaseViews: [] }))
      .rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(restoreBackup(backupDir, root)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(vault.previewNoteCopy(source.id, 'other.md')).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });

    expect(await vaultInventory(root)).toEqual(before);
    expect(await readEvents(root, operation!.operationId)).toEqual(evidenceBefore);
    expect(await readFile(join(root, source.path))).toEqual(sourceBytes);
    await expect(readFile(join(root, 'other.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(vault.listCopyOperations()).resolves.toMatchObject([{ operationId: operation!.operationId, state: 'NeedsReview' }]);
  });

  it('blocks copy admission while an unresolved import journal exists beside unsupported copy evidence', async () => {
    const { root } = await tempRoot('nodus-copy-import-inverse-');
    const vault = await FileSystemVault.open(root);
    const source = createNote({ id: randomUUID(), title: 'Source', path: 'source.md', body: 'Body', now });
    await vault.createNote(source);
    const prepared = await prepare(root);
    await addSucceeded(root, prepared.operationId);
    const importJournal = await writeRecoveryRequiredImportJournal(root);
    const before = await vaultInventory(root);

    await expect(vault.previewNoteCopy(source.id, 'copy.md')).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(vault.assertNoUnresolvedOperations()).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(vault.cancelPreparedCopyOperation(prepared.operationId)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });

    expect(await vaultInventory(root)).toEqual(before);
    expect(await readFile(importJournal.path)).toEqual(importJournal.bytes);
    await expect(vault.listCopyOperations()).resolves.toMatchObject([{ operationId: prepared.operationId, state: 'NeedsReview' }]);
  });

  it('blocks import, restore and copy admission for suspicious temporary journal evidence', async () => {
    const { parent, root, vault, source, sourceBytes } = await vaultWithPreparedCopy();
    const [operation] = await vault.listCopyOperations();
    const artifactPath = join(operationDirectory(root, operation!.operationId), `${TEMP_PREFIX}${randomUUID()}`);
    await mkdir(artifactPath, { mode: 0o700 });
    const before = await vaultInventory(root);

    const backupSource = await FileSystemVault.open(join(parent, 'temp-artifact-backup-source'));
    await backupSource.createNote(createNote({ id: randomUUID(), title: 'Incoming', path: 'incoming.md', body: 'Incoming', now }));
    const backupDir = join(parent, 'temp-artifact-valid-backup');
    await createBackup(backupSource, backupDir);
    const queued = createNote({ id: randomUUID(), title: 'Queued', path: 'queued.md', body: 'Queued', now });

    await expect(vault.previewNoteCopy(source.id, 'other.md')).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(vault.assertNoUnresolvedOperations()).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(vault.applyImport({ entries: [], notes: [queued], databases: [], databaseViews: [] }))
      .rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(restoreBackup(backupDir, root)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });

    expect(await vaultInventory(root)).toEqual(before);
    expect((await lstat(artifactPath)).isDirectory()).toBe(true);
    expect(await readFile(join(root, source.path))).toEqual(sourceBytes);
    await expect(vault.listCopyOperations()).resolves.toMatchObject([{ operationId: operation!.operationId, state: 'Corrupt' }]);
  });

  it('fails closed when both journals are unresolved and preserves them for manual intervention', async () => {
    const { parent, root, vault, source, sourceBytes } = await vaultWithPreparedCopy();
    const [copyOperation] = await vault.listCopyOperations();
    const importJournal = await writeRecoveryRequiredImportJournal(root);
    const backupSource = await FileSystemVault.open(join(parent, 'backup-source'));
    await backupSource.createNote(createNote({ id: randomUUID(), title: 'Restore note', path: 'restore.md', body: 'Restore', now }));
    const backupDir = join(parent, 'valid-backup');
    await createBackup(backupSource, backupDir);
    const incoming = createNote({ id: randomUUID(), title: 'Incoming', path: 'incoming.md', body: 'Incoming', now });
    const before = await vaultInventory(root);

    await expect(vault.applyImport({ entries: [], notes: [incoming], databases: [], databaseViews: [] })).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(restoreBackup(backupDir, root)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(vault.recoverCopyOperations()).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(vault.cancelPreparedCopyOperation(copyOperation!.operationId)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(vault.recoverImportOperation(importJournal.operationId)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(vault.previewNoteCopy(source.id, 'other.md')).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });

    expect(await vaultInventory(root)).toEqual(before);
    expect(await readFile(join(root, source.path))).toEqual(sourceBytes);
    await expect(vault.listImportOperations()).resolves.toMatchObject([{ operationId: importJournal.operationId, state: 'recovery-required' }]);
    await expect(vault.listCopyOperations()).resolves.toMatchObject([{ operationId: copyOperation!.operationId, state: 'Prepared' }]);
  });

  it('blocks snapshots, backup, portable export, restore preview/application, and normal import while Prepared', async () => {
    const { parent, root, vault, source, sourceBytes } = await vaultWithPreparedCopy();
    const backupDir = join(parent, 'backup');
    const exportDir = join(parent, 'export');
    await expect(vault.snapshotWithPropertyCatalog()).rejects.toThrow('unresolved or corrupt note-copy operation');
    await expect(vault.snapshotForPortableExport()).rejects.toThrow('unresolved or corrupt note-copy operation');
    await expect(createBackup(vault, backupDir)).rejects.toThrow('unresolved or corrupt note-copy operation');
    await expect(exportVault(vault, exportDir)).rejects.toThrow('unresolved or corrupt note-copy operation');
    expect(await readdir(parent)).not.toContain('backup');
    expect(await readdir(parent)).not.toContain('export');
    await expect(vault.applyImport({ entries: [], notes: [], databases: [], databaseViews: [] })).rejects.toThrow('unresolved or corrupt note-copy operation');
    const backupSource = await FileSystemVault.open(join(parent, 'backup-source'));
    await backupSource.createNote(createNote({ id: randomUUID(), title: 'Backup source', path: 'backup-source.md', body: 'backup', now }));
    const validBackup = join(parent, 'valid-backup');
    await createBackup(backupSource, validBackup);
    await expect(previewRestore(validBackup, vault)).rejects.toThrow('unresolved or corrupt note-copy operation');
    await expect(restoreBackup(validBackup, root)).rejects.toThrow('unresolved or corrupt note-copy operation');
    await expect(restoreBackup(validBackup, root)).rejects.toThrow('unresolved or corrupt note-copy operation');
    await expect(readFile(join(root, 'copy.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(root, source.path))).toEqual(sourceBytes);
  });

  it('gates the complete backup snapshot on import recovery and releases the lock after rejection', async () => {
    const { parent, root } = await tempRoot('nodus-backup-import-gate-');
    const vault = await FileSystemVault.open(root);
    const importJournal = await writeRecoveryRequiredImportJournal(root);
    const backupDir = join(parent, 'backup');

    await expect(createBackup(vault, backupDir)).rejects.toMatchObject({ code: 'PARTIAL_WRITE' });
    await expect(vault.listImportOperations()).resolves.toMatchObject([{ operationId: importJournal.operationId, state: 'recovery-required' }]);
    await expect(readdir(backupDir)).rejects.toMatchObject({ code: 'ENOENT' });

    await rm(importJournal.directory, { recursive: true });
    await expect(createBackup(vault, backupDir)).resolves.toMatchObject({ notes: 0, databases: 0 });
  });

  it('rechecks unresolved state under the final reviewed-import root lock', async () => {
    const { parent, root } = await tempRoot('nodus-copy-import-race-');
    const sourceVault = await FileSystemVault.open(join(parent, 'source-vault'));
    const target = await FileSystemVault.open(root);
    const copiedSource = createNote({ id: randomUUID(), title: 'Copy source', path: 'copy-source.md', body: 'Keep me', now });
    await target.createNote(copiedSource);
    const incoming = createNote({ id: randomUUID(), title: 'Incoming', path: 'incoming.md', body: 'Import me', now });
    await sourceVault.createNote(incoming);
    const exportPath = join(parent, 'portable');
    await exportVault(sourceVault, exportPath);
    const preview = await createImportPreviewSnapshot(exportPath, target);
    const plan = await planImport(exportPath);
    const decisions: ImportConflictDecision[] = preview.binding.resourceBindings!.map((resource) => ({
      kind: resource.kind, id: resource.id, path: resource.path, choice: 'add',
    }));
    const originalBytes = await readFile(join(root, copiedSource.path));
    const implementation = target as unknown as { writeImportStagedFile(path: string, bytes: Buffer): Promise<void> };
    const originalWriteStage = implementation.writeImportStagedFile.bind(target);
    let insertedPreparedOperation = false;
    vi.spyOn(implementation, 'writeImportStagedFile').mockImplementation(async (path, bytes) => {
      await originalWriteStage(path, bytes);
      if (!insertedPreparedOperation) {
        insertedPreparedOperation = true;
        await prepare(root);
      }
    });
    try {
      await expect(target.applyReviewedImport(plan, preview.binding, decisions)).rejects.toThrow('unresolved or corrupt note-copy operation');
    } finally { vi.restoreAllMocks(); }
    expect(insertedPreparedOperation).toBe(true);
    expect(await readFile(join(root, copiedSource.path))).toEqual(originalBytes);
    await expect(readFile(join(root, incoming.path))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(root, 'copy.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('serializes competing copy confirmation and import admission under the root lock', async () => {
    const { root } = await tempRoot('nodus-copy-import-queue-');
    const vault = await FileSystemVault.open(root);
    const source = createNote({ id: randomUUID(), title: 'Copy source', path: 'copy-source.md', body: 'Keep', now });
    const incoming = createNote({ id: randomUUID(), title: 'Incoming', path: 'incoming.md', body: 'Import', now });
    await vault.createNote(source);
    const sourceBytes = await readFile(join(root, source.path));
    const preview = await vault.previewNoteCopy(source.id, 'copy.md');

    let notifyLocked!: () => void;
    const locked = new Promise<void>((resolve) => { notifyLocked = resolve; });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const holder = withVaultRootLock(vault.root, async () => {
      notifyLocked();
      await blocked;
    });
    await locked;

    const copyAttempt = vault.confirmNoteCopy(preview.token);
    const importAttempt = vault.applyImport({ entries: [], notes: [incoming], databases: [], databaseViews: [] });
    release();
    const [copyResult, importResult] = await Promise.allSettled([copyAttempt, importAttempt]);
    await holder;

    if (copyResult.status === 'rejected') throw copyResult.reason;
    expect(copyResult).toMatchObject({ status: 'fulfilled', value: { state: 'Prepared', published: false } });
    expect(importResult).toMatchObject({ status: 'rejected', reason: { code: 'PARTIAL_WRITE' } });
    expect(await readFile(join(root, source.path))).toEqual(sourceBytes);
    await expect(readFile(join(root, incoming.path))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(root, 'copy.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(vault.listCopyOperations()).resolves.toMatchObject([{ state: 'Prepared' }]);
    await expect(vault.listImportOperations()).resolves.toEqual([]);
  });

  it('does not import hidden journal artifacts as active work', async () => {
    const { parent, root } = await tempRoot('nodus-copy-import-inert-');
    const source = join(parent, 'portable-source');
    await mkdir(source);
    await mkdir(join(source, COPY_OPERATION_JOURNAL_DIR));
    await writeFile(join(source, COPY_OPERATION_JOURNAL_DIR, 'vault.json'), '{"format":"nodus-copy-journal-vault"}');
    const plan = await planImport(source);
    expect(plan.entries).toEqual([]);
    const vault = await FileSystemVault.open(root);
    const report = await vault.applyImport(plan);
    expect(report.notes).toBe(0);
    await expect(readdir(join(root, COPY_OPERATION_JOURNAL_DIR))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves copy-only source bytes unchanged after recovery and never creates the destination', async () => {
    const { root, vault, source, sourceBytes } = await vaultWithPreparedCopy();
    const first = await vault.recoverCopyOperations();
    const second = await vault.recoverCopyOperations();
    expect(first).toMatchObject({ prepared: 1, unresolved: true });
    expect(second).toMatchObject({ prepared: 1, unresolved: true });
    expect(await readFile(join(root, source.path))).toEqual(sourceBytes);
    await expect(readFile(join(root, 'copy.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves changed source evidence as NeedsReview', async () => {
    const { root, vault, source } = await vaultWithPreparedCopy();
    const sourcePath = join(root, source.path);
    const changedBytes = Buffer.concat([await readFile(sourcePath), Buffer.from('\nexternal change\n')]);
    await writeFile(sourcePath, changedBytes);
    const report = await vault.recoverCopyOperations();
    expect(report).toMatchObject({ needsReview: 1, unresolved: true });
    expect(await readFile(sourcePath)).toEqual(changedBytes);
    await expect(readFile(join(root, 'copy.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not claim identical foreign destination bytes as operation-owned', async () => {
    const { root, vault, copyBytes } = await vaultWithPreparedCopy();
    await writeFile(join(root, 'copy.md'), copyBytes, { flag: 'wx' });
    const report = await vault.recoverCopyOperations();
    expect(report).toMatchObject({ needsReview: 1, unresolved: true });
    expect(await readFile(join(root, 'copy.md'))).toEqual(copyBytes);
  });
});
