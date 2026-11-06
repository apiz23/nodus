import type { PluginDiagnostic, PluginManifestV1 } from './types.js';
import { compareSemanticVersions, parseSemanticVersion } from './versions.js';

export interface PluginCompatibilityOptions {
  currentNodusVersion: string;
  supportedPluginApiVersions: readonly number[];
}

export function validatePluginCompatibility(
  manifest: Pick<PluginManifestV1, 'id' | 'minNodusVersion' | 'pluginApiVersion'>,
  options: PluginCompatibilityOptions,
): PluginDiagnostic[] {
  const diagnostics: PluginDiagnostic[] = [];
  const current = parseSemanticVersion(options.currentNodusVersion);
  const minimum = parseSemanticVersion(manifest.minNodusVersion);
  if (!current) {
    diagnostics.push({ code: 'NODUS_VERSION_INVALID', severity: 'error', message: 'The running Nodus version is not a supported stable major.minor.patch version.', pluginId: manifest.id });
  } else if (minimum && compareSemanticVersions(current, minimum) < 0) {
    diagnostics.push({ code: 'NODUS_VERSION_INCOMPATIBLE', severity: 'error', message: `Plugin requires Nodus ${manifest.minNodusVersion} or later.`, pluginId: manifest.id, field: 'minNodusVersion' });
  }
  if (!options.supportedPluginApiVersions.includes(manifest.pluginApiVersion)) {
    diagnostics.push({ code: 'PLUGIN_API_UNSUPPORTED', severity: 'error', message: `Plugin API version ${manifest.pluginApiVersion} is not supported by this Nodus version.`, pluginId: manifest.id, field: 'pluginApiVersion' });
  }
  return diagnostics;
}
