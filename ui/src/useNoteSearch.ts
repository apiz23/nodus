import { useEffect, useMemo, useRef, useState } from 'react';
import type { UiSearchResult } from '../../src/ui-server/dto';
import { api } from './api';
import type { NoteFilter, NoteFilterLogic } from '../../src/search/note-filters.js';

interface SearchState { request: object | null; results: UiSearchResult[]; error: string | null; metadataIssueCount: number; catalogIssue?: string }

/** Shared lifecycle for sidebar and palette: debounce, cancellation, retry, and vault isolation. */
export function useNoteSearch(query: string, vaultKey: string, revision = 0, enabled = true, filters: readonly NoteFilter[] = [], logic: NoteFilterLogic = 'and') {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SearchState>({ request: null, results: [], error: null, metadataIssueCount: 0 });
  const value = query.trim();
  const serializedFilters = JSON.stringify(filters);
  const refreshFor = useRef<string | null>(null);
  const contextKey = JSON.stringify([value, vaultKey, revision, serializedFilters, logic]);
  const key = JSON.stringify([value, vaultKey, revision, attempt, enabled, serializedFilters, logic]);
  // A → empty → A must not reuse A's previous response while a new request loads.
  const request = useMemo(() => ({ key }), [key]);
  useEffect(() => {
    if ((!value && filters.length === 0) || !enabled) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const refresh = refreshFor.current === contextKey;
      if (refresh) refreshFor.current = null;
      void api.search(value, controller.signal, refresh, filters, logic).then((response) => {
        if (!cancelled) setState({ request, results: response.results, error: null, metadataIssueCount: response.metadataIssueCount, ...(response.catalogIssue === undefined ? {} : { catalogIssue: response.catalogIssue }) });
      }).catch((cause: unknown) => {
        if (!cancelled) setState({ request, results: [], metadataIssueCount: 0,
          error: cause instanceof Error ? cause.message : 'Search failed. Try again.' });
      });
    }, 180);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [request]);

  // Do not expose previous results even for the render before effect cleanup.
  const visible = enabled && (value !== '' || filters.length > 0);
  const current = state.request === request;
  return {
    results: visible && current ? state.results : [],
    searching: visible && !current,
    error: visible && current ? state.error : null,
    metadataIssueCount: current ? state.metadataIssueCount : 0,
    catalogIssue: current ? state.catalogIssue : undefined,
    retry: () => { refreshFor.current = contextKey; setAttempt((value) => value + 1); },
  };
}
