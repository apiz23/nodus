/**
 * Maps a successful non-GET API request to the embedded-view cache scope it
 * can actually affect. The mapping is deliberately conservative: an unknown
 * mutation invalidates everything, while a known unrelated write (note tags,
 * preferences, backups, task toggles) invalidates nothing.
 *
 * Paths are the UI's own API paths, so this stays a pure string mapping and can
 * be tested without running the server.
 */

export type ViewDataInvalidation =
  | { kind: 'none' }
  | { kind: 'all' }
  | { kind: 'databases' }
  | { kind: 'database'; databaseId: string }
  | { kind: 'views'; databaseId: string }
  | { kind: 'rows'; databaseId?: string };

const NONE: ViewDataInvalidation = { kind: 'none' };
const ALL: ViewDataInvalidation = { kind: 'all' };

function databaseIdFromBody(body: string | null | undefined): string | undefined {
  if (body === null || body === undefined || body === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const value = (parsed as { databaseId?: unknown }).databaseId;
    return typeof value === 'string' && value !== '' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** True when the detail came from `api.request` and has a supported shape. */
export function isViewDataInvalidation(value: unknown): value is ViewDataInvalidation {
  if (typeof value !== 'object' || value === null) return false;
  const scope = value as { kind?: unknown; databaseId?: unknown };
  switch (scope.kind) {
    case 'none':
    case 'all':
    case 'databases':
      return true;
    case 'database':
    case 'views':
      return typeof scope.databaseId === 'string' && scope.databaseId !== '';
    case 'rows':
      return scope.databaseId === undefined || (typeof scope.databaseId === 'string' && scope.databaseId !== '');
    default:
      return false;
  }
}

export function invalidationForMutation(
  method: string,
  path: string,
  body: string | null | undefined = null,
): ViewDataInvalidation {
  if (method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD') return NONE;

  const pathname = path.split('?', 1)[0] ?? '';
  const segments = pathname.split('/').filter((segment) => segment !== '');

  // Vault switching, imports, restores and sync can replace many notes at once.
  if (segments[1] === 'vault') return ALL;
  if (segments[1] === 'restore') {
    // Previewing a restore reads and validates; executing it replaces data.
    return segments[2] === 'preview' ? NONE : ALL;
  }
  if (segments[1] === 'import') {
    // Preview and recipe listing are read-only despite using POST.
    return segments[2] === 'execute' || segments[2] === 'retry' || segments.includes('recover') ? ALL : NONE;
  }
  if (segments[1] === 'sync' && (segments[2] === 'pull' || (segments[2] === 'resolutions' && segments.at(-1) === 'execute'))) return ALL;

  if (segments[1] === 'databases') {
    const databaseId = segments[2];
    if (databaseId === undefined) return { kind: 'databases' };
    if (segments[3] === undefined) return { kind: 'database', databaseId };
    if (segments[3] === 'views') return { kind: 'views', databaseId };
    if (segments[3] === 'rows') return { kind: 'rows', databaseId };
    if (segments[3] === 'automations') return NONE;
    // Relation candidates or future sub-resources: treat as schema-relevant.
    return { kind: 'database', databaseId };
  }

  if (segments[1] === 'notes') {
    if (segments[3] === 'properties') {
      const databaseId = databaseIdFromBody(body);
      return databaseId === undefined ? { kind: 'rows' } : { kind: 'rows', databaseId };
    }
    if (segments[3] === 'calendar-range') {
      const databaseId = databaseIdFromBody(body);
      return databaseId === undefined ? { kind: 'rows' } : { kind: 'rows', databaseId };
    }
    // Titles, paths and database membership can appear in embedded rows.
    if (segments[3] === 'tags') return NONE;
    if (segments[3] === 'tasks') return NONE;
    if (segments[3] === 'related' || segments[3] === 'backlinks' || segments[3] === 'relation-backlinks') return NONE;
    return { kind: 'rows' };
  }

  if (segments[1] === 'folders') return { kind: 'rows' };
  if (segments[1] === 'organization') return segments[2] === undefined ? NONE : { kind: 'rows' };
  if (segments[1] === 'properties') return NONE;

  if (segments[1] === 'preferences') return NONE;
  if (segments[1] === 'attachments') return NONE;
  if (segments[1] === 'backup' || segments[1] === 'export') return NONE;
  if (segments[1] === 'discovery' || segments[1] === 'search' || segments[1] === 'graph' || segments[1] === 'insights' || segments[1] === 'tasks') return NONE;

  return ALL;
}
