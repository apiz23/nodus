import { lstat, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { PLUGIN_MANIFEST_FILE, PLUGIN_PACKAGE_LIMITS } from './constants.js';
import { resolvePluginDependencies } from './dependencies.js';
import { isPluginId, validatePluginManifest } from './manifest-validator.js';
import { inventoryPluginPackage } from './package-inventory.js';
import type { PluginDiagnostic, PluginPackageCandidate } from './types.js';

export interface PluginDiscoveryOptions {
  currentNodusVersion: string;
  supportedPluginApiVersions?: readonly number[];
}

export interface PluginDiscoveryResult {
  candidates: PluginPackageCandidate[];
  diagnostics: PluginDiagnostic[];
}

/** Discover and validate local package metadata. This function never loads code. */
export async function discoverPluginPackages(pluginRoot: string, options: PluginDiscoveryOptions): Promise<PluginDiscoveryResult> {
  const rootPath = resolve(pluginRoot);
  let rootInfo;
  try { rootInfo = await lstat(rootPath, { bigint: true }); }
  catch (error) {
    if (errorCode(error) === 'ENOENT') return { candidates: [], diagnostics: [] };
    return { candidates: [], diagnostics: [diagnostic('PACKAGE_ROOT_UNREADABLE', 'Configured plugin directory could not be inspected.')] };
  }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) return { candidates: [], diagnostics: [diagnostic('PACKAGE_ROOT_INVALID', 'Configured plugin root must be a real directory.')] };

  let realRoot: string;
  let children;
  try {
    realRoot = await realpath(rootPath);
    const rootAfterResolve = await lstat(rootPath, { bigint: true });
    if (rootAfterResolve.isSymbolicLink() || !rootAfterResolve.isDirectory() || rootAfterResolve.dev !== rootInfo.dev || rootAfterResolve.ino !== rootInfo.ino) {
      return { candidates: [], diagnostics: [diagnostic('PACKAGE_ROOT_INVALID', 'Configured plugin root changed while it was being resolved.')] };
    }
    children = await readdir(realRoot, { withFileTypes: true });
  } catch {
    return { candidates: [], diagnostics: [diagnostic('PACKAGE_ROOT_UNREADABLE', 'Configured plugin directory could not be read.')] };
  }
  children.sort((left, right) => compare(left.name, right.name));
  const candidates: PluginPackageCandidate[] = [];
  const diagnostics: PluginDiagnostic[] = [];

  if (children.length > PLUGIN_PACKAGE_LIMITS.pluginDirectories) {
    return { candidates: [], diagnostics: [diagnostic('PACKAGE_ENTRY_LIMIT_EXCEEDED', `Plugin root contains more than ${PLUGIN_PACKAGE_LIMITS.pluginDirectories} entries.`)] };
  }

  for (const child of children) {
    const packagePath = resolve(realRoot, child.name);
    if (child.isSymbolicLink()) {
      diagnostics.push(diagnostic('PACKAGE_SYMLINK', 'Symbolic links are not permitted at the plugin root.', child.name));
      continue;
    }
    if (!child.isDirectory()) {
      diagnostics.push(diagnostic('PACKAGE_ENTRY_UNSUPPORTED', 'Plugin root may contain only plugin package directories.', child.name));
      continue;
    }
    if (!await isContained(realRoot, packagePath)) {
      diagnostics.push(diagnostic('PACKAGE_PATH_INVALID', 'Plugin package directory resolves outside the configured plugin root.', child.name));
      continue;
    }

    const inventory = await inventoryPluginPackage(packagePath, { expectedRoot: realRoot });
    const packageDiagnostics = [...inventory.diagnostics];
    const directoryNameLooksValid = isPluginId(child.name);
    if (!directoryNameLooksValid) packageDiagnostics.push(diagnostic('PLUGIN_ID_INVALID', 'Plugin directory name must be a lowercase reverse-DNS ID.', child.name));
    let manifest = null;
    let metadata = null;
    if (inventory.manifestBytes !== null) {
      const result = validatePluginManifest(inventory.manifestBytes, options);
      manifest = result.manifest;
      metadata = result.metadata;
      packageDiagnostics.push(...result.diagnostics.map((item) => ({ ...item, path: item.path ?? (item.field === undefined ? undefined : PLUGIN_MANIFEST_FILE) })));
    }
    if (metadata?.pluginId && child.name !== metadata.pluginId) packageDiagnostics.push(diagnostic('PLUGIN_DIRECTORY_ID_MISMATCH', `Package directory name must match manifest ID "${metadata.pluginId}".`, PLUGIN_MANIFEST_FILE, metadata.pluginId));
    if (manifest && !inventory.files.some((file) => file.path === manifest!.entryPoint)) packageDiagnostics.push(diagnostic('ENTRYPOINT_MISSING', 'Declared plugin entry point is not a regular file in the package inventory.', manifest.entryPoint, manifest.id));

    const hasErrors = packageDiagnostics.some((item) => item.severity === 'error');
    candidates.push({
      directoryName: child.name,
      packagePath,
      manifest,
      metadata,
      fingerprint: hasErrors ? null : inventory.fingerprint,
      inventory: inventory.files,
      diagnostics: packageDiagnostics,
      compatibility: manifest === null ? compatibilityFromDiagnostics(packageDiagnostics) : 'compatible',
      dependencyStatus: manifest === null ? 'unknown' : 'satisfied',
    });
  }

  // Duplicate package identities and dependency graph failures are diagnosed
  // for all candidates, never resolved by whichever directory was enumerated first.
  const inputs = candidates.filter((candidate) => candidate.metadata !== null && candidate.metadata.pluginId !== null && candidate.metadata.version !== null).map((candidate) => ({
    id: candidate.metadata!.pluginId!,
    version: candidate.metadata!.version!,
    dependencies: candidate.manifest?.dependencies ?? [],
    initiallyValid: candidate.manifest !== null && candidate.diagnostics.every((item) => item.severity !== 'error'),
  }));
  const resolved = resolvePluginDependencies(inputs);
  for (const item of resolved.diagnostics) {
    const matching = candidates.filter((candidate) => candidate.manifest?.id === item.pluginId || candidate.metadata?.pluginId === item.pluginId);
    for (const candidate of matching) {
      candidate.diagnostics.push(item);
      if (item.severity === 'error') candidate.dependencyStatus = 'unsatisfied';
    }
  }
  for (const candidate of candidates) {
    candidate.diagnostics.sort(compareDiagnostic);
    if (candidate.diagnostics.some((item) => item.severity === 'error')) candidate.fingerprint = null;
  }
  diagnostics.push(...candidates.flatMap((candidate) => candidate.diagnostics));
  diagnostics.sort(compareDiagnostic);
  return { candidates, diagnostics };
}

async function isContained(root: string, target: string): Promise<boolean> {
  try {
    const resolved = await realpath(target);
    const rel = relative(root, resolved);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  } catch { return false; }
}

function compatibilityFromDiagnostics(items: readonly PluginDiagnostic[]): PluginPackageCandidate['compatibility'] {
  return items.some((item) => item.code === 'PLUGIN_API_UNSUPPORTED' || item.code === 'MANIFEST_FORMAT_UNSUPPORTED' || item.code === 'NODUS_VERSION_INVALID' || item.code === 'NODUS_VERSION_INCOMPATIBLE') ? 'incompatible' : 'unknown';
}
function diagnostic(code: PluginDiagnostic['code'], message: string, path?: string, pluginId?: string): PluginDiagnostic { return { code, severity: 'error', message, ...(path === undefined ? {} : { path }), ...(pluginId === undefined ? {} : { pluginId }) }; }
function errorCode(error: unknown): string | undefined { return (error as NodeJS.ErrnoException | undefined)?.code; }
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function compareDiagnostic(left: PluginDiagnostic, right: PluginDiagnostic): number { return compare(left.pluginId ?? '', right.pluginId ?? '') || compare(left.path ?? '', right.path ?? '') || compare(left.code, right.code) || compare(left.message, right.message); }
