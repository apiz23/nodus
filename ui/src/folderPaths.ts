const NOTES_ROOT = 'notes';

/** Strip the hidden notes root from a vault-relative path, if present. */
export function toDisplayPath(path: string): string {
  return path.startsWith(`${NOTES_ROOT}/`) ? path.slice(NOTES_ROOT.length + 1) : path;
}

/** Convert a storage folder path (with optional `notes/` root) to the sidebar display path. */
export function toDisplayFolderPath(storagePath: string): string {
  return storagePath === NOTES_ROOT ? '' : toDisplayPath(storagePath);
}

export interface FolderBreadcrumbSegment {
  /** Label shown in the breadcrumb. */
  label: string;
  /** Vault-relative target, including the hidden `notes/` root when present. */
  storagePath: string;
}

/** Build actionable folder segments for a note, keeping display labels and storage targets distinct. */
export function folderBreadcrumbSegments(notePath: string): FolderBreadcrumbSegment[] {
  const parts = notePath.split('/').filter(Boolean);
  const storageFolderParts = parts.slice(0, -1);
  const hasNotesRoot = storageFolderParts[0] === NOTES_ROOT;
  const labels = hasNotesRoot ? storageFolderParts.slice(1) : storageFolderParts;
  const offset = hasNotesRoot ? 1 : 0;
  return labels.map((label, index) => ({
    label,
    storagePath: storageFolderParts.slice(0, index + 1 + offset).join('/'),
  }));
}

/** Add a folder and every ancestor to an expanded-path set. */
export function withFolderAncestors(current: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(current);
  const parts = path.split('/').filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    next.add(parts.slice(0, index + 1).join('/'));
  }
  return next;
}
