import { readFile, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createNote } from '../src/domain/note.js';
import * as format from '../src/format/note-format.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { VAULT_PROCESS_LOCK_FILE } from '../src/storage/fs/root-lock.js';
import { withTempDir } from './tmp.js';

const NOW = '2026-10-25T12:00:00Z';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const note = (id = A, path = 'a.md') => createNote({ id, path, title: 'Alpha', body: 'Café 😀', aliases: ['Alias'], now: NOW });

describe('byte-verified derived note snapshots', () => {
  it('bounds concurrent file reads even for a larger snapshot', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      for (let index = 0; index < 20; index++) await writeFile(join(root, `${index}.md`), `Plain ${index}`);
      const reads = vault as unknown as { readBytesAt(absolute: string, path: string): Promise<Buffer> };
      const original = reads.readBytesAt.bind(vault);
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const ready = new Promise<void>((resolve) => { started = resolve; });
      let active = 0;
      let maximum = 0;
      const spy = vi.spyOn(reads, 'readBytesAt').mockImplementation(async (...args) => {
        active++; maximum = Math.max(maximum, active);
        if (active === 8) started();
        try { await gate; return await original(...args); } finally { active--; }
      });
      const snapshot = vault.snapshotNotes();
      try {
        await ready;
        expect(active).toBe(8);
        expect(spy).toHaveBeenCalledTimes(8);
        release();
        expect(await snapshot).toHaveLength(20);
        expect(maximum).toBe(8);
      } finally { release(); await snapshot; spy.mockRestore(); }
    });
  });

  it('reuses parsing only for identical bytes and isolates returned metadata from its cache', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      const original = note();
      original.extraFrontmatter.custom = { values: ['preserved'] };
      await vault.createNote(original);
      const parse = vi.spyOn(format, 'parseNote');
      try {
        const first = await vault.snapshotNotes();
        first[0]!.title = 'Corrupted by caller';
        first[0]!.aliases.push('Injected');
        (first[0]!.extraFrontmatter.custom as { values: string[] }).values.push('Injected');
        const second = await vault.snapshotNotes();
        expect(second).toEqual([original]);
        expect(parse).toHaveBeenCalledTimes(1);
        const path = join(root, 'a.md');
        const before = await stat(path);
        const raw = await readFile(path, 'utf8');
        await writeFile(path, raw.replace('title: Alpha', 'title: Bravo'));
        await utimes(path, before.atime, before.mtime);
        expect((await vault.snapshotNotes())[0]!.title).toBe('Bravo');
        expect(parse).toHaveBeenCalledTimes(2);
        // Authoritative storage reads continue to parse the Markdown directly.
        expect((await vault.readNote(A)).title).toBe('Bravo');
        expect(parse).toHaveBeenCalledTimes(3);
      } finally { parse.mockRestore(); }
    });
  });

  it('refreshes creates, edits, moves, deletes and path-derived plain Markdown identities', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createNote(note());
      await vault.snapshotNotes();
      await vault.replaceNote({ ...note(), title: 'Renamed', body: 'New content' });
      await vault.moveNote(A, 'moved.md');
      await vault.createNote(note(B, 'b.md'));
      await writeFile(join(root, 'plain.md'), 'Plain body');
      const snapshot = await vault.snapshotNotes();
      expect(snapshot.find((item) => item.id === A)).toMatchObject({ path: 'moved.md', title: 'Renamed', body: 'New content' });
      const plain = snapshot.find((item) => item.path === 'plain.md')!;
      await rename(join(root, 'plain.md'), join(root, 'other.md'));
      await vault.deleteNote(B);
      const next = await vault.snapshotNotes();
      expect(next.some((item) => item.id === B || item.id === plain.id)).toBe(false);
      expect(next.find((item) => item.path === 'other.md')?.title).toBe('other');
      await unlink(join(root, 'moved.md'));
      expect((await vault.snapshotNotes()).map((item) => item.path)).toEqual(['other.md']);
    });
  });

  it('rejects corrupt bytes and duplicate IDs without publishing a partial cache, then recovers', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createNote(note());
      await vault.createNote(note(B, 'b.md'));
      await vault.snapshotNotes();
      const aPath = join(root, 'a.md');
      const bPath = join(root, 'b.md');
      const aRaw = await readFile(aPath, 'utf8');
      const bRaw = await readFile(bPath, 'utf8');
      await writeFile(aPath, aRaw.replace('Alpha', 'Bravo'));
      await writeFile(bPath, Buffer.from([0xff]));
      await expect(vault.snapshotNotes()).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
      await writeFile(bPath, bRaw);
      const parse = vi.spyOn(format, 'parseNote');
      try {
        expect((await vault.snapshotNotes())[0]?.title).toBe('Bravo');
        expect(parse).toHaveBeenCalledTimes(1); // a.md was not cached by the failed rebuild.
      } finally { parse.mockRestore(); }
      await writeFile(bPath, aRaw);
      await expect(vault.snapshotNotes()).rejects.toMatchObject({ code: 'DUPLICATE_ID' });
      await writeFile(bPath, bRaw.replace('version: 1', 'version: 999'));
      await expect(vault.snapshotNotes()).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' });
      await writeFile(bPath, bRaw);
      expect(await vault.snapshotNotes()).toHaveLength(2);
    });
  });

  it('drains failed batches before releasing the root lock and serializes overlapping snapshots', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createNote(note());
      await vault.createNote(note(B, 'b.md'));
      const reads = vault as unknown as { readBytesAt(absolute: string, path: string): Promise<Buffer> };
      const original = reads.readBytesAt.bind(vault);
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const waiting = new Promise<void>((resolve) => { started = resolve; });
      let failOnce = true;
      let active = 0;
      let maximum = 0;
      const spy = vi.spyOn(reads, 'readBytesAt').mockImplementation(async (absolute, path) => {
        active++; maximum = Math.max(maximum, active);
        try {
          if (path === 'a.md' && failOnce) { failOnce = false; throw new Error('injected read failure'); }
          if (path === 'b.md') { started(); await gate; }
          return await original(absolute, path);
        } finally { active--; }
      });
      let settled = false;
      const first = vault.snapshotNotes().finally(() => { settled = true; });
      const failure = expect(first).rejects.toThrow('injected read failure');
      try {
        await waiting;
        const second = vault.snapshotNotes();
        expect(settled).toBe(false);
        expect(await readFile(join(root, VAULT_PROCESS_LOCK_FILE), 'utf8')).toContain('"version":1');
        release();
        await failure;
        expect(await second).toHaveLength(2);
        expect(active).toBe(0);
        expect(maximum).toBeLessThanOrEqual(8);
      } finally { release(); spy.mockRestore(); }
    });
  });
});
