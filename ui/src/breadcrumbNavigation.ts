import type { NoteFilter, NoteFilterLogic } from '../../src/search/note-filters';
import { toDisplayFolderPath } from './folderPaths';

export interface FolderNavigationCommand {
  path: string | null;
  sequence: number;
}

export interface BreadcrumbNavigationPatch {
  query: string;
  noteFilters: NoteFilter[];
  filterLogic: NoteFilterLogic;
  folderPath: string | null;
  sequence: number;
}

export type FolderNavigationEvent =
  | { type: 'navigate'; command: FolderNavigationCommand }
  | { type: 'acknowledge'; sequence: number }
  | { type: 'note-opened' };

export type BreadcrumbReveal = 'expand-sidebar' | 'open-drawer' | 'none';

export interface BreadcrumbRevealPlan {
  exitFocus: boolean;
  reveal: BreadcrumbReveal;
}

/**
 * Breadcrumb navigation leaves focus mode and reveals a folder destination.
 * All Notes does not open the mobile drawer because its destination is the
 * main notes view, not the sidebar tree.
 */
export function planBreadcrumbReveal(
  desktop: boolean,
  focusMode: boolean,
  hasFolderTarget: boolean,
): BreadcrumbRevealPlan {
  return {
    exitFocus: focusMode,
    reveal: desktop ? 'expand-sidebar' : hasFolderTarget ? 'open-drawer' : 'none',
  };
}

/**
 * Breadcrumb navigation always returns to All Notes with free-text and metadata
 * filters cleared. A folder target is converted to its sidebar display path,
 * never passed through the search grammar.
 */
export function breadcrumbNavigationPatch(storagePath: string | null, sequence: number): BreadcrumbNavigationPatch {
  return {
    query: '',
    noteFilters: [],
    filterLogic: 'and',
    folderPath: storagePath === null ? null : toDisplayFolderPath(storagePath),
    sequence,
  };
}

/**
 * Single lifecycle for the transient folder command. Acknowledgment only clears
 * the command it belongs to; opening a note always cancels any pending command.
 */
export function reduceFolderNavigation(
  current: FolderNavigationCommand | undefined,
  event: FolderNavigationEvent,
): FolderNavigationCommand | undefined {
  switch (event.type) {
    case 'navigate':
      return event.command;
    case 'acknowledge':
      return current?.sequence === event.sequence ? undefined : current;
    case 'note-opened':
      return undefined;
  }
}
