import * as scan from '../src/storage/fs/scan.js';
import { performance } from 'node:perf_hooks';
import { mkdtemp, readFile, writeFile, symlink, mkdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createNote } from '../src/domain/note.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'nodus-preview-'));
  const vault = await FileSystemVault.open(root);
  const source = createNote({ id: randomUUID(), title: 'Source', path: 'source.md', body: '[[Missing outgoing]]', now: '2026-11-17T00:00:00Z' });
  await vault.createNote(source);
  return { root, vault, source };
}

describe('storage-owned copy preview', () => {
  it('validates once without changing source or creating destination; returned evidence is isolated', async () => {
    const { root, vault, source } = await fixture();
    const bytes = await readFile(join(root, source.path));
    const preview = await vault.previewNoteCopy(source.id, 'copy.md');
    (preview.intent.note.tags as string[]).push('client mutation');
    expect(await readFile(join(root, source.path))).toEqual(bytes);
    await expect(readFile(join(root, 'copy.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects destination races, identical bytes and case collisions', async () => {
    const { vault, root, source } = await fixture();
    const p = await vault.previewNoteCopy(source.id, 'copy.md');
    await writeFile(join(root, 'copy.md'), await readFile(join(root, source.path)));
    await expect(vault.previewNoteCopy(source.id, 'COPY.md')).rejects.toThrow();
  });
  it('fails closed on incomplete inventories', async () => {
    const { vault, root, source } = await fixture();
    await symlink(join(root, source.path), join(root, 'uncertain.md'));
    await expect(vault.previewNoteCopy(source.id, 'copy.md')).rejects.toThrow('Incomplete');
  });
  it('rejects supplied evidence after disposal', async () => {
    const { vault, source } = await fixture();
    await expect((vault.previewNoteCopy as Function)(source.id, 'copy.md', { hash: 'forged' })).rejects.toThrow();
    vault.dispose();
    await expect(vault.previewNoteCopy(source.id, 'copy.md')).rejects.toThrow('disposed');
  });
  it('bounds live previews and rejects nested lock acquisition', async () => {
    const { vault, root, source } = await fixture();
    const first = await vault.previewNoteCopy(source.id, 'copy.md');
    for (let n = 1; n < 16; n++) await vault.previewNoteCopy(source.id, `copy-${n}.md`);
    await expect(vault.previewNoteCopy(source.id, 'overflow.md')).rejects.toThrow('Too many');
    // Same async-context nested acquisition is rejected without consuming a token.
    const { withVaultRootLock } = await import('../src/storage/fs/root-lock.js');
    await withVaultRootLock(vault.root, async () => {
      await expect(vault.previewNoteCopy(source.id, 'nested.md')).rejects.toThrow('Nested');
    });
  });
  it('rejects duplicate IDs and invalid UTF-8 read from disk', async () => {
    const { vault, root, source } = await fixture();
    await writeFile(join(root, 'duplicate.md'), await readFile(join(root, source.path)));
    await expect(vault.previewNoteCopy(source.id, 'copy.md')).rejects.toThrow('Duplicate');
    await writeFile(join(root, 'duplicate.md'), Buffer.from([0xff]));
    await expect(vault.previewNoteCopy(source.id, 'copy.md')).rejects.toThrow('UTF-8');
  });

  it('cooperative budget failure releases the root lock', async () => {
    const { vault, source } = await fixture();
    let calls = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => ++calls < 3 ? 0 : 10_000);
    try { await expect(vault.previewNoteCopy(source.id, 'copy.md')).rejects.toThrow('budget'); }
    finally { clock.mockRestore(); }
    expect((await vault.previewNoteCopy(source.id, 'copy.md')).token).toHaveLength(64);
  });
  it.each(['.nodus-tmp-note', '.nodus-tmp-unknown', '.nodus-tmp-template-apply-operation'])('rejects uncertain artifact %s without removing it', async (name) => {
    const { vault, root, source } = await fixture();
    await writeFile(join(root, name), 'evidence');
    await expect(vault.previewNoteCopy(source.id, 'copy.md')).rejects.toThrow('artifact');
    expect(await readFile(join(root, name), 'utf8')).toBe('evidence');
  });
  it('rejects path traversal and case/NFC parent collisions', async () => {
    const { vault, root, source } = await fixture();
    await mkdir(join(root, 'Parent'));
    await mkdir(join(root, 'café'));
    for (const path of ['../escape.md', 'parent/copy.md', 'cafe\u0301/copy.md']) {
      await expect(vault.previewNoteCopy(source.id, path)).rejects.toThrow();
    }
  });

  it('rejects an entry disappearing between captures and releases coordination', async () => {
    const { vault, root, source } = await fixture();
    const originalBytes = await readFile(join(root, source.path));
    const internals = vault as unknown as { readBytes(entry: { path: string }): Promise<Buffer> };
    const original = internals.readBytes.bind(vault);
    let calls = 0;
    const spy = vi.spyOn(internals, 'readBytes').mockImplementation(async (entry) => {
      if (++calls === 2) await unlink(join(root, source.path));
      return original(entry);
    });
    try { await expect(vault.previewNoteCopy(source.id, 'copy.md')).rejects.toThrow(); }
    finally { spy.mockRestore(); }
    await writeFile(join(root, source.path), originalBytes);
    expect((await vault.previewNoteCopy(source.id, 'copy.md')).token).toHaveLength(64);
  });

  it('bounds initial attachment inspection before reading the whole destination directory', async () => {
    const { vault, root, source } = await fixture();
    await mkdir(join(root, 'attachments'));
    for (let n = 0; n < 8; n++) await writeFile(join(root, 'attachments', `${n}.txt`), 'data');
    const original = scan.boundedEntries;
    let observed: scan.TraversalBudget | undefined;
    const spy = vi.spyOn(scan, 'boundedEntries').mockImplementation(async (path, budget) => {
      observed = budget;
      budget.max = 3;
      return original(path, budget);
    });
    try {
      await expect(vault.previewNoteCopy(source.id, 'attachments/copy.md')).rejects.toThrow('limit');
      expect(observed?.count).toBe(4);
    } finally { spy.mockRestore(); }
  });
  it('charges final destination inspection to the same budget used by captures', async () => {
    const { vault, source } = await fixture();
    const original = scan.boundedEntries;
    const observed: scan.TraversalBudget[] = [];
    const starts: number[] = [];
    const spy = vi.spyOn(scan, 'boundedEntries').mockImplementation(async (path, budget) => {
      observed.push(budget); starts.push(budget.count);
      // Root has source.md and the existing coordination lock. Initial read
      // and two captures charge six entries; final revalidation reaches eight.
      budget.max = 7;
      return original(path, budget);
    });
    try {
      await expect(vault.previewNoteCopy(source.id, 'copy.md')).rejects.toThrow('limit');
      expect(observed).toHaveLength(2);
      expect(observed[0]).toBe(observed[1]);
      expect(starts).toEqual([0, 6]);
      expect(observed[1]!.count).toBe(8);
    } finally { spy.mockRestore(); }
    expect((await vault.previewNoteCopy(source.id, 'copy.md')).token).toHaveLength(64);
  });
  it('starts the deadline before attachment destination inspection', async () => {
    const { vault, root, source } = await fixture();
    await mkdir(join(root, 'attachments'));
    const clock = vi.spyOn(performance, 'now');
    let elapsed = 0;
    clock.mockImplementation(() => elapsed);
    const original = scan.boundedEntries;
    const spy = vi.spyOn(scan, 'boundedEntries').mockImplementation(async (path, budget) => {
      elapsed = 10_000;
      return original(path, budget);
    });
    try { await expect(vault.previewNoteCopy(source.id, 'attachments/copy.md')).rejects.toThrow('budget'); }
    finally { spy.mockRestore(); clock.mockRestore(); }
  });

});
