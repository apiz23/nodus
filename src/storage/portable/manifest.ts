import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { StorageError } from '../errors.js';

export const PORTABLE_EXPORT_FORMAT = 'nodus-portable-export' as const;
export const PORTABLE_EXPORT_VERSION = 1 as const;
export const PORTABLE_EXPORT_MANIFEST = 'nodus-export.json';
export const PORTABLE_RESOURCE_KINDS = ['note', 'database', 'database-view', 'attachment', 'database-view-order', 'property-catalog', 'automation-definitions', 'automation-history', 'template-catalog'] as const;
export type PortableResourceKind = typeof PORTABLE_RESOURCE_KINDS[number];

export interface PortableExportResource {
  kind: PortableResourceKind;
  id: string;
  path: string;
  bytes: number;
  sha256: string;
  ownerId?: string;
}

export interface PortableExportManifest {
  format: typeof PORTABLE_EXPORT_FORMAT;
  version: typeof PORTABLE_EXPORT_VERSION;
  createdAt: string;
  snapshotConsistency: 'cooperating-nodus-writers';
  formats: { note: number; database: number; databaseView: number; databaseViewOrder: number; propertyCatalog: number; automation: number; automationHistory: number; templates: number };
  resources: PortableExportResource[];
  folders: string[];
  excluded: Array<{ path: string; reason: string }>;
  digest: string;
  app?: { name: string; version: string };
  requiredFeatures?: string[];
}

const SUPPORTED_FEATURES = new Set<string>();
const HASH = /^[0-9a-f]{64}$/;
const SUPPORTED_FORMATS: Record<string, number> = { note: 1, database: 3, databaseView: 3, databaseViewOrder: 1, propertyCatalog: 1, automation: 1, automationHistory: 1, templates: 1 };

export function sha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }

export function validatePortablePath(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024 || value.startsWith('/') || value.includes('\\') || value.includes(':') || /[\u0000-\u001f\u007f]/.test(value)) throw invalid('Portable path must be a safe relative POSIX path.');
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..' || part.endsWith('.') || part.endsWith(' ') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part))) throw invalid(`Unsafe portable path "${value}".`);
}

export function createPortableManifest(input: Omit<PortableExportManifest, 'format' | 'version' | 'digest'>): PortableExportManifest {
  const value: PortableExportManifest = { format: PORTABLE_EXPORT_FORMAT, version: PORTABLE_EXPORT_VERSION, ...input, digest: '' };
  value.digest = portableManifestDigest(value);
  validatePortableManifest(value);
  return value;
}

export function portableManifestDigest(manifest: PortableExportManifest): string {
  const canonical = {
    format: manifest.format, version: manifest.version, createdAt: manifest.createdAt,
    snapshotConsistency: manifest.snapshotConsistency, formats: manifest.formats,
    resources: [...manifest.resources].sort(compareResource).map((r) => ({ kind: r.kind, id: r.id, path: r.path, bytes: r.bytes, sha256: r.sha256, ...(r.ownerId === undefined ? {} : { ownerId: r.ownerId }) })),
    folders: [...manifest.folders].sort(), excluded: [...manifest.excluded].sort((a, b) => compareText(a.path, b.path)),
    ...(manifest.app === undefined ? {} : { app: manifest.app }),
    ...(manifest.requiredFeatures === undefined ? {} : { requiredFeatures: [...manifest.requiredFeatures].sort() }),
  };
  return sha256(Buffer.from(JSON.stringify(canonical), 'utf8'));
}

export function validatePortableManifest(value: unknown): asserts value is PortableExportManifest {
  if (!isRecord(value)) throw invalid('Portable export manifest must be a JSON object.');
  if (value.format !== PORTABLE_EXPORT_FORMAT) throw invalid('Unsupported portable export format identifier.');
  if (value.version !== PORTABLE_EXPORT_VERSION) throw new StorageError('UNSUPPORTED_VERSION', `Portable export format version ${String(value.version)} is not supported.`);
  if (typeof value.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) throw invalid('Manifest creation timestamp must be an ISO-8601 UTC timestamp.');
  if (value.snapshotConsistency !== 'cooperating-nodus-writers') throw invalid('Manifest snapshot consistency declaration is invalid.');
  if (!isRecord(value.formats) || Object.keys(SUPPORTED_FORMATS).some((key) => !Number.isSafeInteger(value.formats[key]) || (value.formats[key] as number) < 1)) throw invalid('Manifest format metadata is missing or invalid.');
  for (const [key, supported] of Object.entries(SUPPORTED_FORMATS)) if ((value.formats[key] as number) > supported) throw new StorageError('UNSUPPORTED_VERSION', `Portable export contains unsupported ${key} format version ${String(value.formats[key])}.`);
  if (!Array.isArray(value.resources) || !Array.isArray(value.folders) || !Array.isArray(value.excluded)) throw invalid('Manifest resources, folders, and exclusions are required arrays.');
  if (value.requiredFeatures !== undefined && (!Array.isArray(value.requiredFeatures) || value.requiredFeatures.some((feature) => typeof feature !== 'string' || !SUPPORTED_FEATURES.has(feature)))) throw new StorageError('UNSUPPORTED_VERSION', 'Portable export requires an unsupported feature.');
  if (value.app !== undefined && (!isRecord(value.app) || typeof value.app.name !== 'string' || typeof value.app.version !== 'string')) throw invalid('Optional app metadata is invalid.');
  const ids = new Set<string>(); const paths = new Set<string>();
  for (const raw of value.resources) {
    if (!isRecord(raw) || !PORTABLE_RESOURCE_KINDS.includes(raw.kind as PortableResourceKind) || typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 256 || !Number.isSafeInteger(raw.bytes) || (raw.bytes as number) < 0 || typeof raw.sha256 !== 'string' || !HASH.test(raw.sha256)) throw invalid('A portable resource has invalid required fields or resource type.');
    validatePortablePath(raw.path);
    if (raw.path === PORTABLE_EXPORT_MANIFEST) throw invalid('Portable manifest path cannot also be a resource path.');
    if (raw.ownerId !== undefined && (typeof raw.ownerId !== 'string' || raw.ownerId.length === 0)) throw invalid('Resource ownerId must be a non-empty string.');
    const scopedId = `${raw.kind}:${raw.id}`;
    if (ids.has(scopedId)) throw invalid(`Duplicate portable resource identity "${scopedId}".`);
    if (paths.has((raw.path as string).normalize('NFC').toLocaleLowerCase('en-US'))) throw invalid(`Duplicate portable resource path "${raw.path as string}".`);
    ids.add(scopedId); paths.add((raw.path as string).normalize('NFC').toLocaleLowerCase('en-US'));
  }
  for (const folder of value.folders) validatePortablePath(folder);
  for (const item of value.excluded) if (!isRecord(item) || typeof item.path !== 'string' || typeof item.reason !== 'string') throw invalid('Manifest exclusion diagnostic is invalid.');
  if (typeof value.digest !== 'string' || !HASH.test(value.digest) || value.digest !== portableManifestDigest(value as unknown as PortableExportManifest)) throw invalid('Portable export manifest digest does not match.');
}

export async function validatePortableExport(directory: string): Promise<PortableExportManifest> {
  const root = resolve(directory); const manifestPath = join(root, PORTABLE_EXPORT_MANIFEST);
  let manifest: PortableExportManifest;
  try {
    const info = await lstat(manifestPath);
    if (!info.isFile() || info.isSymbolicLink()) throw invalid('Portable export manifest must be a regular file.');
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PortableExportManifest;
  }
  catch (error) { throw new StorageError('INVALID_CONTENT', `Portable export manifest is missing or malformed: ${error instanceof Error ? error.message : String(error)}`, { path: PORTABLE_EXPORT_MANIFEST, cause: error }); }
  validatePortableManifest(manifest);
  await validatePortableExportContents(directory, manifest);
  return manifest;
}

/** Validates payload files before the completion manifest is published. */
export async function validatePortableExportContents(directory: string, manifest: PortableExportManifest, options: { manifestPresent?: boolean } = {}): Promise<void> {
  const root = resolve(directory);
  validatePortableManifest(manifest);
  const files = new Set<string>(); const dirs = new Set<string>();
  await inventory(root, '', files, dirs);
  const hasManifest = files.has(PORTABLE_EXPORT_MANIFEST);
  if (options.manifestPresent === false && hasManifest) throw invalid('Completion manifest was present before the final publication step.');
  if (options.manifestPresent !== false && !hasManifest) throw invalid('Portable completion manifest is missing.');
  const expected = new Set([...manifest.resources.map((resource) => resource.path), ...(hasManifest ? [PORTABLE_EXPORT_MANIFEST] : [])]);
  for (const resource of manifest.resources) {
    if (!files.has(resource.path)) throw invalid(`Portable resource is missing: ${resource.path}`);
    const path = join(root, ...resource.path.split('/')); const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw invalid(`Portable resource is not a regular file: ${resource.path}`);
    const bytes = await readFile(path);
    if (bytes.byteLength !== resource.bytes) throw invalid(`Portable resource size is incorrect: ${resource.path}`);
    if (sha256(bytes) !== resource.sha256) throw invalid(`Portable resource checksum is incorrect: ${resource.path}`);
  }
  for (const file of files) if (!expected.has(file)) throw invalid(`Unmanifested file in portable export: ${file}`);
  const expectedFolders = new Set(manifest.folders);
  for (const dir of dirs) if (!expectedFolders.has(dir)) throw invalid(`Unmanifested directory in portable export: ${dir}`);
  for (const dir of expectedFolders) if (!dirs.has(dir)) throw invalid(`Portable export folder is missing: ${dir}`);
}

export function serializePortableManifest(manifest: PortableExportManifest): Buffer {
  validatePortableManifest(manifest);
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function compareResource(a: PortableExportResource, b: PortableExportResource): number { return compareText(a.path, b.path) || compareText(a.kind, b.kind) || compareText(a.id, b.id); }
function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function invalid(message: string): StorageError { return new StorageError('INVALID_CONTENT', message); }
async function inventory(root: string, relative: string, files: Set<string>, dirs: Set<string>): Promise<void> {
  const names = await readdir(relative === '' ? root : join(root, ...relative.split('/')), { withFileTypes: true });
  for (const item of names) {
    const path = relative === '' ? item.name : `${relative}/${item.name}`;
    const info = await lstat(join(root, ...path.split('/')));
    if (info.isSymbolicLink()) throw invalid(`Symbolic links are not permitted in portable exports: ${path}`);
    if (item.isDirectory()) { dirs.add(path); await inventory(root, path, files, dirs); }
    else if (item.isFile()) files.add(path);
    else throw invalid(`Unsupported filesystem entry in portable export: ${path}`);
  }
}
