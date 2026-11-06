import { describe, expect, it } from 'vitest';
import { PLUGIN_PACKAGE_LIMITS } from '../../src/plugins/constants.js';
import { validatePluginManifest } from '../../src/plugins/manifest-validator.js';
import { isSupportedVersionRange, parseSemanticVersion, satisfiesVersionRange } from '../../src/plugins/versions.js';
import { pluginManifest } from './helpers.js';

const options = { currentNodusVersion: '0.1.0' };
const validate = (value: unknown) => validatePluginManifest(JSON.stringify(value), options);

describe('plugin manifest validation', () => {
  it('accepts the v1 manifest shape without loading its entry point', () => {
    const result = validate(pluginManifest());
    expect(result.manifest?.id).toBe('io.example.reader');
    expect(result.manifest?.dependencies).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('treats omitted dependencies as an empty local dependency list', () => {
    const manifest = pluginManifest();
    delete manifest.dependencies;
    expect(validate(manifest).manifest?.dependencies).toEqual([]);
  });

  it('returns structured errors for malformed JSON, root values, and missing required fields', () => {
    expect(validatePluginManifest('{', options).diagnostics[0]?.code).toBe('MANIFEST_JSON_INVALID');
    expect(validatePluginManifest('[]', options).diagnostics[0]?.code).toBe('MANIFEST_ROOT_INVALID');
    expect(validate({}).diagnostics.some((item) => item.code === 'MANIFEST_FIELD_REQUIRED')).toBe(true);
    expect(validatePluginManifest(Uint8Array.from([0xff, 0xfe]), options).diagnostics[0]?.code).toBe('MANIFEST_JSON_INVALID');
  });

  it('rejects unknown fields in v1, including an unimplemented config schema', () => {
    const result = validate(pluginManifest({ unexpected: true, configSchema: { type: 'object' } }));
    expect(result.manifest).toBeNull();
    expect(result.diagnostics.filter((item) => item.code === 'MANIFEST_UNKNOWN_FIELD')).toHaveLength(2);
  });

  it.each(['Io.example.reader', 'io..reader', 'reader', 'io.example/reader', 'io.exämple.reader', 'io.example.reader.'])('rejects invalid stable ID %s', (id) => {
    expect(validate(pluginManifest({ id })).diagnostics.some((item) => item.code === 'PLUGIN_ID_INVALID')).toBe(true);
  });

  it.each(['1.0', '01.0.0', '1.0.0-beta', '1.0.0+build', '9007199254740992.0.0'])('rejects malformed semantic version %s', (version) => {
    expect(parseSemanticVersion(version)).toBeNull();
    expect(validate(pluginManifest({ version })).diagnostics.some((item) => item.code === 'PLUGIN_VERSION_INVALID')).toBe(true);
  });

  it('rejects unsupported manifest and plugin API versions and newer minimum Nodus requirements', () => {
    expect(validate(pluginManifest({ formatVersion: 2 })).diagnostics.some((item) => item.code === 'MANIFEST_FORMAT_UNSUPPORTED')).toBe(true);
    expect(validate(pluginManifest({ pluginApiVersion: 2 })).diagnostics.some((item) => item.code === 'PLUGIN_API_UNSUPPORTED')).toBe(true);
    expect(validate(pluginManifest({ minNodusVersion: '2.0.0' })).diagnostics.some((item) => item.field === 'minNodusVersion')).toBe(true);
  });

  it.each(['../outside.mjs', '/absolute.mjs', 'dist\\plugin.mjs', 'dist//plugin.mjs', 'dist/plugin.js', 'dist/./plugin.mjs'])('rejects unsafe entrypoint %s', (entryPoint) => {
    expect(validate(pluginManifest({ entryPoint })).diagnostics.some((item) => item.code === 'ENTRYPOINT_PATH_INVALID')).toBe(true);
  });

  it('rejects duplicate and unsupported capabilities', () => {
    const result = validate(pluginManifest({ capabilities: ['commands.register', 'commands.register', 'workspace.read'] }));
    expect(result.diagnostics.some((item) => item.code === 'CAPABILITY_DUPLICATE')).toBe(true);
    expect(result.diagnostics.some((item) => item.code === 'CAPABILITY_UNSUPPORTED')).toBe(true);
  });

  it('rejects duplicate and malformed dependency declarations', () => {
    const result = validate(pluginManifest({ dependencies: [
      { id: 'io.example.shared', range: '^1.0.0' },
      { id: 'io.example.shared', range: 'latest' },
    ] }));
    expect(result.diagnostics.some((item) => item.code === 'DEPENDENCY_DUPLICATE')).toBe(true);
    expect(result.diagnostics.some((item) => item.code === 'DEPENDENCY_INVALID')).toBe(true);
  });

  it('enforces string, collection, and manifest byte limits', () => {
    expect(validate(pluginManifest({ name: 'x'.repeat(81) })).diagnostics.some((item) => item.field === 'name')).toBe(true);
    expect(validate(pluginManifest({ capabilities: Array(PLUGIN_PACKAGE_LIMITS.capabilities + 1).fill('commands.register') })).diagnostics.some((item) => item.field === 'capabilities')).toBe(true);
    const oversized = `${JSON.stringify(pluginManifest())}${' '.repeat(PLUGIN_PACKAGE_LIMITS.manifestBytes)}`;
    expect(validatePluginManifest(oversized, options).diagnostics[0]?.code).toBe('MANIFEST_TOO_LARGE');
  });

  it('uses the documented stable SemVer range subset', () => {
    expect(isSupportedVersionRange('1.2.3')).toBe(true);
    expect(isSupportedVersionRange('^1.2.3')).toBe(true);
    expect(isSupportedVersionRange('~1.2.3')).toBe(true);
    expect(isSupportedVersionRange('>=1.2.0 <2.0.0')).toBe(true);
    expect(isSupportedVersionRange('*')).toBe(false);
    expect(satisfiesVersionRange('1.8.0', '^1.2.3')).toBe(true);
    expect(satisfiesVersionRange('2.0.0', '^1.2.3')).toBe(false);
    expect(satisfiesVersionRange('1.2.4', '~1.2.3')).toBe(true);
    expect(satisfiesVersionRange('1.3.0', '~1.2.3')).toBe(false);
  });
});
