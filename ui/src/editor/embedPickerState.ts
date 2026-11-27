/**
 * Pure state for the saved-view picker. Keeping the transitions here makes the
 * loading, empty, failure and selection states deterministic and testable
 * without a browser: the dialog cannot show "no saved view" while a view
 * request is still in flight.
 */

export type PickerStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PickerOption {
  id: string;
  name: string;
}

export interface EmbedPickerState {
  databases: readonly PickerOption[];
  databaseId: string;
  databaseStatus: PickerStatus;
  databaseError: string | null;
  views: readonly PickerOption[];
  viewId: string;
  viewStatus: PickerStatus;
  viewError: string | null;
}

export type EmbedPickerEvent =
  | { type: 'reset' }
  | { type: 'databases-loading' }
  | { type: 'databases-loaded'; databases: readonly PickerOption[] }
  | { type: 'databases-failed'; message: string }
  | { type: 'select-database'; databaseId: string }
  | { type: 'views-loading' }
  | { type: 'views-loaded'; views: readonly PickerOption[] }
  | { type: 'views-failed'; message: string }
  | { type: 'select-view'; viewId: string };

export const INITIAL_EMBED_PICKER_STATE: EmbedPickerState = {
  databases: [],
  databaseId: '',
  databaseStatus: 'idle',
  databaseError: null,
  views: [],
  viewId: '',
  viewStatus: 'idle',
  viewError: null,
};

/** Keep a selection only when the loaded options still contain it. */
function keepOrFirst(options: readonly PickerOption[], current: string): string {
  if (current !== '' && options.some((option) => option.id === current)) return current;
  return options[0]?.id ?? '';
}

export function embedPickerReducer(state: EmbedPickerState, event: EmbedPickerEvent): EmbedPickerState {
  switch (event.type) {
    case 'reset':
      return INITIAL_EMBED_PICKER_STATE;
    case 'databases-loading':
      return { ...state, databaseStatus: 'loading', databaseError: null };
    case 'databases-loaded': {
      const databaseId = keepOrFirst(event.databases, state.databaseId);
      return {
        ...state,
        databases: event.databases,
        databaseId,
        databaseStatus: 'ready',
        databaseError: null,
        ...(databaseId === state.databaseId
          ? {}
          : { views: [], viewId: '', viewStatus: 'loading' as const, viewError: null }),
      };
    }
    case 'databases-failed':
      return {
        ...state,
        databases: [],
        databaseId: '',
        databaseStatus: 'error',
        databaseError: event.message,
        views: [],
        viewId: '',
        viewStatus: 'idle',
        viewError: null,
      };
    case 'select-database':
      if (event.databaseId === state.databaseId) return state;
      return {
        ...state,
        databaseId: event.databaseId,
        databaseError: null,
        views: [],
        viewId: '',
        viewStatus: 'loading',
        viewError: null,
      };
    case 'views-loading':
      return { ...state, viewStatus: 'loading', viewError: null };
    case 'views-loaded': {
      const viewId = keepOrFirst(event.views, state.viewId);
      return { ...state, views: event.views, viewId, viewStatus: 'ready', viewError: null };
    }
    case 'views-failed':
      return { ...state, views: [], viewId: '', viewStatus: 'error', viewError: event.message };
    case 'select-view':
      return { ...state, viewId: event.viewId };
    default:
      return state;
  }
}

export function pickerDatabasesPlaceholder(state: EmbedPickerState): string {
  if (state.databaseStatus === 'loading') return 'Loading databases…';
  if (state.databaseStatus === 'error') return 'Could not load databases';
  if (state.databases.length === 0) return 'No databases in this vault';
  return 'Choose a database';
}

export function pickerViewPlaceholder(state: EmbedPickerState): string {
  if (state.databaseId === '') return 'Choose a database first';
  if (state.viewStatus === 'loading') return 'Loading saved views…';
  if (state.viewStatus === 'error') return 'Could not load saved views';
  if (state.viewStatus !== 'ready') return 'Choose a view';
  if (state.views.length === 0) return 'This database has no saved view';
  return 'Choose a view';
}

export function pickerCanInsert(state: EmbedPickerState): boolean {
  return state.databaseStatus === 'ready'
    && state.viewStatus === 'ready'
    && state.databaseId !== ''
    && state.viewId !== '';
}

/** Message shown under the picker; never claims "empty" while loading. */
export function pickerHint(state: EmbedPickerState): string | null {
  if (state.databaseStatus === 'error') return state.databaseError ?? 'Could not load databases.';
  if (state.viewStatus === 'error') return state.viewError ?? 'Could not load saved views.';
  if (state.databaseStatus === 'ready' && state.databases.length === 0) {
    return 'Create a database and save a view first, then embed it here.';
  }
  if (state.viewStatus === 'ready' && state.databaseId !== '' && state.views.length === 0) {
    return 'Save a view on this database before embedding it.';
  }
  return null;
}
