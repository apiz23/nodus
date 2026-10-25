/** Vault layout constants shared by the adapter, export/import, and backups. */

export const DATABASES_DIR = 'databases';
export const BACKUP_MANIFEST = 'nodus-backup.json';
export const BACKUP_FORMAT = 'nodus-backup';
export const BACKUP_VERSION = 1;
export const TEMP_PREFIX = '.nodus-tmp-';

/** Workspace-relative path of a database definition, always POSIX-separated. */
export function databasePath(id: string): string {
  return `${DATABASES_DIR}/${id}.json`;
}

export function isReservedNotePath(path: string): boolean {
  return path === DATABASES_DIR || path.startsWith(`${DATABASES_DIR}/`);
}
