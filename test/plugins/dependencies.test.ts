import { describe, expect, it } from 'vitest';
import { resolvePluginDependencies } from '../../src/plugins/dependencies.js';
import type { PluginDependencyInput } from '../../src/plugins/types.js';

const plugin = (id: string, version = '1.0.0', dependencies: PluginDependencyInput['dependencies'] = [], initiallyValid = true): PluginDependencyInput => ({ id, version, dependencies, initiallyValid });
const dep = (id: string, range = '^1.0.0', optional = false) => ({ id, range, optional });

describe('plugin dependency validation and ordering', () => {
  it('places dependencies before dependents and uses stable ID ordering for ties', () => {
    const result = resolvePluginDependencies([
      plugin('io.example.zulu'), plugin('io.example.alpha'), plugin('io.example.child', '1.0.0', [dep('io.example.zulu')]),
    ]);
    expect(result.order).toEqual(['io.example.alpha', 'io.example.zulu', 'io.example.child']);
    expect(result.invalidPluginIds).toEqual([]);
  });

  it('reports missing required dependencies and warns for missing optional dependencies', () => {
    const result = resolvePluginDependencies([
      plugin('io.example.required', '1.0.0', [dep('io.example.missing')]),
      plugin('io.example.optional', '1.0.0', [dep('io.example.also-missing', '^1.0.0', true)]),
    ]);
    expect(result.invalidPluginIds).toContain('io.example.required');
    expect(result.order).toContain('io.example.optional');
    expect(result.diagnostics.find((item) => item.pluginId === 'io.example.optional')?.severity).toBe('warning');
  });

  it('rejects incompatible required dependency versions', () => {
    const result = resolvePluginDependencies([
      plugin('io.example.base', '2.0.0'), plugin('io.example.child', '1.0.0', [dep('io.example.base', '^1.0.0')]),
    ]);
    expect(result.invalidPluginIds).toContain('io.example.child');
    expect(result.diagnostics.some((item) => item.code === 'DEPENDENCY_VERSION_MISMATCH')).toBe(true);
  });

  it('detects duplicate identities and duplicate dependency declarations', () => {
    const result = resolvePluginDependencies([
      plugin('io.example.same'), plugin('io.example.same'),
      plugin('io.example.consumer', '1.0.0', [dep('io.example.base'), dep('io.example.base')]),
      plugin('io.example.base'),
    ]);
    expect(result.diagnostics.some((item) => item.code === 'PLUGIN_ID_DUPLICATE')).toBe(true);
    expect(result.invalidPluginIds).toContain('io.example.same');
    expect(result.diagnostics.some((item) => item.code === 'DEPENDENCY_DUPLICATE')).toBe(true);
  });

  it('detects direct and indirect cycles and invalidates required dependents', () => {
    const direct = resolvePluginDependencies([plugin('io.example.direct', '1.0.0', [dep('io.example.direct')])]);
    expect(direct.invalidPluginIds).toContain('io.example.direct');
    const indirect = resolvePluginDependencies([
      plugin('io.example.a', '1.0.0', [dep('io.example.b')]),
      plugin('io.example.b', '1.0.0', [dep('io.example.c')]),
      plugin('io.example.c', '1.0.0', [dep('io.example.a')]),
      plugin('io.example.dependent', '1.0.0', [dep('io.example.a')]),
    ]);
    expect(indirect.invalidPluginIds).toEqual(['io.example.a', 'io.example.b', 'io.example.c', 'io.example.dependent']);
    expect(indirect.diagnostics.some((item) => item.code === 'DEPENDENCY_CYCLE')).toBe(true);
    expect(indirect.diagnostics.some((item) => item.pluginId === 'io.example.dependent' && item.code === 'DEPENDENCY_INVALID')).toBe(true);
  });

  it('propagates an already-invalid dependency without invalidating optional consumers', () => {
    const result = resolvePluginDependencies([
      plugin('io.example.bad', '1.0.0', [], false),
      plugin('io.example.required', '1.0.0', [dep('io.example.bad')]),
      plugin('io.example.optional', '1.0.0', [dep('io.example.bad', '^1.0.0', true)]),
    ]);
    expect(result.invalidPluginIds).toContain('io.example.required');
    expect(result.invalidPluginIds).not.toContain('io.example.optional');
    expect(result.diagnostics.some((item) => item.pluginId === 'io.example.optional' && item.severity === 'warning')).toBe(true);
  });
});
