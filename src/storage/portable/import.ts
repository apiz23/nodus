import { createHash } from 'node:crypto';
import { lstat, stat } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { DatabaseDefinition } from '../../database/schema.js';
import { parseDatabase } from '../../database/schema.js';
import { parseDatabaseView, type DatabaseView } from '../../database/database-view.js';
import { parseDatabaseViewOrder } from '../../database/database-view-order.js';
import type { Note } from '../../domain/note.js';
import { isUuidV4 } from '../../domain/ids.js';
import { parseNote } from '../../format/note-format.js';
import type { DatabaseViewOrderFileSnapshot, ImportOptions, ImportPlan, ImportReport, PropertyCatalogFile, VaultEntry, VaultStorage } from '../contracts.js';
import { StorageError, storageFailure, wrapContentError } from '../errors.js';
import { DATABASE_VIEW_ORDER_DIR, databasePath, databaseViewOrderPath, databaseViewPath } from '../fs/layout.js';
import { PROPERTY_CATALOG_PATH, parsePropertyCatalog } from '../../properties/catalog.js';
import { walkVault } from '../fs/scan.js';
import { attachmentPathId, validateAttachmentBytes, ATTACHMENT_MAX_BYTES } from '../fs/attachments.js';
import { DATABASE_AUTOMATIONS_PATH, DATABASE_AUTOMATION_HISTORY_PATH } from '../fs/layout.js';
import { parseAutomationHistory, parseAutomations } from '../../database/automations.js';
import { parseTemplates } from '../../database/templates.js';
import { TEMPLATE_CATALOG_PATH } from '../fs/layout.js';
import { PORTABLE_EXPORT_MANIFEST, readPortableExportManifest, validatePortableExportInventory, sha256, type PortableExportManifest } from './manifest.js';
import { projectRelations } from '../../database/relations.js';
import { diagnoseDatabaseView } from '../../database/database-view.js';
import type { ImportPreview, ImportPreviewResource, PortableExportSnapshot } from '../contracts.js';
import type { ImportPreviewBinding } from './preview-session.js';
import { byteLength, fingerprintPlan, fingerprintSnapshot } from './fingerprints.js';
import { IMPORT_MAX_FILESYSTEM_ENTRIES, IMPORT_MAX_PATH_DEPTH, IMPORT_MAX_RESOURCE_BYTES, readBoundedImportFile, validateImportResourceLimits } from './limits.js';

/**
 * Reads and fully validates a portable import directory.
 *
 * Nothing is written. Every note and database is parsed with the Phase 1
 * validators, so duplicate IDs, path collisions, malformed files, and
 * unsupported versions are rejected before any target data can change.
 */
export async function planImport(sourceDir: string): Promise<ImportPlan> {
  const source = resolve(sourceDir);

  let info;
  try {
    info = await stat(source);
  } catch (error) {
    if (isMissing(error)) {
      throw new StorageError('NOT_FOUND', `Import source "${sourceDir}" was not found`, {
        path: sourceDir,
      });
    }
    throw storageFailure(error, 'Read import source', sourceDir);
  }
  if (!info.isDirectory()) {
    throw new StorageError('INVALID_INPUT', `Import source "${sourceDir}" is not a directory`, {
      path: sourceDir,
    });
  }

  let portableManifest: PortableExportManifest | undefined;
  let sourceManifestSha256: string | undefined;
  const manifestPath = join(source, PORTABLE_EXPORT_MANIFEST);
  try {
    await lstat(manifestPath);
    const loaded = await readPortableExportManifest(source);
    portableManifest = loaded.manifest;
    sourceManifestSha256 = sha256(loaded.rawBytes);
  }
  catch (error) { if (!isMissing(error)) throw error; }

  const walk = await walkVault(source, { maxDepth: IMPORT_MAX_PATH_DEPTH, maxEntries: IMPORT_MAX_FILESYSTEM_ENTRIES });
  if (walk.issues.length > 0) {
    throw new StorageError('INVALID_CONTENT', 'Import source contains unsupported entries', {
      details: { issues: walk.issues.map((issue) => `${issue.path}: ${issue.message}`) },
    });
  }
  if (walk.entries.some((entry) => entry.kind === 'temp')) {
    throw new StorageError(
      'INVALID_CONTENT',
      'Import source contains leftover temporary files; remove them before importing',
    );
  }

  const visibleSizes: Array<{ path: string; bytes: number }> = [];
  for (const entry of walk.entries.filter((candidate) => candidate.kind !== 'temp')) {
    const entryInfo = await lstat(entry.absolute);
    if (!entryInfo.isFile() || entryInfo.isSymbolicLink()) throw new StorageError('UNSAFE_PATH', `Import resource is not a regular file: ${entry.path}.`, { path: entry.path });
    visibleSizes.push({ path: entry.path, bytes: entryInfo.size });
  }
  validateImportResourceLimits(visibleSizes, walk.folders);

  const propertyCatalog = await readImportPropertyCatalog(source);
  const notes: Note[] = [];
  const databases: DatabaseDefinition[] = [];
  const databaseViews: DatabaseView[] = [];
  const entries: VaultEntry[] = [];
  const noteIds = new Map<string, string>();
  const databaseIds = new Map<string, string>();
  const viewIds = new Map<string, string>();
  const attachmentIds = new Map<string, string>();
  const foldedPaths = new Map<string, string>();

  for (const entry of walk.entries) {
    if (entry.kind !== 'note') continue;

    const text = await readText(entry.absolute, entry.path);
    let note: Note;
    try {
      note = parseNote(text, entry.path);
    } catch (error) {
      throw wrapContentError(error, entry.path);
    }

    const previous = noteIds.get(note.id);
    if (previous !== undefined) {
      throw new StorageError(
        'DUPLICATE_ID',
        `Import contains note ID "${note.id}" at both "${previous}" and "${entry.path}"`,
        { details: { ids: [note.id], paths: [previous, entry.path] } },
      );
    }
    noteIds.set(note.id, entry.path);
    assertNoPathCollision(entry.path, foldedPaths);

    notes.push(note);
    entries.push({ kind: 'note', id: note.id, path: entry.path, text });
  }

  for (const entry of walk.entries) {
    if (entry.kind !== 'database') continue;

    const text = await readText(entry.absolute, entry.path);
    let database: DatabaseDefinition;
    try {
      database = parseDatabase(text);
    } catch (error) {
      throw wrapContentError(error, entry.path);
    }

    const expected = databasePath(database.id);
    if (entry.path !== expected) {
      throw new StorageError(
        'INVALID_CONTENT',
        `Import file "${entry.path}" contains database ID "${database.id}"; expected path "${expected}"`,
        { path: entry.path, details: { ids: [database.id], paths: [entry.path, expected] } },
      );
    }

    const previous = databaseIds.get(database.id);
    if (previous !== undefined) {
      throw new StorageError(
        'DUPLICATE_ID',
        `Import contains database ID "${database.id}" more than once`,
        { details: { ids: [database.id], paths: [previous, entry.path] } },
      );
    }
    databaseIds.set(database.id, entry.path);
    assertNoPathCollision(entry.path, foldedPaths);

    databases.push(database);
    entries.push({ kind: 'database', id: database.id, path: entry.path, text });
  }

  for (const entry of walk.entries) {
    if (entry.kind !== 'database-view') continue;
    const text = await readText(entry.absolute, entry.path);
    let view: DatabaseView;
    try { view = parseDatabaseView(text); } catch (error) { throw wrapContentError(error, entry.path); }
    const expected = databaseViewPath(view.databaseId, view.id);
    if (entry.path !== expected) throw new StorageError('INVALID_CONTENT', `Import file "${entry.path}" does not match saved view ID and database ID; expected "${expected}"`, { path: entry.path, details: { ids: [view.databaseId, view.id], paths: [entry.path, expected] } });
    const previous = viewIds.get(view.id);
    if (previous !== undefined) throw new StorageError('DUPLICATE_ID', `Import contains saved view ID "${view.id}" more than once`, { details: { ids: [view.id], paths: [previous, entry.path] } });
    viewIds.set(view.id, entry.path);
    assertNoPathCollision(entry.path, foldedPaths);
    databaseViews.push(view);
    entries.push({ kind: 'database-view', id: view.id, path: entry.path, text });
  }

  for (const entry of walk.entries) {
    if (entry.kind !== 'attachment') continue;
    let bytes: Buffer;
    try { bytes = await readBoundedImportFile(entry.absolute, entry.path, IMPORT_MAX_RESOURCE_BYTES); }
    catch (error) { throw storageFailure(error, 'Read import attachment', entry.path); }
    if (bytes.byteLength > ATTACHMENT_MAX_BYTES) throw new StorageError('INVALID_CONTENT', `Attachment "${entry.path}" exceeds the 10 MiB limit`, { path: entry.path });
    const valid = validateAttachmentBytes(entry.path, bytes);
    if (valid.id !== attachmentPathId(entry.path)) throw new StorageError('INVALID_CONTENT', `Attachment "${entry.path}" does not match its ID`, { path: entry.path });
    const previous = attachmentIds.get(valid.id);
    if (previous !== undefined) throw new StorageError('DUPLICATE_ID', `Import contains attachment ID "${valid.id}" more than once`, { details: { ids: [valid.id], paths: [previous, entry.path] } });
    attachmentIds.set(valid.id, entry.path);
    assertNoPathCollision(entry.path, foldedPaths);
    entries.push({ kind: 'attachment', id: valid.id, path: entry.path, text: '', rawBytes: Buffer.from(bytes) });
  }

  entries.push(...await readImportDatabaseAutomationFiles(source));
  entries.push(...await readImportTemplateFiles(source));
  const databaseViewOrders = await readImportDatabaseViewOrders(source);
  const actualSizes = entries.map((entry) => ({ path: entry.path, bytes: byteLength(entry.rawBytes ?? entry.text) }));
  if (propertyCatalog) actualSizes.push({ path: propertyCatalog.path, bytes: propertyCatalog.rawBytes.byteLength });
  for (const order of databaseViewOrders) actualSizes.push({ path: order.path, bytes: order.rawBytes.byteLength });
  validateImportResourceLimits(actualSizes, walk.folders);
  if (portableManifest) {
    validateManifestResources(portableManifest, entries, propertyCatalog, databaseViewOrders);
    await validatePortableExportInventory(source, portableManifest);
    let finalManifestBytes: Buffer;
    try { finalManifestBytes = await readBoundedImportFile(manifestPath, PORTABLE_EXPORT_MANIFEST); }
    catch (error) { throw new StorageError('INVALID_CONTENT', 'Portable manifest changed or disappeared while the import plan was being read.', { path: PORTABLE_EXPORT_MANIFEST, cause: error }); }
    if (!sourceManifestSha256 || sha256(finalManifestBytes) !== sourceManifestSha256) throw new StorageError('INVALID_CONTENT', 'Portable manifest changed while the import plan was being read.', { path: PORTABLE_EXPORT_MANIFEST });
  }
  return { entries, notes, databases, databaseViews, databaseViewOrders, sourceFolders: walk.folders, ...(propertyCatalog === undefined ? {} : { propertyCatalog }), ...(portableManifest === undefined ? {} : { portableManifest, sourceManifestSha256, excluded: portableManifest.excluded }) };
}

/** Read-only comparison of a validated directory against the active vault. */
export async function previewImport(sourceDir: string, vault: VaultStorage): Promise<ImportPreview> {
  return (await createImportPreviewSnapshot(sourceDir, vault)).preview;
}

export interface ImportPreviewSnapshot {
  preview: ImportPreview;
  binding: ImportPreviewBinding;
}

/** Creates the read-only preview plus deterministic source and destination fingerprints. */
export async function createImportPreviewSnapshot(sourceDir: string, vault: VaultStorage): Promise<ImportPreviewSnapshot> {
  const source = resolve(sourceDir);
  const plan = await planImport(source);
  const target = await vault.snapshotForPortableExport?.();
  if (!target) throw new StorageError('INVALID_INPUT', 'The active storage adapter cannot provide a consistent import preview.');
  const incoming: PreviewSourceResource[] = plan.entries.map(previewResource);
  if (plan.propertyCatalog) incoming.push({ kind: 'property-catalog', id: 'property-catalog', path: plan.propertyCatalog.path, bytes: plan.propertyCatalog.rawBytes });
  for (const order of plan.databaseViewOrders ?? []) incoming.push({ kind: 'database-view-order', id: order.databaseId, path: order.path, bytes: order.rawBytes });
  const existing: PreviewSourceResource[] = [...target.entries, ...target.automationFiles, ...target.templateFiles].map(previewResource);
  if (target.propertyCatalog) existing.push({ kind: 'property-catalog', id: 'property-catalog', path: target.propertyCatalog.path, bytes: target.propertyCatalog.rawBytes });
  for (const order of target.databaseViewOrders) existing.push({ kind: 'database-view-order', id: order.databaseId, path: order.path, bytes: order.rawBytes });
  const resources = incoming.map((entry) => classifyResource(entry, existing));
  const warnings = [
    ...(plan.portableManifest ? [] : ['No portable manifest is present. Recognized resources were validated, but directory completeness cannot be established; this may be an interrupted export.']),
    ...(plan.excluded ?? []).map((item) => `${item.path}: excluded from source export (${item.reason})`),
    ...databaseWarnings(plan),
  ];
  const counts = {
    notes: resources.filter((item) => item.kind === 'note').length,
    databases: resources.filter((item) => item.kind === 'database').length,
    databaseViews: resources.filter((item) => item.kind === 'database-view').length,
    attachments: resources.filter((item) => item.kind === 'attachment').length,
    otherResources: resources.filter((item) => !['note','database','database-view','attachment'].includes(item.kind)).length,
  };
  const preview = { source, format: plan.portableManifest ? 'nodus-portable-export' as const : 'legacy-directory' as const, completeness: plan.portableManifest ? 'manifest-validated' as const : 'unverified-legacy' as const, ...(plan.portableManifest ? { manifestVersion: plan.portableManifest.version } : {}), counts, resources, warnings, errors: [], conflicts: resources.filter((item) => item.status === 'conflict') };
  const binding: ImportPreviewBinding = {
    sourcePath: source,
    destinationPath: resolve(vault.root),
    sourceFingerprint: fingerprintPlan(plan),
    destinationFingerprint: fingerprintSnapshot(target),
    resourceBindings: resources.map((item) => {
      const incomingItem = incoming.find((candidate) => candidate.kind === item.kind && candidate.id === item.id && candidate.path === item.path)!;
      const existingItem = existing.find((candidate) => candidate.kind === item.kind && candidate.id === item.id)
        ?? existing.find((candidate) => candidate.path.normalize('NFC').toLowerCase() === item.path.normalize('NFC').toLowerCase());
      return { kind: item.kind, id: item.id, path: item.path, status: item.status, sourceSha256: sha256Entry(incomingItem), ...(existingItem === undefined ? {} : { destinationSha256: sha256Entry(existingItem) }), safeChoices: item.safeChoices };
    }),
    conflicts: resources.filter((item) => item.status === 'conflict').map((item) => {
      const incomingItem = incoming.find((candidate) => candidate.kind === item.kind && candidate.id === item.id && candidate.path === item.path)!;
      const existingItem = existing.find((candidate) => candidate.kind === item.kind && candidate.id === item.id);
      return { kind: item.kind, id: item.id, path: item.path, sourceSha256: sha256Entry(incomingItem), ...(existingItem === undefined ? {} : { destinationSha256: sha256Entry(existingItem) }), safeChoices: item.safeChoices };
    }),
  };
  return { preview, binding };
}

/** Rebuilds both fingerprints; callers must perform this while holding the publication lock. */
export async function validateImportPreviewFreshness(sourceDir: string, vault: VaultStorage, expected: ImportPreviewBinding): Promise<void> {
  const source = resolve(sourceDir);
  if (source !== expected.sourcePath || resolve(vault.root) !== expected.destinationPath) throw stalePreview();
  let currentPlan: ImportPlan;
  try { currentPlan = await planImport(source); }
  catch (error) { throw new StorageError('STALE_PREVIEW', 'The import source changed or is no longer valid after preview. Create a new preview and review its diagnostics.', { cause: error }); }
  const currentTarget = await vault.snapshotForPortableExport?.();
  if (!currentTarget) throw new StorageError('INVALID_INPUT', 'The active storage adapter cannot validate an import preview.');
  if (fingerprintPlan(currentPlan) !== expected.sourceFingerprint || fingerprintSnapshot(currentTarget) !== expected.destinationFingerprint) throw stalePreview();
}

/** Selects only resources explicitly approved in the reviewed preview. */
export function selectImportPlan(plan: ImportPlan, decisions: Array<{ kind: string; id: string; path: string; choice: 'add' | 'skip' | 'replace' }>): ImportPlan {
  const selected = new Set(decisions.filter((item) => item.choice === 'add' || item.choice === 'replace').map((item) => JSON.stringify([item.kind, item.id, item.path])));
  const keep = (kind: string, id: string, path: string) => selected.has(JSON.stringify([kind, id, path]));
  const entries = plan.entries.filter((entry) => keep(entry.kind, entry.id, entry.path));
  const notes = plan.notes.filter((note) => keep('note', note.id, note.path));
  const databases = plan.databases.filter((database) => keep('database', database.id, `databases/${database.id}.json`));
  const databaseViews = (plan.databaseViews ?? []).filter((view) => keep('database-view', view.id, `database-views/${view.databaseId}/${view.id}.json`));
  const databaseViewOrders = (plan.databaseViewOrders ?? []).filter((order) => keep('database-view-order', order.databaseId, order.path));
  const propertyCatalog = plan.propertyCatalog && keep('property-catalog', 'property-catalog', plan.propertyCatalog.path) ? plan.propertyCatalog : undefined;
  return { entries, notes, databases, databaseViews, databaseViewOrders, ...(propertyCatalog ? { propertyCatalog } : {}), ...(plan.portableManifest ? { portableManifest: plan.portableManifest } : {}), ...(plan.sourceManifestSha256 ? { sourceManifestSha256: plan.sourceManifestSha256 } : {}), ...(plan.sourceFolders ? { sourceFolders: plan.sourceFolders } : {}), ...(plan.excluded ? { excluded: plan.excluded } : {}) };
}

function stalePreview(): StorageError { return new StorageError('STALE_PREVIEW', 'The import source or destination changed after preview. Create a new preview before continuing.'); }

function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

function validateManifestResources(manifest: PortableExportManifest, entries: VaultEntry[], catalog: PropertyCatalogFile | undefined, orders: DatabaseViewOrderFileSnapshot[]): void {
  const actual: Array<{ kind: string; id: string; path: string; bytes: Uint8Array | string; ownerId?: string }> = entries.map((entry) => ({ kind: entry.kind, id: entry.id, path: entry.path, bytes: entry.rawBytes ?? entry.text, ...(entry.kind === 'database-view' ? { ownerId: entry.path.split('/')[1] } : {}) }));
  if (catalog) actual.push({ kind: 'property-catalog', id: 'property-catalog', path: catalog.path, bytes: catalog.rawBytes });
  for (const order of orders) actual.push({ kind: 'database-view-order', id: order.databaseId, path: order.path, bytes: order.rawBytes });
  const expected = manifest.resources;
  const key = (r: { kind: string; id: string; path: string; ownerId?: string }) => JSON.stringify([r.kind, r.id, r.path, r.ownerId ?? null]);
  if (actual.length < expected.length) {
    const absent = expected.filter((candidate) => !actual.some((resource) => key(resource) === key(candidate)));
    throw new StorageError('INVALID_CONTENT', `Portable manifest resource is missing: ${absent.map((item) => item.path).join(', ')}`, { details: { paths: absent.map((item) => item.path), ids: absent.map((item) => item.id) } });
  }
  if (actual.length > expected.length) throw new StorageError('INVALID_CONTENT', 'Portable manifest contains fewer resources than the parsed source.', { details: { paths: actual.map((item) => item.path) } });
  for (const resource of actual) {
    const candidate = expected.find((item) => key(item) === key(resource));
    if (!candidate) throw new StorageError('INVALID_CONTENT', 'Portable manifest resources do not match parsed resource identities, types, or paths.', { path: resource.path, details: { paths: expected.map((item) => item.path), ids: [resource.id] } });
    if (byteLength(resource.bytes) !== candidate.bytes || sha256Entry({ ...resource, bytes: resource.bytes }) !== candidate.sha256) throw new StorageError('INVALID_CONTENT', `Portable resource changed while it was being planned: ${resource.path}`, { path: resource.path, details: { paths: [resource.path], ids: [resource.id] } });
  }
}

interface PreviewSourceResource { kind: string; id: string; path: string; bytes: Uint8Array | string }
function previewResource(entry: VaultEntry): PreviewSourceResource { return { kind: entry.kind, id: entry.id, path: entry.path, bytes: entry.rawBytes ?? entry.text }; }
function classifyResource(incoming: PreviewSourceResource, existing: PreviewSourceResource[]): ImportPreviewResource {
  const byId = existing.find((entry) => entry.kind === incoming.kind && entry.id === incoming.id);
  const byPath = existing.find((entry) => entry.path.normalize('NFC').toLowerCase() === incoming.path.normalize('NFC').toLowerCase());
  if (byId && byId.path === incoming.path && sha256Entry(byId) === sha256Entry(incoming)) return { kind: incoming.kind, id: incoming.id, path: incoming.path, status: 'identical', safeChoices: ['skip'] };
  if (byId || byPath) return { kind: incoming.kind, id: incoming.id, path: incoming.path, status: 'conflict', reason: byId ? `ID already exists at ${byId.path}${byId.path !== incoming.path ? '; source path differs' : ' with different content'}` : `Path is already owned by ${byPath!.kind} ${byPath!.id}`, safeChoices: ['skip', ...(byId && byId.path === incoming.path ? ['replace' as const] : [])] };
  return { kind: incoming.kind, id: incoming.id, path: incoming.path, status: 'new', safeChoices: ['add', 'skip'] };
}

function sha256Entry(entry: PreviewSourceResource): string { return createHash('sha256').update(entry.bytes).digest('hex'); }

function databaseWarnings(plan: ImportPlan): string[] {
  const warnings: string[] = [];
  const schemas = new Map(plan.databases.map((database) => [database.id, database]));
  for (const database of plan.databases) for (const property of database.properties) if (property.type === 'relation' && property.relation && !schemas.has(property.relation.databaseId)) warnings.push(`Database ${database.id} property ${property.id} targets missing database ${property.relation.databaseId}.`);
  for (const view of plan.databaseViews ?? []) for (const diagnostic of diagnoseDatabaseView(view, schemas.get(view.databaseId))) warnings.push(`Saved view ${view.id}: ${diagnostic.message}`);
  const relationProjection = projectRelations(plan.notes, schemas);
  for (const issue of relationProjection.diagnostics) warnings.push(`${issue.path}: ${issue.message}`);
  return [...new Set(warnings)];
}

async function readImportTemplateFiles(source: string): Promise<VaultEntry[]> {
  const root = join(source, '.nodus-templates');
  let rootInfo;
  try { rootInfo = await lstat(root); } catch (error) { if (isMissing(error)) return []; throw storageFailure(error, 'Read import template directory', '.nodus-templates'); }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new StorageError('INVALID_CONTENT', 'Template storage must be a regular .nodus-templates directory', { path: '.nodus-templates' });
  const children = await readdir(root);
  if (children.some((child) => child !== 'templates.json')) throw new StorageError('INVALID_CONTENT', 'Unexpected file in template storage', { path: '.nodus-templates' });
  if (!children.includes('templates.json')) return [];
  const path = TEMPLATE_CATALOG_PATH;
  const absolute = join(root, 'templates.json');
  const info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink()) throw new StorageError('INVALID_CONTENT', 'Template catalog must be a regular file', { path });
  const bytes = await readBoundedImportFile(absolute, path, IMPORT_MAX_RESOURCE_BYTES);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); parseTemplates(text); }
  catch (error) { throw wrapContentError(error, path); }
  return [{ kind: 'template-catalog', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', path, text, rawBytes: Buffer.from(bytes) }];
}

async function readImportDatabaseAutomationFiles(source: string): Promise<VaultEntry[]> {
  const root = join(source, '.nodus-automations');
  let rootInfo;
  try { rootInfo = await lstat(root); } catch (error) { if (isMissing(error)) return []; throw storageFailure(error, 'Read import automation directory', '.nodus-automations'); }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new StorageError('INVALID_CONTENT', 'Automation storage must be a regular .nodus-automations directory', { path: '.nodus-automations' });
  const children = await readdir(root);
  const allowed = new Set(['automations.json', 'history.json']);
  for (const child of children) if (!allowed.has(child)) throw new StorageError('INVALID_CONTENT', `Unexpected file in automation storage: ${child}`, { path: `.nodus-automations/${child}` });
  const entries: VaultEntry[] = [];
  for (const [name, path, kind, id] of [
    ['automations.json', DATABASE_AUTOMATIONS_PATH, 'automation-definitions', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'],
    ['history.json', DATABASE_AUTOMATION_HISTORY_PATH, 'automation-history', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'],
  ] as const) {
    if (!children.includes(name)) continue;
    const absolute = join(root, name); const info = await lstat(absolute);
    if (!info.isFile() || info.isSymbolicLink()) throw new StorageError('INVALID_CONTENT', `Automation file must be a regular file: ${path}`, { path });
    let bytes: Buffer; try { bytes = await readBoundedImportFile(absolute, path, IMPORT_MAX_RESOURCE_BYTES); } catch (error) { throw storageFailure(error, 'Read import automation file', path); }
    const text = bytes.toString('utf8');
    try { if (kind === 'automation-definitions') parseAutomations(text); else parseAutomationHistory(text); }
    catch (error) { throw wrapContentError(error, path); }
    entries.push({ kind, id, path, text, rawBytes: Buffer.from(bytes) });
  }
  return entries;
}

/**
 * Reads hidden ordering manifests from a portable export. A missing directory
 * is a legacy export and restores with deterministic default ordering.
 */
async function readImportDatabaseViewOrders(source: string): Promise<DatabaseViewOrderFileSnapshot[]> {
  const rootDirectory = join(source, DATABASE_VIEW_ORDER_DIR);
  let rootInfo;
  try {
    rootInfo = await lstat(rootDirectory);
  } catch (error) {
    if (isMissing(error)) return [];
    throw storageFailure(error, 'Read import saved-view order directory', DATABASE_VIEW_ORDER_DIR);
  }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new StorageError('INVALID_CONTENT', 'Import saved-view order storage must be a regular directory', { path: DATABASE_VIEW_ORDER_DIR });
  }
  const directory = join(rootDirectory, 'database-views');
  let directoryInfo;
  try {
    directoryInfo = await lstat(directory);
  } catch (error) {
    if (isMissing(error)) return [];
    throw storageFailure(error, 'Read import saved-view order directory', `${DATABASE_VIEW_ORDER_DIR}/database-views`);
  }
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
    throw new StorageError('INVALID_CONTENT', 'Import saved-view order storage must be a regular directory', { path: `${DATABASE_VIEW_ORDER_DIR}/database-views` });
  }

  let dirents;
  try { dirents = await readdir(directory, { withFileTypes: true }); }
  catch (error) { throw storageFailure(error, 'Read import saved-view order directory', `${DATABASE_VIEW_ORDER_DIR}/database-views`); }
  dirents.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const orders: DatabaseViewOrderFileSnapshot[] = [];
  for (const dirent of dirents) {
    if (dirent.name.startsWith('.')) continue;
    const match = /^([0-9a-f-]{36})\.json$/.exec(dirent.name);
    if (match === null || !isUuidV4(match[1]!)) {
      throw new StorageError('INVALID_CONTENT', `Import saved-view order storage contains an unexpected file: "${dirent.name}"`, { path: `${DATABASE_VIEW_ORDER_DIR}/database-views/${dirent.name}` });
    }
    if (dirent.isSymbolicLink() || !dirent.isFile()) {
      throw new StorageError('INVALID_CONTENT', `Import ordering manifest "${dirent.name}" must be a regular file`, { path: `${DATABASE_VIEW_ORDER_DIR}/database-views/${dirent.name}` });
    }
    const databaseId = match[1]!;
    const path = databaseViewOrderPath(databaseId);
    let bytes: Buffer;
    try { bytes = await readBoundedImportFile(join(directory, dirent.name), path, IMPORT_MAX_RESOURCE_BYTES); }
    catch (error) { throw storageFailure(error, 'Read import ordering manifest', path); }
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new StorageError('INVALID_CONTENT', `File "${path}" is not valid UTF-8 text`, { path }); }
    let parsed;
    try { parsed = parseDatabaseViewOrder(text); }
    catch (error) { throw wrapContentError(error, path); }
    if (parsed.databaseId !== databaseId) {
      throw new StorageError('INVALID_CONTENT', `Import ordering manifest "${path}" contains database ID "${parsed.databaseId}"`, { path });
    }
    orders.push({
      databaseId,
      path,
      text,
      rawBytes: Buffer.from(bytes),
      hash: createHash('sha256').update(bytes).digest('hex'),
      revision: parsed.revision,
      viewIds: parsed.viewIds,
    });
  }
  return orders;
}

async function readImportPropertyCatalog(source: string): Promise<PropertyCatalogFile | undefined> {
  const propertiesDirectory = join(source, 'properties');
  let directoryInfo;
  try {
    directoryInfo = await lstat(propertiesDirectory);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw storageFailure(error, 'Read import property catalog directory', 'properties');
  }
  if (!directoryInfo.isDirectory()) {
    if (directoryInfo.isSymbolicLink()) throw new StorageError('INVALID_CONTENT', 'Import property catalog directory cannot be a symbolic link', { path: 'properties' });
    return undefined;
  }

  const catalogPath = join(source, PROPERTY_CATALOG_PATH);
  let catalogInfo;
  try {
    catalogInfo = await lstat(catalogPath);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw storageFailure(error, 'Read import property catalog', PROPERTY_CATALOG_PATH);
  }
  if (catalogInfo.isSymbolicLink() || !catalogInfo.isFile()) {
    throw new StorageError('INVALID_CONTENT', 'Import property catalog must be a regular file', { path: PROPERTY_CATALOG_PATH });
  }

  let bytes: Buffer;
  try {
    bytes = await readBoundedImportFile(catalogPath, PROPERTY_CATALOG_PATH, IMPORT_MAX_RESOURCE_BYTES);
  } catch (error) {
    throw storageFailure(error, 'Read import property catalog', PROPERTY_CATALOG_PATH);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new StorageError('INVALID_CONTENT', `File "${PROPERTY_CATALOG_PATH}" is not valid UTF-8 text`, { path: PROPERTY_CATALOG_PATH });
  }
  let catalog;
  let version: number;
  try {
    catalog = parsePropertyCatalog(text);
    version = catalogVersionFromText(text);
  } catch (error) {
    throw wrapContentError(error, PROPERTY_CATALOG_PATH);
  }
  return {
    path: PROPERTY_CATALOG_PATH,
    text,
    rawBytes: Buffer.from(bytes),
    hash: createHash('sha256').update(bytes).digest('hex'),
    version,
    catalog,
  };
}

function catalogVersionFromText(text: string): number {
  const parsed = JSON.parse(text) as { version?: unknown };
  return typeof parsed.version === 'number' ? parsed.version : 0;
}

/** Applies a previously validated plan. Conflicts are checked before writing. */
export async function applyImport(
  vault: VaultStorage,
  plan: ImportPlan,
  options: ImportOptions = {},
): Promise<ImportReport> {
  return vault.applyImport(plan, options);
}

function assertNoPathCollision(path: string, seen: Map<string, string>): void {
  const key = path.normalize('NFC').toLowerCase();
  const previous = seen.get(key);
  if (previous !== undefined) {
    throw new StorageError(
      'CONFLICT',
      `Import contains two paths that collide on case-insensitive filesystems: "${previous}" and "${path}"`,
      { path, details: { paths: [previous, path] } },
    );
  }
  seen.set(key, path);
}

async function readText(absolute: string, relativePath: string): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await readBoundedImportFile(absolute, relativePath, IMPORT_MAX_RESOURCE_BYTES);
  } catch (error) {
    throw storageFailure(error, 'Read import file', relativePath);
  }

  try {
    // Keep a valid BOM in the planned text so imports preserve source bytes.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new StorageError('INVALID_CONTENT', `File "${relativePath}" is not valid UTF-8 text`, {
      path: relativePath,
    });
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}
