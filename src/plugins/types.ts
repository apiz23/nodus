import type { SUPPORTED_PLUGIN_CAPABILITIES } from './constants.js';

export type PluginCapability = typeof SUPPORTED_PLUGIN_CAPABILITIES[number];
export type PluginDiagnosticSeverity = 'error' | 'warning' | 'info';

/** Stable codes are suitable for UI localization and automated tests. */
export type PluginDiagnosticCode =
  | 'MANIFEST_TOO_LARGE' | 'MANIFEST_JSON_INVALID' | 'MANIFEST_ROOT_INVALID'
  | 'MANIFEST_FIELD_REQUIRED' | 'MANIFEST_FIELD_INVALID' | 'MANIFEST_UNKNOWN_FIELD'
  | 'PLUGIN_ID_INVALID' | 'PLUGIN_VERSION_INVALID' | 'NODUS_VERSION_INVALID' | 'NODUS_VERSION_INCOMPATIBLE'
  | 'MANIFEST_FORMAT_UNSUPPORTED' | 'PLUGIN_API_UNSUPPORTED'
  | 'CAPABILITY_DUPLICATE' | 'CAPABILITY_UNSUPPORTED' | 'ENTRYPOINT_PATH_INVALID'
  | 'DEPENDENCY_INVALID' | 'DEPENDENCY_DUPLICATE'
  | 'PACKAGE_ROOT_MISSING' | 'PACKAGE_ROOT_INVALID' | 'PACKAGE_ROOT_UNREADABLE'
  | 'PACKAGE_ENTRY_UNSUPPORTED' | 'PACKAGE_PATH_INVALID' | 'PACKAGE_SYMLINK'
  | 'PACKAGE_SPECIAL_FILE' | 'PACKAGE_FILE_LIMIT_EXCEEDED' | 'PACKAGE_ENTRY_LIMIT_EXCEEDED'
  | 'PACKAGE_FILE_TOO_LARGE' | 'PACKAGE_SIZE_LIMIT_EXCEEDED' | 'PACKAGE_DEPTH_LIMIT_EXCEEDED'
  | 'PACKAGE_READ_FAILED' | 'PACKAGE_CHANGED_DURING_READ' | 'ENTRYPOINT_MISSING'
  | 'PLUGIN_DIRECTORY_ID_MISMATCH' | 'PLUGIN_ID_DUPLICATE'
  | 'DEPENDENCY_MISSING' | 'DEPENDENCY_VERSION_MISMATCH' | 'DEPENDENCY_CYCLE';

export interface PluginDiagnostic {
  code: PluginDiagnosticCode;
  severity: PluginDiagnosticSeverity;
  message: string;
  pluginId?: string;
  field?: string;
  /** Package-relative path only; absolute host paths are never included. */
  path?: string;
}

export interface PluginDependency {
  id: string;
  range: string;
  optional: boolean;
}

export interface PluginManifestV1 {
  format: 'nodus-plugin';
  formatVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  minNodusVersion: string;
  pluginApiVersion: number;
  entryPoint: string;
  capabilities: PluginCapability[];
  dependencies: PluginDependency[];
}

export interface PluginManifestValidationOptions {
  currentNodusVersion: string;
  supportedPluginApiVersions?: readonly number[];
}

export interface PluginManifestValidationResult {
  manifest: PluginManifestV1 | null;
  /** Safe display/identity fields retained when other validation fails. */
  metadata: PluginManifestMetadata | null;
  diagnostics: PluginDiagnostic[];
}

export interface PluginManifestMetadata {
  pluginId: string | null;
  name: string | null;
  version: string | null;
}

export interface PluginPackageFile {
  path: string;
  size: number;
  sha256: string;
}

export interface PluginPackageInventory {
  packagePath: string;
  files: PluginPackageFile[];
  totalBytes: number;
  fingerprint: string | null;
  manifestBytes: Uint8Array | null;
  diagnostics: PluginDiagnostic[];
}

export type PluginCompatibilityStatus = 'compatible' | 'incompatible' | 'unknown';
export type PluginDependencyStatus = 'satisfied' | 'unsatisfied' | 'unknown';

/** A discovered package candidate is metadata only; it is not installed or active. */
export interface PluginPackageCandidate {
  directoryName: string;
  packagePath: string;
  manifest: PluginManifestV1 | null;
  metadata: PluginManifestMetadata | null;
  fingerprint: string | null;
  inventory: PluginPackageFile[];
  diagnostics: PluginDiagnostic[];
  compatibility: PluginCompatibilityStatus;
  dependencyStatus: PluginDependencyStatus;
}

export interface PluginRegistryEntry {
  pluginId: string | null;
  name: string;
  version: string | null;
  packagePath: string;
  fingerprint: string | null;
  manifest: PluginManifestV1 | null;
  metadata: PluginManifestMetadata | null;
  diagnostics: PluginDiagnostic[];
  compatibility: PluginCompatibilityStatus;
  dependencyStatus: PluginDependencyStatus;
  discoveryStatus: 'discovered' | 'invalid';
}

export interface PluginRegistry {
  entries: readonly PluginRegistryEntry[];
  /** Valid dependencies precede their dependents; no entry is activated. */
  dependencyOrder: readonly string[];
}

export interface PluginDependencyInput {
  id: string;
  version: string;
  dependencies: readonly PluginDependency[];
  initiallyValid?: boolean;
}

export interface PluginDependencyResolution {
  order: string[];
  invalidPluginIds: string[];
  diagnostics: PluginDiagnostic[];
}
