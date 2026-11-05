import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { serializeNote } from '../src/format/note-format.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { exportVault } from '../src/storage/portable/export.js';
import { createImportPreviewSnapshot, validateImportPreviewFreshness } from '../src/storage/portable/import.js';
import { ImportPreviewSessionStore, validateImportConflictDecisions, type ImportPreviewBinding } from '../src/storage/portable/preview-session.js';
import { withTempDir } from './tmp.js';

const NOW = '2026-11-05T00:00:00Z';
const ID = '2a4c6e80-1357-4b9d-8e0f-123456789abc';

describe('Phase 29D.1 import preview freshness contract', () => {
  it('creates deterministic fingerprints and rejects source and destination changes', async () => {
    await withTempDir(async (root) => {
      const sourceVault = await FileSystemVault.open(join(root, 'source-vault'));
      const destination = await FileSystemVault.open(join(root, 'destination'));
      await sourceVault.createNote(createNote({ id: ID, path: 'notes/incoming.md', title: 'Incoming', body: 'source-v1', now: NOW }));
      const source = join(root, 'package');
      await exportVault(sourceVault, source, { now: NOW });

      const first = await createImportPreviewSnapshot(source, destination);
      const second = await createImportPreviewSnapshot(source, destination);
      expect(second.binding.sourceFingerprint).toBe(first.binding.sourceFingerprint);
      expect(second.binding.destinationFingerprint).toBe(first.binding.destinationFingerprint);
      await expect(validateImportPreviewFreshness(source, destination, first.binding)).resolves.toBeUndefined();

      const sourceBytes = await readFile(join(source, 'notes/incoming.md'));
      await writeFile(join(source, 'notes/incoming.md'), Buffer.concat([sourceBytes, Buffer.from('\nexternal edit')]));
      await expect(validateImportPreviewFreshness(source, destination, first.binding)).rejects.toMatchObject({ code: 'STALE_PREVIEW' });

      // A fresh preview binds to the changed source, then target mutation stales it.
      const validPackage = join(root, 'package-v2');
      await exportVault(sourceVault, validPackage, { now: NOW });
      const refreshed = await createImportPreviewSnapshot(validPackage, destination);
      await destination.createNote(createNote({ id: '3b4c6e80-1357-4b9d-8e0f-123456789abc', path: 'notes/other.md', title: 'Other', body: 'target-v1', now: NOW }));
      await expect(validateImportPreviewFreshness(refreshed.preview.source, destination, refreshed.binding)).rejects.toMatchObject({ code: 'STALE_PREVIEW' });
      sourceVault.dispose(); destination.dispose();
    });
  });

  it('binds explicit skip/replace choices to each exact preview conflict', async () => {
    const binding: ImportPreviewBinding = {
      sourcePath: '/tmp/source', destinationPath: '/tmp/destination', sourceFingerprint: 'a'.repeat(64), destinationFingerprint: 'b'.repeat(64),
      conflicts: [{ kind: 'note', id: ID, path: 'notes/a.md', sourceSha256: 'c'.repeat(64), destinationSha256: 'd'.repeat(64), safeChoices: ['skip', 'replace'] }],
    };
    expect(() => validateImportConflictDecisions(binding, [{ kind: 'note', id: ID, path: 'notes/a.md', choice: 'replace' }])).not.toThrow();
    expect(() => validateImportConflictDecisions(binding, [{ kind: 'note', id: ID, path: 'notes/other.md', choice: 'replace' }])).toThrow(/do not match/);
    expect(() => validateImportConflictDecisions(binding, [{ kind: 'note', id: ID, path: 'notes/a.md', choice: 'skip' }, { kind: 'note', id: ID, path: 'notes/a.md', choice: 'skip' }])).toThrow(/do not match/);
    expect(() => validateImportConflictDecisions(binding, [])).toThrow(/Every preview conflict/);
  });

  it('uses bounded, expiring, one-use opaque preview handles', () => {
    let now = 1_000;
    const store = new ImportPreviewSessionStore({ ttlMs: 10, maxEntries: 1, now: () => now });
    const binding: ImportPreviewBinding = { sourcePath: '/tmp/source', destinationPath: '/tmp/destination', sourceFingerprint: 'a'.repeat(64), destinationFingerprint: 'b'.repeat(64), conflicts: [] };
    const session = store.issue(binding);
    expect(session.previewId).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.read(session.previewId).binding).toEqual(binding);
    const replacement = store.issue(binding);
    expect(() => store.read(session.previewId)).toThrow(/unavailable/i);
    expect(store.consume(replacement.previewId).previewId).toBe(replacement.previewId);
    expect(() => store.consume(replacement.previewId)).toThrow(/unavailable/i);
    const expiring = store.issue(binding);
    now += 10;
    expect(() => store.read(expiring.previewId)).toThrow(/expired/i);
  });

  it('reports a changed or missing portable source as a stale preview and does not write to the target', async () => {
    await withTempDir(async (root) => {
      const sourceVault = await FileSystemVault.open(join(root, 'source-vault'));
      const destination = await FileSystemVault.open(join(root, 'destination'));
      await sourceVault.createNote(createNote({ id: ID, path: 'note.md', title: 'Incoming', body: 'source', now: NOW }));
      const source = join(root, 'package');
      await exportVault(sourceVault, source, { now: NOW });
      const preview = await createImportPreviewSnapshot(source, destination);
      await writeFile(join(source, 'nodus-export.json'), '{malformed');
      const before = await destination.snapshotForPortableExport();
      await expect(validateImportPreviewFreshness(source, destination, preview.binding)).rejects.toMatchObject({ code: 'STALE_PREVIEW' });
      expect(await destination.snapshotForPortableExport()).toEqual(before);
      sourceVault.dispose(); destination.dispose();
    });
  });

  it('fingerprints recognized legacy resources and rejects a changed legacy source', async () => {
    await withTempDir(async (root) => {
      const destination = await FileSystemVault.open(join(root, 'destination'));
      const source = join(root, 'legacy');
      await mkdir(join(source, 'notes'), { recursive: true });
      const note = createNote({ id: ID, path: 'notes/legacy.md', title: 'Legacy', body: 'before', now: NOW });
      const notePath = join(source, 'notes/legacy.md');
      await writeFile(notePath, serializeNote(note));
      const preview = await createImportPreviewSnapshot(source, destination);
      await writeFile(notePath, serializeNote({ ...note, body: 'after' }));
      await expect(validateImportPreviewFreshness(source, destination, preview.binding)).rejects.toMatchObject({ code: 'STALE_PREVIEW' });
      destination.dispose();
    });
  });
});
