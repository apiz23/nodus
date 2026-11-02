/** Vault layout constants shared by the adapter, export/import, and backups. */

export const DATABASES_DIR = 'databases';
export const DATABASE_VIEWS_DIR = 'database-views';
/** Hidden Nodus-owned directory; the vault scanner skips hidden root entries. */
export const DATABASE_VIEW_ORDER_DIR = '.nodus-orders';
export const DATABASE_AUTOMATIONS_DIR = '.nodus-automations';
export const DATABASE_AUTOMATIONS_PATH = `${DATABASE_AUTOMATIONS_DIR}/automations.json`;
export const DATABASE_AUTOMATION_HISTORY_PATH = `${DATABASE_AUTOMATIONS_DIR}/history.json`;
export const TEMPLATE_CATALOG_DIR = '.nodus-templates';
export const TEMPLATE_CATALOG_PATH = `${TEMPLATE_CATALOG_DIR}/templates.json`;
export const BACKUP_MANIFEST = 'nodus-backup.json';
export const BACKUP_FORMAT = 'nodus-backup';
export const BACKUP_VERSION = 7;
export const TEMP_PREFIX = '.nodus-tmp-';
export const TEMPLATE_APPLY_TRANSACTION_PREFIX = `${TEMP_PREFIX}template-apply-`;

/** Workspace-relative path of a database definition, always POSIX-separated. */
export function databasePath(id: string): string {
  return `${DATABASES_DIR}/${id}.json`;
}

export function databaseViewPath(databaseId: string, viewId: string): string {
  return `${DATABASE_VIEWS_DIR}/${databaseId}/${viewId}.json`;
}

/** Hidden per-database saved-view ordering manifest. */
export function databaseViewOrderPath(databaseId: string): string {
  return `${DATABASE_VIEW_ORDER_DIR}/database-views/${databaseId}.json`;
}

export function isReservedNotePath(path: string): boolean {
  return path === DATABASES_DIR || path.startsWith(`${DATABASES_DIR}/`) ||
    path === DATABASE_VIEWS_DIR || path.startsWith(`${DATABASE_VIEWS_DIR}/`);
}
