import { describe, expect, it } from 'vitest';
import { createPluginRegistry } from '../../src/plugins/registry.js';
import type { PluginPackageCandidate } from '../../src/plugins/types.js';
import { validTypedManifest } from './helpers.js';

function candidate(id: string, directoryName = id, fingerprint = id.padEnd(64, '0')): PluginPackageCandidate {
  return {
    directoryName,
    packagePath: `/virtual/${directoryName}`,
    manifest: validTypedManifest({ id, name: directoryName.split('.').at(-1) ?? directoryName }),
    metadata: { pluginId: id, name: directoryName.split('.').at(-1) ?? directoryName, version: '1.0.0' },
    fingerprint,
    inventory: [],
    diagnostics: [],
    compatibility: 'compatible',
    dependencyStatus: 'satisfied',
  };
}

describe('in-memory plugin registry', () => {
  it('registers metadata deterministically without runtime or activation state', () => {
    const registry = createPluginRegistry([candidate('io.example.zulu'), candidate('io.example.alpha')]);
    expect(registry.entries.map((entry) => entry.pluginId)).toEqual(['io.example.alpha', 'io.example.zulu']);
    expect(registry.dependencyOrder).toEqual(['io.example.alpha', 'io.example.zulu']);
    expect(registry.entries.every((entry) => entry.discoveryStatus === 'discovered')).toBe(true);
    expect(registry.entries[0]).not.toHaveProperty('active');
    expect(registry.entries[0]).not.toHaveProperty('enabled');
  });

  it('keeps invalid packages inspectable with their diagnostics', () => {
    const invalid = candidate('io.example.bad');
    invalid.fingerprint = null;
    invalid.manifest = null;
    invalid.metadata = { pluginId: 'io.example.bad', name: 'Bad', version: '1.0.0' };
    invalid.diagnostics = [{ code: 'MANIFEST_JSON_INVALID', severity: 'error', path: 'nodus-plugin.json', message: 'Manifest is not valid JSON.' }];
    invalid.compatibility = 'unknown';
    const registry = createPluginRegistry([invalid]);
    expect(registry.entries).toHaveLength(1);
    expect(registry.entries[0]?.discoveryStatus).toBe('invalid');
    expect(registry.entries[0]?.pluginId).toBe('io.example.bad');
    expect(registry.entries[0]?.version).toBe('1.0.0');
    expect(registry.entries[0]?.diagnostics[0]?.code).toBe('MANIFEST_JSON_INVALID');
  });

  it('rejects duplicate IDs for use while retaining both packages for inspection', () => {
    const registry = createPluginRegistry([candidate('io.example.same', 'copy-one'), candidate('io.example.same', 'copy-two')]);
    expect(registry.entries).toHaveLength(2);
    expect(registry.entries.every((entry) => entry.discoveryStatus === 'invalid')).toBe(true);
    expect(registry.entries.every((entry) => entry.diagnostics.some((item) => item.code === 'PLUGIN_ID_DUPLICATE'))).toBe(true);
    expect(registry.dependencyOrder).toEqual([]);
  });

  it('retains package fingerprint and parsed metadata on valid entries', () => {
    const value = candidate('io.example.reader');
    const registry = createPluginRegistry([value]);
    expect(registry.entries[0]).toMatchObject({ pluginId: 'io.example.reader', fingerprint: value.fingerprint, name: 'reader', version: '1.0.0', compatibility: 'compatible', dependencyStatus: 'satisfied' });
  });
});
