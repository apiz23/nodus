/** Operational limits for untrusted local plugin packages. */
export const PLUGIN_PACKAGE_LIMITS = Object.freeze({
  manifestBytes: 64 * 1024,
  packageFiles: 2_000,
  /** Bounds empty-directory and other inventory overhead as well as file count. */
  packageEntries: 4_000,
  totalBytes: 64 * 1024 * 1024,
  fileBytes: 16 * 1024 * 1024,
  nestingDepth: 16,
  dependencies: 64,
  capabilities: 32,
  pluginDirectories: 2_000,
} as const);

export const PLUGIN_MANIFEST_FILE = 'nodus-plugin.json' as const;
export const PLUGIN_MANIFEST_FORMAT = 'nodus-plugin' as const;
export const PLUGIN_MANIFEST_FORMAT_VERSION = 1 as const;
export const SUPPORTED_PLUGIN_API_VERSIONS = Object.freeze([1] as const);

/** API v1 recognizes only contribution declarations. It grants no data access. */
export const SUPPORTED_PLUGIN_CAPABILITIES = Object.freeze([
  'commands.register',
  'sidebar.register',
] as const);
