import { access, chmod, mkdtemp, mkdir, readdir, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverPluginPackages } from '../../src/plugins/package-discovery.js';
import { inventoryPluginPackage } from '../../src/plugins/package-inventory.js';
import { writePluginPackage } from './helpers.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function makeRoot(): Promise<string> { const path = await mkdtemp(join(tmpdir(), 'nodus-plugin-test-')); roots.push(path); return path; }
const options = { currentNodusVersion: '0.1.0' };

describe('plugin package discovery and inventory', () => {
  it('returns an empty discovery result for a missing root and empty root', async () => {
    const parent = await makeRoot();
    expect(await discoverPluginPackages(join(parent, 'missing'), options)).toEqual({ candidates: [], diagnostics: [] });
    expect(await discoverPluginPackages(parent, options)).toEqual({ candidates: [], diagnostics: [] });
  });

  it('discovers a valid package deterministically and inventories the entrypoint without executing it', async () => {
    const root = await makeRoot();
    const packagePath = await writePluginPackage(root);
    const marker = join(root, 'executed-marker');
    await writeFile(join(packagePath, 'dist', 'plugin.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'ran');`);
    const first = await discoverPluginPackages(root, options);
    const second = await discoverPluginPackages(root, options);
    expect(first.candidates).toHaveLength(1);
    expect(first.candidates[0]?.manifest?.id).toBe('io.example.reader');
    expect(first.candidates[0]?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.candidates[0]?.inventory.map((file) => file.path)).toEqual(['dist/plugin.mjs', 'nodus-plugin.json']);
    expect(second.candidates[0]?.fingerprint).toBe(first.candidates[0]?.fingerprint);
    // The package entrypoint is never imported by discovery; its marker is only written by execution.
    await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reports symlinked packages and symlinked package files without following them', async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    await writePluginPackage(outside);
    await symlink(join(outside, 'io.example.reader'), join(root, 'io.example.reader'));
    const result = await discoverPluginPackages(root, options);
    expect(result.diagnostics.some((item) => item.code === 'PACKAGE_SYMLINK')).toBe(true);

    const secondRoot = await makeRoot();
    const packagePath = await writePluginPackage(secondRoot);
    await rm(join(packagePath, 'dist', 'plugin.mjs'));
    await symlink(join(outside, 'io.example.reader', 'dist', 'plugin.mjs'), join(packagePath, 'dist', 'plugin.mjs'));
    const second = await discoverPluginPackages(secondRoot, options);
    expect(second.candidates[0]?.diagnostics.some((item) => item.code === 'PACKAGE_SYMLINK')).toBe(true);
    expect(second.candidates[0]?.fingerprint).toBeNull();
  });

  it('rejects traversal entrypoints, directory ID mismatch, and duplicate manifest IDs', async () => {
    const root = await makeRoot();
    await writePluginPackage(root, 'io.example.bad', { format: 'nodus-plugin', formatVersion: 1, id: 'io.example.bad', name: 'Bad', version: '1.0.0', description: 'Bad', author: 'A', minNodusVersion: '0.1.0', pluginApiVersion: 1, entryPoint: '../escape.mjs', capabilities: [], dependencies: [] });
    await writePluginPackage(root, 'io.example.copy', { format: 'nodus-plugin', formatVersion: 1, id: 'io.example.reader', name: 'Copy', version: '1.0.0', description: 'Copy', author: 'A', minNodusVersion: '0.1.0', pluginApiVersion: 1, entryPoint: 'dist/plugin.mjs', capabilities: [], dependencies: [] });
    await writePluginPackage(root, 'io.example.reader');
    const result = await discoverPluginPackages(root, options);
    expect(result.candidates.find((candidate) => candidate.directoryName === 'io.example.bad')?.diagnostics.some((item) => item.code === 'ENTRYPOINT_PATH_INVALID')).toBe(true);
    expect(result.candidates.find((candidate) => candidate.directoryName === 'io.example.copy')?.diagnostics.some((item) => item.code === 'PLUGIN_DIRECTORY_ID_MISMATCH')).toBe(true);
    expect(result.candidates.filter((candidate) => candidate.manifest?.id === 'io.example.reader').every((candidate) => candidate.diagnostics.some((item) => item.code === 'PLUGIN_ID_DUPLICATE'))).toBe(true);
  });

  it('validates the exact manifest bytes as strict UTF-8 during discovery', async () => {
    const root = await makeRoot();
    const packagePath = await writePluginPackage(root);
    await writeFile(join(packagePath, 'nodus-plugin.json'), Buffer.from([0xff, 0xfe]));
    const result = await discoverPluginPackages(root, options);
    expect(result.candidates[0]?.diagnostics.some((item) => item.code === 'MANIFEST_JSON_INVALID')).toBe(true);
  });

  it('rejects oversized files and excessive package inventories', async () => {
    const root = await makeRoot();
    const packagePath = await writePluginPackage(root);
    await truncate(join(packagePath, 'dist', 'plugin.mjs'), 16 * 1024 * 1024 + 1);
    const oversized = await inventoryPluginPackage(packagePath);
    expect(oversized.diagnostics.some((item) => item.code === 'PACKAGE_FILE_TOO_LARGE')).toBe(true);

    const inventoryRoot = await makeRoot();
    const inventoryPackage = await writePluginPackage(inventoryRoot);
    for (let index = 0; index < 2_001; index += 1) await writeFile(join(inventoryPackage, `file-${String(index).padStart(4, '0')}.txt`), 'x');
    const excessive = await inventoryPluginPackage(inventoryPackage);
    expect(excessive.diagnostics.some((item) => item.code === 'PACKAGE_FILE_LIMIT_EXCEEDED')).toBe(true);
  });

  it('returns a structured diagnostic for an unusable root', async () => {
    const root = await makeRoot();
    const file = join(root, 'not-a-directory');
    await writeFile(file, 'file');
    const result = await discoverPluginPackages(file, options);
    expect(result.candidates).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe('PACKAGE_ROOT_INVALID');
  });

  it('rejects invalid package directory names and symlinked roots', async () => {
    const parent = await makeRoot();
    const root = join(parent, 'plugins');
    await mkdir(root);
    await writePluginPackage(root, 'Bad Name', { format: 'nodus-plugin', formatVersion: 1, id: 'io.example.bad', name: 'Bad', version: '1.0.0', description: 'Bad', author: 'A', minNodusVersion: '0.1.0', pluginApiVersion: 1, entryPoint: 'dist/plugin.mjs', capabilities: [], dependencies: [] });
    const invalidName = await discoverPluginPackages(root, options);
    expect(invalidName.candidates[0]?.diagnostics.some((item) => item.code === 'PLUGIN_ID_INVALID')).toBe(true);

    const linkedRoot = join(parent, 'linked-root');
    await symlink(root, linkedRoot);
    expect((await discoverPluginPackages(linkedRoot, options)).diagnostics[0]?.code).toBe('PACKAGE_ROOT_INVALID');
  });

  it('retains invalid package metadata and marks required dependents invalid', async () => {
    const root = await makeRoot();
    await writePluginPackage(root, 'io.example.base', {
      format: 'nodus-plugin', formatVersion: 1, id: 'io.example.base', name: 'Base', version: '1.0.0',
      description: 'Base', author: 'A', minNodusVersion: '0.1.0', pluginApiVersion: 99,
      entryPoint: 'dist/plugin.mjs', capabilities: [], dependencies: [],
    });
    await writePluginPackage(root, 'io.example.consumer', {
      format: 'nodus-plugin', formatVersion: 1, id: 'io.example.consumer', name: 'Consumer', version: '1.0.0',
      description: 'Consumer', author: 'A', minNodusVersion: '0.1.0', pluginApiVersion: 1,
      entryPoint: 'dist/plugin.mjs', capabilities: [], dependencies: [{ id: 'io.example.base', range: '^1.0.0' }],
    });
    const result = await discoverPluginPackages(root, options);
    const base = result.candidates.find((candidate) => candidate.directoryName === 'io.example.base')!;
    const dependent = result.candidates.find((candidate) => candidate.directoryName === 'io.example.consumer')!;
    expect(base.manifest).toBeNull();
    expect(base.metadata).toMatchObject({ pluginId: 'io.example.base', name: 'Base', version: '1.0.0' });
    expect(dependent.diagnostics.some((item) => item.code === 'DEPENDENCY_INVALID')).toBe(true);
    expect(dependent.dependencyStatus).toBe('unsatisfied');
  });

  it('rejects package paths that collide by case on common filesystems', async () => {
    const root = await makeRoot();
    const packagePath = await writePluginPackage(root);
    await writeFile(join(packagePath, 'Readme.txt'), 'a');
    await writeFile(join(packagePath, 'README.txt'), 'b');
    const names = await readdir(packagePath);
    if (!names.includes('Readme.txt') || !names.includes('README.txt')) return;
    const result = await inventoryPluginPackage(packagePath);
    expect(result.diagnostics.some((item) => item.code === 'PACKAGE_PATH_INVALID' && item.message.includes('case-insensitive'))).toBe(true);
    expect(result.fingerprint).toBeNull();
  });

  it('rejects directory nesting beyond the centralized limit', async () => {
    const root = await makeRoot();
    const packagePath = await writePluginPackage(root);
    let deep = packagePath;
    for (let index = 0; index < 17; index += 1) { deep = join(deep, `d${index}`); await mkdir(deep); }
    await writeFile(join(deep, 'leaf.txt'), 'leaf');
    const result = await inventoryPluginPackage(packagePath);
    expect(result.diagnostics.some((item) => item.code === 'PACKAGE_DEPTH_LIMIT_EXCEEDED')).toBe(true);
  });

  it('reports package-directory permission failures without leaking absolute paths', async () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;
    const root = await makeRoot();
    const packagePath = await writePluginPackage(root);
    const blocked = join(packagePath, 'blocked');
    await mkdir(blocked);
    await chmod(blocked, 0);
    try {
      const result = await inventoryPluginPackage(packagePath);
      expect(result.diagnostics.some((item) => item.code === 'PACKAGE_READ_FAILED' && item.path === 'blocked')).toBe(true);
      expect(JSON.stringify(result.diagnostics)).not.toContain(packagePath);
    } finally { await chmod(blocked, 0o700); }
  });

  it('enforces the total byte limit without unsafe integer accumulation', async () => {
    const root = await makeRoot();
    const packagePath = await writePluginPackage(root);
    for (let index = 0; index < 5; index += 1) {
      const blob = join(packagePath, `blob-${index}.bin`);
      await writeFile(blob, '');
      await truncate(blob, 15 * 1024 * 1024);
    }
    const result = await inventoryPluginPackage(packagePath);
    expect(result.diagnostics.some((item) => item.code === 'PACKAGE_SIZE_LIMIT_EXCEEDED')).toBe(true);
    expect(result.fingerprint).toBeNull();
  });
});
