import { useEffect, useMemo, useRef, useState } from 'react';
import type { UiSearchResult } from '../../src/ui-server/dto';
import { api } from './api';

interface SearchState { request: object | null; results: UiSearchResult[]; error: string | null }

/** Shared lifecycle for sidebar and palette: debounce, cancellation, retry, and vault isolation. */
export function useNoteSearch(query: string, vaultKey: string, revision = 0, enabled = true) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SearchState>({ request: null, results: [], error: null });
  const value = query.trim();
  const refreshFor = useRef<string | null>(null);
  const contextKey = JSON.stringify([value, vaultKey, revision]);
  const key = JSON.stringify([value, vaultKey, revision, attempt, enabled]);
  // A → empty → A must not reuse A's previous response while a new request loads.
  const request = useMemo(() => ({ key }), [key]);
  useEffect(() => {
    if (!value || !enabled) return;
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const refresh = refreshFor.current === contextKey;
      if (refresh) refreshFor.current = null;
      void api.search(value, controller.signal, refresh).then((response) => {
        if (!cancelled) setState({ request, results: response.results, error: null });
      }).catch((cause: unknown) => {
        if (!cancelled) setState({ request, results: [],
          error: cause instanceof Error ? cause.message : 'Search failed. Try again.' });
      });
    }, 180);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [request]);

  // Do not expose previous results even for the render before effect cleanup.
  const visible = enabled && value !== '';
  const current = state.request === request;
  return {
    results: visible && current ? state.results : [],
    searching: visible && !current,
    error: visible && current ? state.error : null,
    retry: () => { refreshFor.current = contextKey; setAttempt((value) => value + 1); },
  };
}
