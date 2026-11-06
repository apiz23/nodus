import { Buffer } from 'node:buffer';
import { validatePortablePath } from '../storage/portable/manifest.js';
import {
  PLUGIN_MANIFEST_FORMAT,
  PLUGIN_MANIFEST_FORMAT_VERSION,
  PLUGIN_PACKAGE_LIMITS,
  SUPPORTED_PLUGIN_API_VERSIONS,
  SUPPORTED_PLUGIN_CAPABILITIES,
} from './constants.js';
import { validatePluginCompatibility } from './compatibility.js';
import type { PluginCapability, PluginDiagnostic, PluginManifestV1, PluginManifestValidationOptions, PluginManifestValidationResult } from './types.js';
import { isSupportedVersionRange, parseSemanticVersion } from './versions.js';

const FIELDS = new Set([
  'format', 'formatVersion', 'id', 'name', 'version', 'description', 'author',
  'minNodusVersion', 'pluginApiVersion', 'entryPoint', 'capabilities', 'dependencies',
]);
const REQUIRED_FIELDS = [...FIELDS].filter((field) => field !== 'dependencies');
const PLUGIN_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/;
const SAFE_ENTRY_EXTENSION = /\.mjs$/;

export function isPluginId(value: string): boolean {
  return value.length <= 180 && PLUGIN_ID.test(value);
}

export function validatePluginManifest(
  source: string | Uint8Array,
  options: PluginManifestValidationOptions,
): PluginManifestValidationResult {
  const diagnostics: PluginDiagnostic[] = [];
  const bytes = typeof source === 'string' ? Buffer.byteLength(source, 'utf8') : source.byteLength;
  if (bytes > PLUGIN_PACKAGE_LIMITS.manifestBytes) {
    return { manifest: null, metadata: null, diagnostics: [diagnostic('MANIFEST_TOO_LARGE', 'error', `Manifest exceeds the ${PLUGIN_PACKAGE_LIMITS.manifestBytes}-byte limit.`, { path: 'nodus-plugin.json' })] };
  }
  let value: unknown;
  try {
    const text = typeof source === 'string' ? source : new TextDecoder('utf-8', { fatal: true }).decode(source);
    value = JSON.parse(text) as unknown;
  } catch {
    return { manifest: null, metadata: null, diagnostics: [diagnostic('MANIFEST_JSON_INVALID', 'error', 'Manifest is not valid JSON.', { path: 'nodus-plugin.json' })] };
  }
  if (!isRecord(value)) return { manifest: null, metadata: null, diagnostics: [diagnostic('MANIFEST_ROOT_INVALID', 'error', 'Manifest root must be a JSON object.', { path: 'nodus-plugin.json' })] };

  for (const field of Object.keys(value)) {
    if (!FIELDS.has(field)) diagnostics.push(diagnostic('MANIFEST_UNKNOWN_FIELD', 'error', `Unknown manifest field "${field}" is not supported by format v1.`, { field }));
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in value)) diagnostics.push(diagnostic('MANIFEST_FIELD_REQUIRED', 'error', `Required manifest field "${field}" is missing.`, { field }));
  }

  if (value.format !== PLUGIN_MANIFEST_FORMAT) diagnostics.push(diagnostic('MANIFEST_FIELD_INVALID', 'error', `Manifest format must be "${PLUGIN_MANIFEST_FORMAT}".`, { field: 'format' }));
  if (value.formatVersion !== PLUGIN_MANIFEST_FORMAT_VERSION) diagnostics.push(diagnostic('MANIFEST_FORMAT_UNSUPPORTED', 'error', `Manifest format version must be ${PLUGIN_MANIFEST_FORMAT_VERSION}.`, { field: 'formatVersion' }));

  const id = stringField(value, 'id', 180, diagnostics);
  if (id !== null && !isPluginId(id)) diagnostics.push(diagnostic('PLUGIN_ID_INVALID', 'error', 'Plugin ID must be a lowercase ASCII reverse-DNS identifier with at least two labels.', { pluginId: id, field: 'id' }));
  const name = stringField(value, 'name', 80, diagnostics);
  const version = stringField(value, 'version', 64, diagnostics);
  const description = stringField(value, 'description', 500, diagnostics);
  const author = stringField(value, 'author', 120, diagnostics);
  const minNodusVersion = stringField(value, 'minNodusVersion', 64, diagnostics);
  if (version !== null && !parseSemanticVersion(version)) diagnostics.push(diagnostic('PLUGIN_VERSION_INVALID', 'error', 'Plugin version must be a stable major.minor.patch version without prerelease or build metadata.', { pluginId: id ?? undefined, field: 'version' }));
  if (minNodusVersion !== null && !parseSemanticVersion(minNodusVersion)) diagnostics.push(diagnostic('MANIFEST_FIELD_INVALID', 'error', 'Minimum Nodus version must be a stable major.minor.patch version.', { pluginId: id ?? undefined, field: 'minNodusVersion' }));
  const pluginApiVersion = value.pluginApiVersion;
  if (!Number.isSafeInteger(pluginApiVersion) || (pluginApiVersion as number) < 1) diagnostics.push(diagnostic('MANIFEST_FIELD_INVALID', 'error', 'Plugin API version must be a positive integer.', { pluginId: id ?? undefined, field: 'pluginApiVersion' }));

  const entryPoint = stringField(value, 'entryPoint', 240, diagnostics);
  if (entryPoint !== null) {
    let validPath = true;
    try { validatePortablePath(entryPoint); } catch { validPath = false; }
    if (!validPath || !SAFE_ENTRY_EXTENSION.test(entryPoint) || entryPoint.normalize('NFC') !== entryPoint) diagnostics.push(diagnostic('ENTRYPOINT_PATH_INVALID', 'error', 'Entry point must be an NFC-normalized, safe relative POSIX path ending in .mjs.', { pluginId: id ?? undefined, field: 'entryPoint', path: entryPoint }));
  }

  const capabilities: PluginCapability[] = [];
  if (!Array.isArray(value.capabilities) || value.capabilities.length > PLUGIN_PACKAGE_LIMITS.capabilities) {
    diagnostics.push(diagnostic('MANIFEST_FIELD_INVALID', 'error', `Capabilities must be an array of at most ${PLUGIN_PACKAGE_LIMITS.capabilities} values.`, { pluginId: id ?? undefined, field: 'capabilities' }));
  } else {
    const seen = new Set<string>();
    for (const [index, raw] of value.capabilities.entries()) {
      if (typeof raw !== 'string') { diagnostics.push(diagnostic('MANIFEST_FIELD_INVALID', 'error', 'Capability entries must be strings.', { pluginId: id ?? undefined, field: `capabilities[${index}]` })); continue; }
      if (seen.has(raw)) diagnostics.push(diagnostic('CAPABILITY_DUPLICATE', 'error', `Capability "${raw}" is declared more than once.`, { pluginId: id ?? undefined, field: `capabilities[${index}]` }));
      seen.add(raw);
      if (!(SUPPORTED_PLUGIN_CAPABILITIES as readonly string[]).includes(raw)) diagnostics.push(diagnostic('CAPABILITY_UNSUPPORTED', 'error', `Capability "${raw}" is not supported in Phase 30B.`, { pluginId: id ?? undefined, field: `capabilities[${index}]` }));
      else capabilities.push(raw as PluginCapability);
    }
  }

  const dependencies: PluginManifestV1['dependencies'] = [];
  if (value.dependencies === undefined) {
    // Dependencies are optional in the package format; omission means none.
  } else if (!Array.isArray(value.dependencies) || value.dependencies.length > PLUGIN_PACKAGE_LIMITS.dependencies) {
    diagnostics.push(diagnostic('MANIFEST_FIELD_INVALID', 'error', `Dependencies must be an array of at most ${PLUGIN_PACKAGE_LIMITS.dependencies} entries.`, { pluginId: id ?? undefined, field: 'dependencies' }));
  } else {
    const seen = new Set<string>();
    for (const [index, raw] of value.dependencies.entries()) {
      const field = `dependencies[${index}]`;
      if (!isRecord(raw) || typeof raw.id !== 'string' || typeof raw.range !== 'string' || (raw.optional !== undefined && typeof raw.optional !== 'boolean') || Object.keys(raw).some((key) => !['id', 'range', 'optional'].includes(key))) {
        diagnostics.push(diagnostic('DEPENDENCY_INVALID', 'error', 'Dependency must contain an ID, supported version range, and optional boolean.', { pluginId: id ?? undefined, field }));
        continue;
      }
      if (!isPluginId(raw.id)) {
        diagnostics.push(diagnostic('DEPENDENCY_INVALID', 'error', 'Dependency ID is invalid.', { pluginId: id ?? undefined, field }));
        continue;
      }
      if (seen.has(raw.id)) diagnostics.push(diagnostic('DEPENDENCY_DUPLICATE', 'error', `Dependency "${raw.id}" is declared more than once.`, { pluginId: id ?? undefined, field }));
      seen.add(raw.id);
      if (!isSupportedVersionRange(raw.range)) {
        diagnostics.push(diagnostic('DEPENDENCY_INVALID', 'error', 'Dependency version range is invalid or unsupported.', { pluginId: id ?? undefined, field }));
        continue;
      }
      dependencies.push({ id: raw.id, range: raw.range, optional: raw.optional === true });
    }
  }

  if (id !== null && dependencies.some((dependency) => dependency.id === id)) diagnostics.push(diagnostic('DEPENDENCY_INVALID', 'error', 'A plugin cannot depend on itself.', { pluginId: id, field: 'dependencies' }));
  if (id !== null && minNodusVersion !== null && parseSemanticVersion(minNodusVersion) && Number.isSafeInteger(pluginApiVersion) && (pluginApiVersion as number) > 0) {
    diagnostics.push(...validatePluginCompatibility(
      { id, minNodusVersion, pluginApiVersion: pluginApiVersion as number },
      { currentNodusVersion: options.currentNodusVersion, supportedPluginApiVersions: options.supportedPluginApiVersions ?? SUPPORTED_PLUGIN_API_VERSIONS },
    ));
  }
  const hasErrors = diagnostics.some((item) => item.severity === 'error');
  const metadata = {
    pluginId: id !== null && isPluginId(id) ? id : null,
    name,
    version: version !== null && parseSemanticVersion(version) ? version : null,
  };
  if (hasErrors || id === null || name === null || version === null || description === null || author === null || minNodusVersion === null || entryPoint === null || !Number.isSafeInteger(pluginApiVersion)) return { manifest: null, metadata, diagnostics };
  return {
    manifest: {
      format: PLUGIN_MANIFEST_FORMAT,
      formatVersion: PLUGIN_MANIFEST_FORMAT_VERSION,
      id,
      name,
      version,
      description,
      author,
      minNodusVersion,
      pluginApiVersion: pluginApiVersion as number,
      entryPoint,
      capabilities,
      dependencies,
    },
    metadata,
    diagnostics,
  };
}

function stringField(value: Record<string, unknown>, field: string, max: number, diagnostics: PluginDiagnostic[]): string | null {
  const entry = value[field];
  if (typeof entry !== 'string' || entry.trim() === '' || entry !== entry.trim() || Buffer.byteLength(entry, 'utf8') > max) {
    diagnostics.push(diagnostic('MANIFEST_FIELD_INVALID', 'error', `Field "${field}" must be a non-empty trimmed string no longer than ${max} UTF-8 bytes.`, { field }));
    return null;
  }
  if (/[\u0000-\u001f\u007f]/.test(entry)) {
    diagnostics.push(diagnostic('MANIFEST_FIELD_INVALID', 'error', `Field "${field}" contains a control character.`, { field }));
    return null;
  }
  return entry;
}

function diagnostic(code: PluginDiagnostic['code'], severity: PluginDiagnostic['severity'], message: string, extra: Partial<PluginDiagnostic> = {}): PluginDiagnostic {
  return { code, severity, message, ...extra };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
