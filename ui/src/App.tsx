import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type {
  UiDatabase,
  UiNote,
  UiNoteSummary,
  UiVaultStatus,
} from '../../src/ui-server/dto';
import { api, ApiError } from './api';
import { CommandPalette } from './CommandPalette';
import { DatabasesView } from './DatabasesView';
import { Editor } from './Editor';
import { DiscoveryView } from './DiscoveryView';
import { GraphView } from './GraphView';
import { DeleteDialog, RenameDialog } from './NoteDialogs';
import { SettingsView } from './SettingsView';
import { Sidebar } from './Sidebar';
import { useNoteSearch } from './useNoteSearch';
import { scheduleAutosave } from './scheduleAutosave';
import { saveResultDisposition } from './saveResultDisposition';
import type { SaveState, View } from './types';

type ModalState =
  | { type: 'delete'; note: UiNote }
  | { type: 'rename'; note: UiNote }
  | null;

const THEME_KEY = 'nodus-ui-theme';
const EDITOR_WIDTH_KEY = 'nodus-editor-width';

function initialTheme(): 'light' | 'dark' {
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'light';
}

function initialFullWidth(): boolean {
  try {
    return window.localStorage.getItem(EDITOR_WIDTH_KEY) === 'full';
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong while talking to the local vault.';
}

export default function App() {
  const [view, setView] = useState<View>('notes');
  const [status, setStatus] = useState<UiVaultStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [notes, setNotes] = useState<UiNoteSummary[]>([]);
  const [notesLoading, setNotesLoading] = useState(true);
  const [notesError, setNotesError] = useState<string | null>(null);

  const [databases, setDatabases] = useState<UiDatabase[]>([]);
  const [databasesLoading, setDatabasesLoading] = useState(true);
  const [databasesError, setDatabasesError] = useState<string | null>(null);
  const [selectedDatabaseId, setSelectedDatabaseId] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [searchRevision, setSearchRevision] = useState(0);

  const [activeNote, setActiveNote] = useState<UiNote | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [noteLoading, setNoteLoading] = useState(true);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftIcon, setDraftIcon] = useState<string | null>(null);
  const [iconTouched, setIconTouched] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveCompletion, setSaveCompletion] = useState(0);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pickingVault, setPickingVault] = useState(false);
  const [openingVault, setOpeningVault] = useState(false);
  const [vaultPathDraft, setVaultPathDraft] = useState('');

  const [modal, setModal] = useState<ModalState>(null);
  const [backlinksRevision, setBacklinksRevision] = useState(0);
  const [renameValue, setRenameValue] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);

  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [editorFullWidth, setEditorFullWidth] = useState(initialFullWidth);
  const [vaultSwitching, setVaultSwitching] = useState(false);
  const [vaultWorkInFlight, setVaultWorkInFlight] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const activeNoteRef = useRef(activeNote);
  const draftRevisionRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const noteRequestRef = useRef(0);
  const vaultRequestRef = useRef(0);
  const createInFlightRef = useRef(false);
  const noteMutationInFlightRef = useRef(false);
  const dirtyRef = useRef(dirty);
  activeNoteRef.current = activeNote;
  dirtyRef.current = dirty;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(EDITOR_WIDTH_KEY, editorFullWidth ? 'full' : 'comfortable');
    } catch {
      // Storage may be unavailable; keep the preference for this app session.
    }
  }, [editorFullWidth]);

  useEffect(() => {
    document.title = status === null ? 'Nodus' : `${status.vault.name} — Nodus`;
    if (status !== null) setVaultPathDraft(status.vault.path);
  }, [status]);

  useEffect(() => {
    if (vaultWorkInFlight) setCommandOpen(false);
  }, [vaultWorkInFlight]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  async function refreshStatus(): Promise<void> {
    const request = vaultRequestRef.current;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const next = await api.status();
      if (request === vaultRequestRef.current) setStatus(next);
    } catch (error) {
      if (request === vaultRequestRef.current) setStatusError(messageOf(error));
    } finally {
      if (request === vaultRequestRef.current) setStatusLoading(false);
    }
  }

  async function refreshNotes(quiet = false): Promise<void> {
    const request = vaultRequestRef.current;
    if (!quiet) setNotesLoading(true);
    setNotesError(null);
    try {
      const result = await api.notes();
      if (request === vaultRequestRef.current) {
        setNotes(result.notes);
        setSearchRevision((value) => value + 1);
      }
    } catch (error) {
      if (request === vaultRequestRef.current) setNotesError(messageOf(error));
    } finally {
      if (!quiet && request === vaultRequestRef.current) setNotesLoading(false);
    }
  }

  async function applyVault(nextStatus: UiVaultStatus): Promise<void> {
    vaultRequestRef.current += 1;
    noteRequestRef.current += 1;
    draftRevisionRef.current += 1;
    setStatus(nextStatus);
    setVaultPathDraft(nextStatus.vault.path);
    setQuery('');
    setActiveNote(null);
    setSelectedNoteId(null);
    setNoteLoading(false);
    setDraftTitle('');
    setDraftBody('');
    setDraftIcon(null);
    setIconTouched(false);
    setDirty(false);
    setSaveState('idle');
    setEditorError(null);
    setModal(null);
    setModalError(null);
    setCommandOpen(false);
    setView('notes');
    setSidebarOpen(false);
    await Promise.all([refreshNotes(), refreshDatabases()]);
  }

  function beginVaultSwitch(): boolean {
    if (
      saveInFlightRef.current ||
      createInFlightRef.current ||
      noteMutationInFlightRef.current ||
      modal !== null ||
      vaultWorkInFlight
    ) {
      setStatusError('Wait for current vault work to finish before switching vaults.');
      return false;
    }
    if (dirtyRef.current && !window.confirm('Discard unsaved changes and switch vault?')) return false;
    vaultRequestRef.current += 1;
    noteRequestRef.current += 1;
    setNoteLoading(false);
    setCommandOpen(false);
    setVaultSwitching(true);
    return true;
  }

  async function refreshCurrentVaultAfterCanceledSwitch(refreshVaultStatus = true): Promise<void> {
    const shouldReloadSelected = activeNoteRef.current === null && selectedNoteId !== null;
    await Promise.all([
      ...(refreshVaultStatus ? [refreshStatus()] : []),
      refreshNotes(),
      refreshDatabases(),
    ]);
    if (shouldReloadSelected && selectedNoteId !== null) {
      await openNoteById(selectedNoteId, false);
    }
  }

  async function chooseVault(): Promise<void> {
    if (vaultSwitching || !beginVaultSwitch()) return;

    setPickingVault(true);
    setStatusError(null);
    try {
      const result = await api.pickVault();
      if (result.canceled) {
        await refreshCurrentVaultAfterCanceledSwitch();
        return;
      }
      await applyVault(result.status);
    } catch (error) {
      setStatusError(messageOf(error));
      await refreshCurrentVaultAfterCanceledSwitch(false);
    } finally {
      setPickingVault(false);
      setVaultSwitching(false);
    }
  }

  async function openVaultPath(): Promise<void> {
    const nextPath = vaultPathDraft.trim();
    if (nextPath === '' || vaultSwitching || !beginVaultSwitch()) return;

    setOpeningVault(true);
    setStatusError(null);
    try {
      await applyVault(await api.openVault({ path: nextPath }));
    } catch (error) {
      setStatusError(messageOf(error));
      await refreshCurrentVaultAfterCanceledSwitch(false);
    } finally {
      setOpeningVault(false);
      setVaultSwitching(false);
    }
  }

  async function refreshDatabases(): Promise<void> {
    const request = vaultRequestRef.current;
    setDatabasesLoading(true);
    setDatabasesError(null);
    try {
      const result = await api.databases();
      if (request === vaultRequestRef.current) setDatabases(result.databases);
    } catch (error) {
      if (request === vaultRequestRef.current) setDatabasesError(messageOf(error));
    } finally {
      if (request === vaultRequestRef.current) setDatabasesLoading(false);
    }
  }

  async function openNoteById(id: string, confirmDiscard = true): Promise<void> {
    if (confirmDiscard && dirty) {
      const proceed = window.confirm('Discard unsaved changes and open another note?');
      if (!proceed) return;
    }

    const request = ++noteRequestRef.current;
    draftRevisionRef.current += 1;
    setView('notes');
    setSelectedNoteId(id);
    setNoteLoading(true);
    setEditorError(null);
    setSidebarOpen(false);
    try {
      const { note } = await api.note(id);
      if (request !== noteRequestRef.current) return;
      setActiveNote(note);
      setDraftTitle(note.title);
      setDraftBody(note.body);
      setDraftIcon(note.icon);
      setIconTouched(false);
      setDirty(false);
      setSaveState('idle');
    } catch (error) {
      if (request !== noteRequestRef.current) return;
      setActiveNote(null);
      setEditorError(messageOf(error));
    } finally {
      if (request === noteRequestRef.current) setNoteLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const vaultRequest = vaultRequestRef.current;
    const request = ++noteRequestRef.current;
    async function load() {
      setNotesLoading(true);
      setDatabasesLoading(true);
      setStatusLoading(true);
      const [statusResult, notesResult, databasesResult] = await Promise.allSettled([
        api.status(),
        api.notes(),
        api.databases(),
      ]);
      if (cancelled || vaultRequest !== vaultRequestRef.current) return;

      if (statusResult.status === 'fulfilled') {
        setStatus(statusResult.value);
        setStatusError(null);
      } else {
        setStatusError(messageOf(statusResult.reason));
      }
      setStatusLoading(false);

      if (notesResult.status === 'fulfilled') {
        setNotes(notesResult.value.notes);
        setNotesError(null);
        const first = notesResult.value.notes[0];
        if (first !== undefined && request === noteRequestRef.current) {
          setSelectedNoteId(first.id);
          setNoteLoading(true);
          try {
            const result = await api.note(first.id);
            if (!cancelled && vaultRequest === vaultRequestRef.current && request === noteRequestRef.current) {
              setActiveNote(result.note);
              setDraftTitle(result.note.title);
              setDraftBody(result.note.body);
              setDraftIcon(result.note.icon);
              setIconTouched(false);
              setDirty(false);
              setSaveState('idle');
            }
          } catch (error) {
            if (!cancelled && vaultRequest === vaultRequestRef.current && request === noteRequestRef.current) {
              setEditorError(messageOf(error));
            }
          } finally {
            if (!cancelled && vaultRequest === vaultRequestRef.current && request === noteRequestRef.current) {
              setNoteLoading(false);
            }
          }
        } else if (request === noteRequestRef.current) {
          setNoteLoading(false);
        }
      } else {
        setNotesError(messageOf(notesResult.reason));
        if (request === noteRequestRef.current) setNoteLoading(false);
      }
      if (vaultRequest === vaultRequestRef.current) setNotesLoading(false);

      if (vaultRequest === vaultRequestRef.current) {
        if (databasesResult.status === 'fulfilled') {
          setDatabases(databasesResult.value.databases);
          setDatabasesError(null);
        } else {
          setDatabasesError(messageOf(databasesResult.reason));
        }
      }
      if (vaultRequest === vaultRequestRef.current) setDatabasesLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const { results: searchResults, searching, error: searchError, retry: retrySearch } = useNoteSearch(
    query, status?.vault.path ?? '', searchRevision, status !== null && !vaultSwitching && !vaultWorkInFlight,
  );

  useEffect(() => {
    if (databases.length === 0) {
      setSelectedDatabaseId(null);
      return;
    }
    if (
      selectedDatabaseId === null ||
      !databases.some((database) => database.id === selectedDatabaseId)
    ) {
      setSelectedDatabaseId(databases[0]?.id ?? null);
    }
  }, [databases, selectedDatabaseId]);

  async function createNote(): Promise<void> {
    if (vaultSwitching || createInFlightRef.current) return;
    if (dirty) {
      const proceed = window.confirm('Discard unsaved changes and create a new note?');
      if (!proceed) return;
    }

    const request = ++noteRequestRef.current;
    draftRevisionRef.current += 1;
    createInFlightRef.current = true;
    setCreating(true);
    setNotesError(null);
    try {
      const { note } = await api.createNote({ title: 'Untitled note' });
      setView('notes');
      setQuery('');
      setSidebarOpen(false);
      await refreshNotes(true);
      if (request !== noteRequestRef.current) return;
      setSelectedNoteId(note.id);
      setActiveNote(note);
      setDraftTitle(note.title);
      setDraftBody(note.body);
      setDraftIcon(note.icon);
      setIconTouched(false);
      setDirty(false);
      setSaveState('saved');
      setEditorError(null);
    } catch (error) {
      setNotesError(messageOf(error));
    } finally {
      createInFlightRef.current = false;
      setCreating(false);
    }
  }

  async function saveNote(): Promise<void> {
    if (vaultSwitching || activeNote === null || noteLoading || !dirty || saveState === 'saving' || saveInFlightRef.current) return;
    const savedNoteId = activeNote.id;
    const savedRequest = noteRequestRef.current;
    const savedRevision = draftRevisionRef.current;
    saveInFlightRef.current = true;
    setSaveState('saving');
    setEditorError(null);
    try {
      const { note } = await api.saveNote(activeNote.id, {
        title: draftTitle,
        body: draftBody,
        baseHash: activeNote.contentHash,
        ...(iconTouched ? { icon: draftIcon } : {}),
      });
      if (savedRequest !== noteRequestRef.current) return;
      const disposition = saveResultDisposition(
        savedNoteId,
        activeNoteRef.current?.id ?? null,
        savedRevision,
        draftRevisionRef.current,
      );
      if (disposition === 'ignore') return;
      setActiveNote(note);
      if (disposition === 'replace-draft') {
        setDraftTitle(note.title);
        setDraftBody(note.body);
        setDraftIcon(note.icon);
        setIconTouched(false);
        setDirty(false);
        setSaveState('saved');
      } else {
        // The request saved its snapshot; edits made while it was pending stay
        // in the draft and can be saved against the returned content hash.
        setDirty(true);
        setSaveState('idle');
      }
      await refreshNotes(true);
      setBacklinksRevision((value) => value + 1);
    } catch (error) {
      if (savedRequest !== noteRequestRef.current || activeNoteRef.current?.id !== savedNoteId) return;
      setSaveState('error');
      setEditorError(messageOf(error));
    } finally {
      saveInFlightRef.current = false;
      // A timer for a newer note may have fired while this request was pending.
      // Wake the effect even when this response no longer belongs to the editor.
      setSaveCompletion((value) => value + 1);
    }
  }

  useEffect(() => {
    if (!dirty || noteLoading || activeNote === null || saveState !== 'idle') return undefined;
    return scheduleAutosave(() => void saveNote());
  }, [activeNote, dirty, draftBody, draftIcon, draftTitle, iconTouched, noteLoading, saveCompletion, saveState]);

  async function reloadNote(): Promise<void> {
    const id = activeNote?.id ?? selectedNoteId;
    if (id === null) return;
    if (dirty) {
      const proceed = window.confirm('Discard unsaved changes and reload from disk?');
      if (!proceed) return;
    }
    const request = ++noteRequestRef.current;
    draftRevisionRef.current += 1;
    setNoteLoading(true);
    setEditorError(null);
    try {
      const { note } = await api.note(id);
      if (request !== noteRequestRef.current) return;
      setActiveNote(note);
      setDraftTitle(note.title);
      setDraftBody(note.body);
      setDraftIcon(note.icon);
      setIconTouched(false);
      setDirty(false);
      setSaveState('idle');
      setBacklinksRevision((value) => value + 1);
    } catch (error) {
      if (request !== noteRequestRef.current) return;
      setEditorError(messageOf(error));
    } finally {
      if (request === noteRequestRef.current) setNoteLoading(false);
    }
  }

  function changePageIcon(icon: string | null): void {
    if (vaultSwitching) return;
    draftRevisionRef.current += 1;
    setDraftIcon(icon);
    setIconTouched(true);
    setDirty(true);
    setSaveState('idle');
  }

  async function requestRenameForNote(noteId: string): Promise<void> {
    if (vaultSwitching || noteMutationInFlightRef.current) return;
    const current = activeNoteRef.current?.id === noteId ? activeNoteRef.current : null;
    if (current !== null && dirtyRef.current && !window.confirm('Discard unsaved changes and rename this page?')) return;

    const vaultRequest = vaultRequestRef.current;
    noteMutationInFlightRef.current = true;
    try {
      const target = current ?? (await api.note(noteId)).note;
      if (vaultRequest !== vaultRequestRef.current) return;
      setRenameValue(target.path);
      setModalError(null);
      setModal({ type: 'rename', note: target });
    } catch (error) {
      if (vaultRequest === vaultRequestRef.current) setNotesError(messageOf(error));
    } finally {
      noteMutationInFlightRef.current = false;
    }
  }

  function requestRename(): void {
    if (activeNote !== null) void requestRenameForNote(activeNote.id);
  }

  async function requestDeleteForNote(noteId: string): Promise<void> {
    if (vaultSwitching || noteMutationInFlightRef.current) return;
    const current = activeNoteRef.current?.id === noteId ? activeNoteRef.current : null;
    if (current !== null && dirtyRef.current && !window.confirm('Discard unsaved changes and delete this page?')) return;

    const vaultRequest = vaultRequestRef.current;
    noteMutationInFlightRef.current = true;
    try {
      const target = current ?? (await api.note(noteId)).note;
      if (vaultRequest !== vaultRequestRef.current) return;
      setModalError(null);
      setModal({ type: 'delete', note: target });
    } catch (error) {
      if (vaultRequest === vaultRequestRef.current) setNotesError(messageOf(error));
    } finally {
      noteMutationInFlightRef.current = false;
    }
  }

  async function confirmRename(): Promise<void> {
    if (vaultSwitching || modal?.type !== 'rename' || modalBusy || noteMutationInFlightRef.current) return;
    noteMutationInFlightRef.current = true;
    setModalBusy(true);
    setModalError(null);
    try {
      const { note } = await api.moveNote(modal.note.id, {
        path: renameValue,
        baseHash: modal.note.contentHash,
      });
      if (activeNoteRef.current?.id === note.id) {
        setActiveNote(note);
        setDraftTitle(note.title);
        setDraftBody(note.body);
        setDraftIcon(note.icon);
        setIconTouched(false);
        setDirty(false);
        setSaveState('saved');
      }
      setModal(null);
      await refreshNotes(true);
      setBacklinksRevision((value) => value + 1);
    } catch (error) {
      setModalError(messageOf(error));
    } finally {
      noteMutationInFlightRef.current = false;
      setModalBusy(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (vaultSwitching || modal?.type !== 'delete' || modalBusy || noteMutationInFlightRef.current) return;
    noteMutationInFlightRef.current = true;
    setModalBusy(true);
    setModalError(null);
    try {
      await api.deleteNote(modal.note.id, { baseHash: modal.note.contentHash });
      setModal(null);
      if (activeNoteRef.current?.id === modal.note.id || selectedNoteId === modal.note.id) {
        setActiveNote(null);
        setSelectedNoteId(null);
        setDraftTitle('');
        setDraftBody('');
        setDraftIcon(null);
        setIconTouched(false);
        setDirty(false);
        setSaveState('saved');
        setEditorError(null);
      }
      await Promise.all([refreshNotes(true), refreshStatus()]);
      setBacklinksRevision((value) => value + 1);
    } catch (error) {
      setModalError(messageOf(error));
    } finally {
      noteMutationInFlightRef.current = false;
      setModalBusy(false);
    }
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (vaultSwitching || vaultWorkInFlight) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (!modifier) return;
      if (modal !== null) return;
      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        if (!commandOpen && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        setCommandOpen((open) => !open);
        return;
      }
      if (commandOpen) return;
      if (key === 'n') {
        event.preventDefault();
        void createNote();
        return;
      }
      if (key === 's') {
        event.preventDefault();
        void saveNote();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [vaultSwitching, vaultWorkInFlight, modal, commandOpen]);

  if (status === null && statusError !== null) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 grid size-10 place-items-center rounded-lg bg-primary text-base font-semibold text-primary-foreground">
          N
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Cannot open the local vault</h1>
        <p className="mt-2 max-w-[52ch] text-sm text-muted-foreground">{statusError}</p>
        <pre className="mt-4 max-w-full overflow-auto rounded-md border bg-muted/40 px-3 py-2 text-left font-mono text-[11px]">
          NODUS_VAULT=C:\path\to\your\vault pnpm dev
        </pre>
        <Button type="button" className="mt-5" onClick={() => void refreshStatus()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex h-dvh flex-col overflow-hidden bg-background text-foreground md:grid',
        focusMode
          ? 'md:grid-cols-1'
          : sidebarCollapsed
            ? 'md:grid-cols-[64px_minmax(0,1fr)]'
            : 'md:grid-cols-[240px_minmax(0,1fr)]',
        'md:grid-rows-1',
      )}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring/80"
      >
        Skip to content
      </a>
      {focusMode ? null : (
        <Sidebar
          view={view}
          onView={(next) => {
            setView(next);
          }}
          query={query}
          onQueryChange={setQuery}
          searchRef={searchRef}
          onCreate={() => void createNote()}
          creating={creating}
          status={status}
          theme={theme}
          onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          notes={notes}
          results={searchResults}
          selectedId={selectedNoteId}
          loading={notesLoading}
          searching={searching}
          searchError={query.trim() === '' ? notesError : searchError}
          onOpen={(id) => void openNoteById(id)}
          onClearSearch={() => setQuery('')}
          onRetry={() => { if (query.trim()) retrySearch(); else void refreshNotes(); }}
          onRenameNote={(id) => void requestRenameForNote(id)}
          onDeleteNote={(id) => void requestDeleteForNote(id)}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          collapsed={sidebarCollapsed}
          onExpandForSearch={() => {
            setSidebarCollapsed(false);
            window.setTimeout(() => searchRef.current?.focus(), 0);
          }}
          onOpenAnotherVault={() => void chooseVault()}
          switchingVault={vaultSwitching || pickingVault || openingVault}
          navigationLocked={vaultSwitching || pickingVault || openingVault || vaultWorkInFlight}
        />
      )}

      <main
        id="main-content"
        tabIndex={-1}
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-background outline-none"
        inert={vaultSwitching || vaultWorkInFlight || sidebarOpen || undefined}
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3 md:hidden">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Open navigation"
            onClick={() => {
              setFocusMode(false);
              setSidebarOpen(true);
            }}
          >
            <Menu />
          </Button>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold">{activeNote?.title ?? status?.vault.name ?? 'Nodus'}</div>
            <div className="truncate font-mono text-[11px] text-muted-foreground">
              {activeNote?.path ?? 'Local workspace'}
            </div>
          </div>
        </div>

        {statusError !== null ? (
          <div className="flex items-center justify-between gap-3 border-b border-destructive/20 bg-destructive/5 px-4 py-1.5 text-xs text-destructive">
            <span className="flex min-w-0 items-center gap-2">
              <AlertCircle className="size-3.5 shrink-0" />
              <span className="truncate">{statusError}</span>
            </span>
            <Button
              type="button"
              variant="link"
              size="xs"
              className="h-auto shrink-0 p-0 text-xs text-destructive"
              onClick={() => void refreshStatus()}
            >
              Refresh status
            </Button>
          </div>
        ) : null}

        {view === 'notes' ? (
          <Editor
            note={activeNote}
            notes={notes}
            icon={draftIcon}
            onIconChange={changePageIcon}
            loading={noteLoading}
            title={draftTitle}
            body={draftBody}
            dirty={dirty}
            saveState={saveState}
            error={editorError}
            focusMode={focusMode}
            fullWidth={editorFullWidth}
            onToggleWidth={() => setEditorFullWidth((value) => !value)}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
            onToggleFocus={() => setFocusMode((value) => !value)}
            onTitleChange={(value) => {
              draftRevisionRef.current += 1;
              setDraftTitle(value);
              setDirty(true);
              setSaveState('idle');
            }}
            onBodyChange={(value) => {
              draftRevisionRef.current += 1;
              setDraftBody(value);
              setDirty(true);
              setSaveState('idle');
            }}
            onSave={() => void saveNote()}
            onReload={() => void reloadNote()}
            onRename={requestRename}
            onDelete={() => {
              if (activeNote !== null) void requestDeleteForNote(activeNote.id);
            }}
            onOpenNote={(id) => void openNoteById(id)}
            backlinksRevision={backlinksRevision}
          />
        ) : null}

        {view === 'discovery' ? (
          <DiscoveryView
            key={status?.vault.path ?? 'vault-loading'}
            revision={backlinksRevision}
            onOpenNote={(id) => void openNoteById(id)}
            onCreated={async () => { await Promise.all([refreshNotes(true), refreshStatus()]); setBacklinksRevision((value) => value + 1); }}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
          />
        ) : null}

        {view === 'graph' ? (
          <GraphView
            key={status?.vault.path ?? 'vault-loading'}
            revision={backlinksRevision}
            initialNoteId={selectedNoteId}
            onOpenNote={(id) => void openNoteById(id)}
          />
        ) : null}

        {view === 'databases' ? (
          <DatabasesView
            key={status?.vault.path ?? 'vault-loading'}
            vaultKey={status?.vault.path}
            onNoteCreated={(note) => {
              setNotes((current) => [...current.filter((item) => item.id !== note.id), note]);
              setSearchRevision((value) => value + 1);
            }}
            databases={databases}
            notes={notes}
            loading={databasesLoading}
            error={databasesError}
            selectedId={selectedDatabaseId}
            onSelect={setSelectedDatabaseId}
            onRetry={() => void refreshDatabases()}
            onDatabaseSaved={(database, created, selectCreated) => {
              setDatabases((current) => created
                ? [...current, database].sort((left, right) => left.name.localeCompare(right.name))
                : current.map((item) => item.id === database.id ? database : item));
              if (created && selectCreated) setSelectedDatabaseId(database.id);
            }}
            onOpenNote={(id) => void openNoteById(id)}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
          />
        ) : null}

        {view === 'settings' ? (
          <SettingsView
            status={status}
            loading={statusLoading}
            error={statusError}
            onRefresh={() => void refreshStatus()}
            onPickVault={() => void chooseVault()}
            picking={pickingVault}
            vaultPathDraft={vaultPathDraft}
            onVaultPathDraftChange={setVaultPathDraft}
            onOpenVault={() => void openVaultPath()}
            openingVault={openingVault}
            theme={theme}
            onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            onRestored={() => {
              setBacklinksRevision((value) => value + 1);
              void Promise.all([refreshNotes(true), refreshDatabases(), refreshStatus()]);
            }}
            onVaultWorkChange={setVaultWorkInFlight}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
          />
        ) : null}
      </main>

      <CommandPalette
        key={status?.vault.path ?? 'vault-loading'}
        vaultKey={status?.vault.path ?? ''}
        revision={searchRevision}
        open={commandOpen && !vaultSwitching && !vaultWorkInFlight}
        onOpenChange={setCommandOpen}
        onCreateNote={() => void createNote()}
        onOpenNote={(id) => void openNoteById(id)}
        onView={(next) => {
          setView(next);
          if (next === 'notes') setQuery('');
        }}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      />

      <RenameDialog
        open={modal?.type === 'rename'}
        value={renameValue}
        error={modalError}
        busy={modalBusy}
        onChange={setRenameValue}
        onCancel={() => {
          setModal(null);
          setModalError(null);
        }}
        onConfirm={() => void confirmRename()}
      />

      <DeleteDialog
        open={modal?.type === 'delete'}
        title={modal?.type === 'delete' ? modal.note.title : ''}
        path={modal?.type === 'delete' ? modal.note.path : ''}
        error={modalError}
        busy={modalBusy}
        onCancel={() => {
          setModal(null);
          setModalError(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
