import { createHash } from 'node:crypto';
import type { ImportPlan, PortableExportSnapshot, VaultEntry } from '../contracts.js';

export interface FingerprintResource { kind: string; id: string; path: string; bytes: Uint8Array | string }

export function sha256Bytes(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function byteLength(bytes: Uint8Array | string): number {
  return typeof bytes === 'string' ? Buffer.byteLength(bytes, 'utf8') : bytes.byteLength;
}

export function fingerprintPlan(plan: ImportPlan): string {
  const resources: FingerprintResource[] = plan.entries.map(fingerprintEntry);
  if (plan.propertyCatalog) resources.push({ kind: 'property-catalog', id: 'property-catalog', path: plan.propertyCatalog.path, bytes: plan.propertyCatalog.rawBytes });
  for (const order of plan.databaseViewOrders ?? []) resources.push({ kind: 'database-view-order', id: order.databaseId, path: order.path, bytes: order.rawBytes });
  return hashCanonical({
    format: plan.portableManifest ? 'nodus-portable-export' : 'legacy-directory',
    manifestSha256: plan.sourceManifestSha256 ?? null,
    resources: canonicalResources(resources),
    folders: [...(plan.sourceFolders ?? [])].sort(),
    excluded: [...(plan.excluded ?? [])].sort((a, b) => compareText(a.path, b.path)),
  });
}

export function fingerprintSnapshot(snapshot: PortableExportSnapshot): string {
  const resources: FingerprintResource[] = [...snapshot.entries, ...snapshot.automationFiles, ...snapshot.templateFiles].map(fingerprintEntry);
  if (snapshot.propertyCatalog) resources.push({ kind: 'property-catalog', id: 'property-catalog', path: snapshot.propertyCatalog.path, bytes: snapshot.propertyCatalog.rawBytes });
  for (const order of snapshot.databaseViewOrders) resources.push({ kind: 'database-view-order', id: order.databaseId, path: order.path, bytes: order.rawBytes });
  return fingerprintResourceInventory(resources.map((item) => ({ kind: item.kind, id: item.id, path: item.path, bytes: byteLength(item.bytes), sha256: sha256Bytes(item.bytes) })), snapshot.folders, snapshot.excluded);
}

export function fingerprintResourceInventory(resources: Array<{ kind: string; id: string; path: string; bytes: number; sha256: string }>, folders: string[], excluded: Array<{ path: string; reason: string }>): string {
  const canonical = [...resources].sort((a, b) => compareText(a.path, b.path) || compareText(a.kind, b.kind) || compareText(a.id, b.id));
  return hashCanonical({ resources: canonical, folders: [...folders].sort(), excluded: [...excluded].sort((a, b) => compareText(a.path, b.path)) });
}

export function fingerprintEntry(entry: VaultEntry): FingerprintResource {
  return { kind: entry.kind, id: entry.id, path: entry.path, bytes: entry.rawBytes ?? entry.text };
}

function canonicalResources(resources: FingerprintResource[]) {
  return resources
    .map((item) => ({ kind: item.kind, id: item.id, path: item.path, bytes: byteLength(item.bytes), sha256: sha256Bytes(item.bytes) }))
    .sort((a, b) => compareText(a.path, b.path) || compareText(a.kind, b.kind) || compareText(a.id, b.id));
}

function hashCanonical(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function compareText(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
