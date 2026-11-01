import { NodusError } from '../domain/errors.js';
import { isUuidV4 } from '../domain/ids.js';

/**
 * Persistent saved-view ordering manifest.
 *
 * Ordering lives in a small Nodus-owned JSON file per database so reordering
 * never rewrites view files. The manifest stores stable view IDs, a revision
 * that increments on every accepted write, and no view content.
 */
export const DATABASE_VIEW_ORDER_FORMAT = 'nodus-database-view-order';
export const DATABASE_VIEW_ORDER_VERSION = 1;

export interface DatabaseViewOrderFile {
  databaseId: string;
  /** Starts at 1 and increases with every accepted manifest write. */
  revision: number;
  viewIds: string[];
}

export function parseDatabaseViewOrder(json: string): DatabaseViewOrderFile {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch (error) { throw invalid(`View order file is not valid JSON: ${(error as Error).message}`); }
  if (!record(raw)) throw invalid('View order must be a JSON object');
  if (raw.format !== DATABASE_VIEW_ORDER_FORMAT) throw invalid(`format must be "${DATABASE_VIEW_ORDER_FORMAT}"`);
  if (!Number.isInteger(raw.version) || typeof raw.version !== 'number' || raw.version < 1) throw invalid('View order version must be a positive integer');
  if (raw.version > DATABASE_VIEW_ORDER_VERSION) throw new NodusError('UNSUPPORTED_VERSION', `View order version ${raw.version} is newer than supported version ${DATABASE_VIEW_ORDER_VERSION}; upgrade Nodus to read it`);
  exactKeys(raw, ['format', 'version', 'databaseId', 'revision', 'viewIds'], 'view order');
  const databaseId = uuid(raw.databaseId, 'databaseId');
  if (!Number.isInteger(raw.revision) || typeof raw.revision !== 'number' || raw.revision < 1) throw invalid('revision must be a positive integer');
  if (!Array.isArray(raw.viewIds)) throw invalid('viewIds must be an array');
  const viewIds = raw.viewIds.map((value, index) => uuid(value, `viewIds[${index}]`));
  unique(viewIds, 'view ID');
  return { databaseId, revision: raw.revision, viewIds };
}

export function serializeDatabaseViewOrder(order: DatabaseViewOrderFile): string {
  const json = `${JSON.stringify({
    format: DATABASE_VIEW_ORDER_FORMAT,
    version: DATABASE_VIEW_ORDER_VERSION,
    databaseId: order.databaseId,
    revision: order.revision,
    viewIds: order.viewIds,
  }, null, 2)}\n`;
  parseDatabaseViewOrder(json);
  return json;
}

/**
 * Applies a stored order to the views that currently exist.
 *
 * Deleted or unknown IDs are ignored, duplicates keep their first position,
 * and every view missing from the manifest is appended in the caller's
 * deterministic order (path order for a filesystem vault). Legacy databases
 * without a manifest therefore keep a stable default order.
 */
export function resolveDatabaseViewOrder(existingIds: readonly string[], orderedIds: readonly string[]): string[] {
  const existing = new Set(existingIds);
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const id of orderedIds) {
    if (!existing.has(id) || seen.has(id)) continue;
    seen.add(id);
    resolved.push(id);
  }
  for (const id of existingIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    resolved.push(id);
  }
  return resolved;
}

function uuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isUuidV4(value)) throw invalid(`${label} must be a lowercase UUID v4`);
  return value;
}
function exactKeys(value: Record<string, unknown>, allowed: string[], where: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw invalid(`Unknown key "${key}" in ${where}`);
}
function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw invalid(`Duplicate ${label}`);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function invalid(message: string): NodusError {
  return new NodusError('INVALID_DATABASE', message);
}
