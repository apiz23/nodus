import { mkdir, truncate, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planImport } from '../src/storage/portable/import.js';
import { walkVault } from '../src/storage/fs/scan.js';
import {
  IMPORT_MAX_PACKAGE_BYTES,
  IMPORT_MAX_FILESYSTEM_ENTRIES,
  IMPORT_MAX_PATH_DEPTH,
  IMPORT_MAX_RESOURCE_BYTES,
  IMPORT_MAX_RESOURCES,
  validateImportResourceLimits,
} from '../src/storage/portable/limits.js';
import { withTempDir } from './tmp.js';

describe('portable import resource limits', () => {
  it('accepts inventory exactly within configured count, byte, and depth bounds', () => {
    expect(() => validateImportResourceLimits([
      { path: `${Array.from({ length: IMPORT_MAX_PATH_DEPTH - 1 }, (_, index) => `d${index}`).join('/')}/note.md`, bytes: IMPORT_MAX_RESOURCE_BYTES },
      { path: 'other-a.md', bytes: IMPORT_MAX_RESOURCE_BYTES },
      { path: 'other-b.md', bytes: IMPORT_MAX_RESOURCE_BYTES },
      { path: 'other-c.md', bytes: IMPORT_MAX_RESOURCE_BYTES },
    ])).not.toThrow();
    expect(() => validateImportResourceLimits([
      { path: 'a.md', bytes: IMPORT_MAX_RESOURCE_BYTES },
      { path: 'b.md', bytes: IMPORT_MAX_RESOURCE_BYTES },
      { path: 'c.md', bytes: IMPORT_MAX_RESOURCE_BYTES },
      { path: 'd.md', bytes: IMPORT_MAX_PACKAGE_BYTES - 3 * IMPORT_MAX_RESOURCE_BYTES },
    ])).not.toThrow();
    expect(IMPORT_MAX_RESOURCES).toBeGreaterThan(0);
  });

  it('rejects too many resources, oversized files, oversized packages, and excessive path depth', () => {
    expect(() => validateImportResourceLimits(Array.from({ length: IMPORT_MAX_RESOURCES + 1 }, (_, index) => ({ path: `n${index}.md`, bytes: 0 })))).toThrow(/resources.*limit/i);
    expect(() => validateImportResourceLimits([{ path: 'large.md', bytes: IMPORT_MAX_RESOURCE_BYTES + 1 }])).toThrow(/per-resource limit/i);
    expect(() => validateImportResourceLimits([
      { path: 'a.md', bytes: IMPORT_MAX_RESOURCE_BYTES },
      { path: 'b.md', bytes: IMPORT_MAX_RESOURCE_BYTES },
      { path: 'c.md', bytes: IMPORT_MAX_RESOURCE_BYTES },
      { path: 'd.md', bytes: IMPORT_MAX_RESOURCE_BYTES },
      { path: 'e.md', bytes: 1 },
    ])).toThrow(/total resource limit/i);
    expect(() => validateImportResourceLimits([{ path: `${Array.from({ length: IMPORT_MAX_PATH_DEPTH }, (_, index) => `d${index}`).join('/')}/note.md`, bytes: 1 }])).toThrow(/depth limit/i);
  });

  it('rejects a legacy package over the byte cap from stat inventory before parsing or writing', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'source');
      await mkdir(join(source, 'notes'), { recursive: true });
      for (let index = 0; index < 5; index += 1) {
        const path = join(source, 'notes', `large-${index}.md`);
        await writeFile(path, `# Large ${index}\n\n`);
        await truncate(path, 60 * 1024 * 1024);
      }
      await expect(planImport(source)).rejects.toThrow(/total resource limit/i);
    });
  });

  it('rejects excessive folder depth before traversing the deeper subtree', async () => {
    await withTempDir(async (dir) => {
      let path = dir;
      for (let index = 0; index < IMPORT_MAX_PATH_DEPTH + 1; index += 1) {
        path = join(path, `d${index}`);
      }
      await mkdir(path, { recursive: true });
      await expect(planImport(dir)).rejects.toMatchObject({ code: 'INVALID_CONTENT' });
    });
  });

  it('bounds ignored filesystem entries too, so a legacy folder cannot evade the inventory ceiling', async () => {
    await withTempDir(async (dir) => {
      const source = join(dir, 'source');
      await mkdir(source, { recursive: true });
      await writeFile(join(source, 'one.bin'), 'ignored');
      await writeFile(join(source, 'two.bin'), 'ignored');
      expect(IMPORT_MAX_FILESYSTEM_ENTRIES).toBeGreaterThan(1);
      const inventory = await walkVault(source, { maxEntries: 1 });
      expect(inventory.issues[0]?.message).toMatch(/inventory exceeds/i);
    });
  });
});
