import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PluginManifestV1 } from '../../src/plugins/types.js';

export function pluginManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'nodus-plugin',
    formatVersion: 1,
    id: 'io.example.reader',
    name: 'Reader',
    version: '1.0.0',
    description: 'Example reader plugin.',
    author: 'Example',
    minNodusVersion: '0.1.0',
    pluginApiVersion: 1,
    entryPoint: 'dist/plugin.mjs',
    capabilities: ['commands.register', 'sidebar.register'],
    dependencies: [],
    ...overrides,
  };
}

export async function writePluginPackage(
  root: string,
  directoryName = 'io.example.reader',
  manifest: Record<string, unknown> = pluginManifest({ id: directoryName }),
): Promise<string> {
  const packagePath = join(root, directoryName);
  await mkdir(join(packagePath, 'dist'), { recursive: true });
  await writeFile(join(packagePath, 'nodus-plugin.json'), JSON.stringify(manifest));
  await writeFile(join(packagePath, 'dist', 'plugin.mjs'), 'export const metadataOnly = true;\n');
  return packagePath;
}

export function validTypedManifest(overrides: Partial<PluginManifestV1> = {}): PluginManifestV1 {
  return {
    format: 'nodus-plugin', formatVersion: 1, id: 'io.example.reader', name: 'Reader',
    version: '1.0.0', description: 'Example reader plugin.', author: 'Example',
    minNodusVersion: '0.1.0', pluginApiVersion: 1, entryPoint: 'dist/plugin.mjs',
    capabilities: ['commands.register'], dependencies: [], ...overrides,
  };
}
