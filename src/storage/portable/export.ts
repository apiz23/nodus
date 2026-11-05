import { mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { ExportReport, PortableExportSnapshot, VaultEntry, VaultStorage } from '../contracts.js';
import { StorageError, storageFailure } from '../errors.js';
import { writeFileAtomicExclusive } from '../fs/atomic.js';
import { resolveInsideRoot, isInsideRoot } from '../fs/safe-path.js';
import { PROPERTY_CATALOG_PATH } from '../../properties/catalog.js';
import { DATABASE_FORMAT_VERSION } from '../../database/schema.js';
import { DATABASE_VIEW_VERSION } from '../../database/database-view.js';
import { DATABASE_VIEW_ORDER_VERSION } from '../../database/database-view-order.js';
import { PROPERTY_CATALOG_VERSION } from '../../properties/catalog.js';
import { TEMPLATE_VERSION } from '../../database/templates.js';
import { NOTE_FORMAT_VERSION } from '../../domain/note.js';
import { createPortableManifest, PORTABLE_EXPORT_MANIFEST, PORTABLE_EXPORT_VERSION, serializePortableManifest, sha256, validatePortableExportContents, type PortableExportResource, type PortableResourceKind } from './manifest.js';

interface Payload { kind: PortableResourceKind; id: string; path: string; bytes: Buffer; ownerId?: string }

/** Writes a versioned portable vault package from one root-lock snapshot. */
export async function exportVault(vault: VaultStorage, targetDir: string, options: { now?: string } = {}): Promise<ExportReport> {
  const target = resolve(targetDir);
  if (await isInsideRoot(vault.root, target)) throw new StorageError('INVALID_INPUT', 'Export target must be outside the vault.', { path: targetDir });
  if (typeof vault.snapshotForPortableExport !== 'function') throw new StorageError('INVALID_INPUT', 'This storage adapter cannot guarantee a consistent portable export snapshot.');
  const snapshot = await vault.snapshotForPortableExport();
  const payloads = payloadsOf(snapshot);
  const resources: PortableExportResource[] = payloads.map((payload) => ({ kind: payload.kind, id: payload.id, path: payload.path, bytes: payload.bytes.byteLength, sha256: sha256(payload.bytes), ...(payload.ownerId === undefined ? {} : { ownerId: payload.ownerId }) }));
  const folders = requiredFolders(snapshot.folders, payloads.map((payload) => payload.path));
  const app = await readNodusAppInfo();
  const manifest = createPortableManifest({
    createdAt: options.now ?? new Date().toISOString(),
    snapshotConsistency: 'cooperating-nodus-writers',
    formats: { note: NOTE_FORMAT_VERSION, database: DATABASE_FORMAT_VERSION, databaseView: DATABASE_VIEW_VERSION, databaseViewOrder: DATABASE_VIEW_ORDER_VERSION, propertyCatalog: PROPERTY_CATALOG_VERSION, automation: 1, automationHistory: 1, templates: TEMPLATE_VERSION },
    resources, folders, excluded: snapshot.excluded, ...(app === undefined ? {} : { app }),
  });

  try { await mkdir(target, { recursive: true }); }
  catch (error) { throw storageFailure(error, 'Create portable export directory', targetDir); }
  const existing = await readdir(target).catch((error: unknown) => { throw storageFailure(error, 'Read portable export directory', targetDir); });
  if (existing.length > 0) throw new StorageError('CONFLICT', `Export target "${targetDir}" is not empty; refusing to overwrite.`, { path: targetDir, details: { paths: [targetDir] } });

  try {
    for (const folder of folders) await mkdir(resolveInsideRoot(target, folder), { recursive: true });
    for (const payload of payloads) await writeFileAtomicExclusive(resolveInsideRoot(target, payload.path), payload.bytes);
    await validatePortableExportContents(target, manifest, { manifestPresent: false });
    // The manifest is the completion marker and is intentionally written last.
    await writeFileAtomicExclusive(resolveInsideRoot(target, PORTABLE_EXPORT_MANIFEST), serializePortableManifest(manifest));
  } catch (error) {
    throw storageFailure(error, 'Write or validate portable export', targetDir);
  }
  const count = (kind: PortableResourceKind) => payloads.filter((payload) => payload.kind === kind).length;
  return {
    targetDir: target, notes: count('note'), databases: count('database'), databaseViews: count('database-view'),
    ...(count('attachment') === 0 ? {} : { attachments: count('attachment') }),
    ...(count('database-view-order') === 0 ? {} : { databaseViewOrders: count('database-view-order') }),
    ...(count('property-catalog') === 0 ? {} : { propertyCatalog: count('property-catalog') }),
    ...(count('automation-definitions') + count('automation-history') === 0 ? {} : { automationFiles: count('automation-definitions') + count('automation-history') }),
    ...(count('template-catalog') === 0 ? {} : { templateFiles: count('template-catalog') }),
    manifest: PORTABLE_EXPORT_MANIFEST, manifestVersion: PORTABLE_EXPORT_VERSION, excluded: snapshot.excluded,
  };
}

function payloadsOf(snapshot: PortableExportSnapshot): Payload[] {
  const payloads: Payload[] = [];
  for (const entry of snapshot.entries) payloads.push(payloadOfEntry(entry));
  if (snapshot.propertyCatalog) payloads.push({ kind: 'property-catalog', id: 'property-catalog', path: snapshot.propertyCatalog.path, bytes: Buffer.from(snapshot.propertyCatalog.rawBytes) });
  for (const order of snapshot.databaseViewOrders) payloads.push({ kind: 'database-view-order', id: order.databaseId, path: order.path, bytes: Buffer.from(order.rawBytes) });
  for (const entry of snapshot.automationFiles) payloads.push(payloadOfEntry(entry));
  for (const entry of snapshot.templateFiles) payloads.push(payloadOfEntry(entry));
  return payloads.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function payloadOfEntry(entry: VaultEntry): Payload {
  const kind = entry.kind as PortableResourceKind;
  return { kind, id: entry.id, path: entry.path, bytes: Buffer.from(entry.rawBytes ?? entry.text), ...(kind === 'database-view' ? { ownerId: entry.path.split('/')[1] } : {}) };
}

function requiredFolders(existing: string[], paths: string[]): string[] {
  const folders = new Set(existing);
  for (const path of paths) {
    let parent = dirname(path);
    while (parent !== '.') { folders.add(parent.replaceAll('\\', '/')); parent = dirname(parent); }
  }
  return [...folders].sort();
}

async function readNodusAppInfo(): Promise<{ name: string; version: string } | undefined> {
  try {
    const packageJson = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')) as { name?: unknown; version?: unknown };
    return typeof packageJson.name === 'string' && typeof packageJson.version === 'string' ? { name: packageJson.name, version: packageJson.version } : undefined;
  } catch { return undefined; }
}
