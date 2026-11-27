import { describe, expect, it } from 'vitest';
import {
  embedPickerReducer,
  INITIAL_EMBED_PICKER_STATE,
  pickerCanInsert,
  pickerDatabasesPlaceholder,
  pickerHint,
  pickerViewPlaceholder,
  type EmbedPickerState,
} from '@/editor/embedPickerState';

const DB_A = { id: '11111111-1111-4111-8111-111111111111', name: 'Work items' };
const DB_B = { id: '22222222-2222-4222-8222-222222222222', name: 'Bugs' };
const VIEW_A = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', name: 'All items' };
const VIEW_B = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', name: 'Bugs only' };

function opened(): EmbedPickerState {
  return embedPickerReducer(embedPickerReducer(INITIAL_EMBED_PICKER_STATE, { type: 'reset' }), { type: 'databases-loading' });
}

describe('saved-view picker states', () => {
  it('shows a loading state before the first database response', () => {
    const state = opened();
    expect(state.databaseStatus).toBe('loading');
    expect(pickerDatabasesPlaceholder(state)).toBe('Loading databases…');
    expect(state.views).toEqual([]);
    expect(pickerHint(state)).toBeNull();
  });

  it('shows loading instead of an empty message while saved views are in flight', () => {
    let state = embedPickerReducer(opened(), { type: 'databases-loaded', databases: [DB_A] });
    state = embedPickerReducer(state, { type: 'select-database', databaseId: DB_A.id });
    expect(state.viewStatus).toBe('loading');
    expect(pickerViewPlaceholder(state)).toBe('Loading saved views…');
    expect(pickerHint(state)).toBeNull();
    expect(pickerCanInsert(state)).toBe(false);
  });

  it('selects the first database and first saved view after loading', () => {
    let state = embedPickerReducer(opened(), { type: 'databases-loaded', databases: [DB_A, DB_B] });
    expect(state.databaseId).toBe(DB_A.id);
    state = embedPickerReducer(state, { type: 'views-loaded', views: [VIEW_A, VIEW_B] });
    expect(state.viewId).toBe(VIEW_A.id);
    expect(pickerCanInsert(state)).toBe(true);
  });

  it('reports an empty saved-view list only after a successful response', () => {
    let state = embedPickerReducer(opened(), { type: 'databases-loaded', databases: [DB_A] });
    state = embedPickerReducer(state, { type: 'views-loaded', views: [] });
    expect(state.viewStatus).toBe('ready');
    expect(pickerViewPlaceholder(state)).toBe('This database has no saved view');
    expect(pickerHint(state)).toBe('Save a view on this database before embedding it.');
    expect(pickerCanInsert(state)).toBe(false);
  });

  it('surfaces a failed saved-view load and allows a retry', () => {
    let state = embedPickerReducer(opened(), { type: 'databases-loaded', databases: [DB_A] });
    state = embedPickerReducer(state, { type: 'views-failed', message: 'Network unavailable' });
    expect(state.viewStatus).toBe('error');
    expect(pickerViewPlaceholder(state)).toBe('Could not load saved views');
    expect(pickerHint(state)).toBe('Network unavailable');
    expect(pickerCanInsert(state)).toBe(false);

    state = embedPickerReducer(state, { type: 'views-loading' });
    state = embedPickerReducer(state, { type: 'views-loaded', views: [VIEW_B] });
    expect(state.viewStatus).toBe('ready');
    expect(state.viewId).toBe(VIEW_B.id);
    expect(pickerCanInsert(state)).toBe(true);
  });

  it('surfaces a failed database load without claiming the vault is empty', () => {
    const state = embedPickerReducer(opened(), { type: 'databases-failed', message: 'Cannot reach the local Nodus API.' });
    expect(state.databaseStatus).toBe('error');
    expect(pickerDatabasesPlaceholder(state)).toBe('Could not load databases');
    expect(pickerHint(state)).toBe('Cannot reach the local Nodus API.');
    expect(pickerHint(state)).not.toContain('No databases');
  });

  it('clears the previous view when the database changes', () => {
    let state = embedPickerReducer(opened(), { type: 'databases-loaded', databases: [DB_A, DB_B] });
    state = embedPickerReducer(state, { type: 'views-loaded', views: [VIEW_A] });
    expect(pickerCanInsert(state)).toBe(true);
    state = embedPickerReducer(state, { type: 'select-database', databaseId: DB_B.id });
    expect(state.databaseId).toBe(DB_B.id);
    expect(state.views).toEqual([]);
    expect(state.viewId).toBe('');
    expect(pickerCanInsert(state)).toBe(false);
  });

  it('keeps a selected saved view when the same list reloads', () => {
    let state = embedPickerReducer(opened(), { type: 'databases-loaded', databases: [DB_A] });
    state = embedPickerReducer(state, { type: 'views-loaded', views: [VIEW_A, VIEW_B] });
    state = embedPickerReducer(state, { type: 'select-view', viewId: VIEW_B.id });
    state = embedPickerReducer(state, { type: 'views-loaded', views: [VIEW_A, VIEW_B] });
    expect(state.viewId).toBe(VIEW_B.id);
    expect(pickerCanInsert(state)).toBe(true);
  });

  it('resets every selection when the dialog reopens', () => {
    let state = embedPickerReducer(opened(), { type: 'databases-loaded', databases: [DB_A] });
    state = embedPickerReducer(state, { type: 'views-loaded', views: [VIEW_A] });
    state = embedPickerReducer(state, { type: 'reset' });
    expect(state).toEqual(INITIAL_EMBED_PICKER_STATE);
    expect(pickerCanInsert(state)).toBe(false);
  });
});
