/** Vault layout constants shared by the adapter, export/import, and backups. */

export const DATABASES_DIR = 'databases';
export const DATABASE_VIEWS_DIR = 'database-views';
export const BACKUP_MANIFEST = 'nodus-backup.json';
export const BACKUP_FORMAT = 'nodus-backup';
export const BACKUP_VERSION = 2;
export const TEMP_PREFIX = '.nodus-tmp-';

/** Workspace-relative path of a database definition, always POSIX-separated. */
export function databasePath(id: string): string {
  return `${DATABASES_DIR}/${id}.json`;
}

export function databaseViewPath(databaseId: string, viewId: string): string {
  return `${DATABASE_VIEWS_DIR}/${databaseId}/${viewId}.json`;
}

export function isReservedNotePath(path: string): boolean {
  return path === DATABASES_DIR || path.startsWith(`${DATABASES_DIR}/`) ||
    path === DATABASE_VIEWS_DIR || path.startsWith(`${DATABASE_VIEWS_DIR}/`);
}
