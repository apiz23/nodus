export { PLUGIN_MANIFEST_FILE, PLUGIN_MANIFEST_FORMAT, PLUGIN_MANIFEST_FORMAT_VERSION, PLUGIN_PACKAGE_LIMITS, SUPPORTED_PLUGIN_API_VERSIONS, SUPPORTED_PLUGIN_CAPABILITIES } from './constants.js';
export { validatePluginCompatibility, type PluginCompatibilityOptions } from './compatibility.js';
export { resolvePluginDependencies } from './dependencies.js';
export { validatePluginManifest, isPluginId } from './manifest-validator.js';
export { discoverPluginPackages, type PluginDiscoveryOptions, type PluginDiscoveryResult } from './package-discovery.js';
export { fingerprintPluginInventory, inventoryPluginPackage } from './package-inventory.js';
export { createPluginRegistry } from './registry.js';
export { compareSemanticVersions, isSupportedVersionRange, parseSemanticVersion, satisfiesVersionRange } from './versions.js';
export type {
  PluginCapability,
  PluginCompatibilityStatus,
  PluginDependency,
  PluginDependencyInput,
  PluginDependencyResolution,
  PluginDependencyStatus,
  PluginDiagnostic,
  PluginDiagnosticCode,
  PluginDiagnosticSeverity,
  PluginManifestV1,
  PluginManifestMetadata,
  PluginManifestValidationOptions,
  PluginManifestValidationResult,
  PluginPackageCandidate,
  PluginPackageFile,
  PluginPackageInventory,
  PluginRegistry,
  PluginRegistryEntry,
} from './types.js';
