import { resolvePluginDependencies } from './dependencies.js';
import type { PluginPackageCandidate, PluginRegistry, PluginRegistryEntry } from './types.js';

/** Build an immutable-by-convention, in-memory metadata registry. No code is loaded. */
export function createPluginRegistry(candidates: readonly PluginPackageCandidate[]): PluginRegistry {
  const dependencyResult = resolvePluginDependencies(candidates.filter((candidate) => candidate.metadata !== null && candidate.metadata.pluginId !== null && candidate.metadata.version !== null).map((candidate) => ({
    id: candidate.metadata!.pluginId!,
    version: candidate.metadata!.version!,
    dependencies: candidate.manifest?.dependencies ?? [],
    initiallyValid: candidate.manifest !== null && candidate.diagnostics.every((item) => item.severity !== 'error'),
  })));
  const entries: PluginRegistryEntry[] = candidates.map((candidate) => {
    const pluginId = candidate.manifest?.id ?? candidate.metadata?.pluginId ?? candidate.diagnostics.find((item) => item.pluginId)?.pluginId ?? null;
    const dependencyDiagnostics = dependencyResult.diagnostics.filter((item) => item.pluginId === pluginId);
    const diagnostics = [...candidate.diagnostics, ...dependencyDiagnostics]
      .filter((item, index, all) => all.findIndex((other) => other.code === item.code && other.field === item.field && other.path === item.path && other.message === item.message) === index)
      .sort(compareDiagnostic);
    const compatible = candidate.compatibility === 'compatible' && candidate.manifest !== null;
    const valid = candidate.manifest !== null && candidate.fingerprint !== null && diagnostics.every((item) => item.severity !== 'error');
    const hasDependencyError = diagnostics.some((item) => item.severity === 'error' && (item.code.startsWith('DEPENDENCY_') || item.code === 'PLUGIN_ID_DUPLICATE'));
    const dependencyStatus: PluginRegistryEntry['dependencyStatus'] = candidate.metadata === null || candidate.metadata.pluginId === null
      ? 'unknown'
      : hasDependencyError ? 'unsatisfied' : candidate.manifest === null ? 'unknown' : 'satisfied';
    const discoveryStatus: PluginRegistryEntry['discoveryStatus'] = valid ? 'discovered' : 'invalid';
    return {
      pluginId,
      name: candidate.manifest?.name ?? candidate.metadata?.name ?? candidate.directoryName,
      version: candidate.manifest?.version ?? candidate.metadata?.version ?? null,
      packagePath: candidate.packagePath,
      fingerprint: candidate.fingerprint,
      manifest: candidate.manifest,
      metadata: candidate.metadata,
      diagnostics,
      compatibility: candidate.manifest === null ? candidate.compatibility : compatible ? 'compatible' : 'incompatible',
      dependencyStatus,
      discoveryStatus,
    };
  }).sort((left, right) => compare(left.pluginId ?? left.name, right.pluginId ?? right.name) || compare(left.packagePath, right.packagePath));
  return { entries, dependencyOrder: dependencyResult.order };
}

function compareDiagnostic(left: PluginRegistryEntry['diagnostics'][number], right: PluginRegistryEntry['diagnostics'][number]): number {
  return compare(left.code, right.code) || compare(left.field ?? '', right.field ?? '') || compare(left.path ?? '', right.path ?? '') || compare(left.message, right.message);
}
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
