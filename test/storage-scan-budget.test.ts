import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as fs from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { walkVault, boundedEntries } from '../src/storage/fs/scan.js';
import { withTempDir } from './tmp.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, opendir: vi.fn(actual.opendir) };
});

describe('shared vault traversal budget', () => {
  it('uses an inclusive entry maximum at max-1, max, and max+1', async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, 'one.md'), 'one');
      expect((await walkVault(root, { maxEntries: 2 })).entries).toHaveLength(1);
      await writeFile(join(root, 'two.md'), 'two');
      expect((await walkVault(root, { maxEntries: 2 })).entries).toHaveLength(2);
      await writeFile(join(root, 'three.md'), 'three');
      await expect(walkVault(root, { maxEntries: 2 })).rejects.toThrow(/inclusive 2-entry limit/);
    });
  });

  it('charges hidden entries against the inclusive budget', async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, '.hidden'), 'hidden');
      await writeFile(join(root, 'one.md'), 'one');
      await expect(walkVault(root, { maxEntries: 1 })).rejects.toThrow(/inclusive 1-entry limit/);
    });
  });

  it.each(['databases', 'database-views', 'attachments', 'ordinary'])('charges every child in %s before accumulating an oversized inventory', async (folder) => {
    await withTempDir(async (root) => {
      const directory = join(root, folder);
      await mkdir(directory);
      for (let n = 0; n < 6; n++) {
        if (folder === 'database-views') {
          await mkdir(join(directory, `db-${n}`));
          await writeFile(join(directory, `db-${n}`, 'view.json'), '{}');
        } else {
          const name = folder === 'attachments' ? `10000000-0000-4000-8000-00000000000${n}-asset.txt` : `${n}.${folder === 'databases' ? 'json' : 'md'}`;
          await writeFile(join(directory, name), 'data');
        }
      }
      await expect(walkVault(root, { maxEntries: 4 })).rejects.toThrow('limit');
      expect((await walkVault(root)).entries.length).toBe(6);
    });
  });
  it('shares the budget across directories and charges hidden entries', async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, 'a')); await mkdir(join(root, 'b'));
      await writeFile(join(root, 'a', '.hidden'), 'data');
      await writeFile(join(root, 'b', 'note.md'), 'data');
      await expect(walkVault(root, { maxEntries: 3 })).rejects.toThrow('limit');
      expect((await walkVault(root, { maxEntries: 5 })).entries).toHaveLength(1);
    });
  });
  it.each(['success', 'exhaustion', 'read failure', 'deadline'])('closes directory on %s and charges the overflow sentinel', async (mode) => {
    await withTempDir(async (root) => {
      await writeFile(join(root, 'note.md'), 'data');
      if (mode === 'exhaustion') await writeFile(join(root, 'second.md'), 'data');
      const real = await fs.opendir(root);
      const read = vi.spyOn(real, 'read');
      const close = vi.spyOn(real, 'close');
      if (mode === 'read failure') read.mockRejectedValueOnce(new Error('injected read failure'));
      const open = vi.spyOn(fs, 'opendir').mockResolvedValueOnce(real);
      let checks = 0;
      const budget = { count: 0, max: mode === 'exhaustion' ? 1 : 10, check: () => { if (mode === 'deadline' && ++checks === 3) throw new Error('deadline'); } };
      try {
        if (mode === 'success') expect(await boundedEntries(root, budget)).toHaveLength(1);
        else await expect(boundedEntries(root, budget)).rejects.toThrow(mode === 'exhaustion' ? 'limit' : mode === 'deadline' ? 'deadline' : 'read failure');
        expect(close).toHaveBeenCalledTimes(1);
        expect(read).toHaveBeenCalledTimes(mode === 'success' ? 2 : mode === 'exhaustion' ? 2 : 1);
        expect(budget.count).toBe(mode === 'read failure' ? 0 : mode === 'exhaustion' ? 2 : 1);
      } finally { open.mockRestore(); read.mockRestore(); close.mockRestore(); }
    });
  });

});
