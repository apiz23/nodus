import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type {
  UiDatabase,
  UiNote,
  UiNoteSummary,
  UiSearchResult,
  UiVaultStatus,
} from '../../src/ui-server/dto';
import { api, ApiError } from './api';
import { CommandPalette } from './CommandPalette';
import { DatabasesView } from './DatabasesView';
import { Editor } from './Editor';
import { DeleteDialog, RenameDialog } from './NoteDialogs';
import { SettingsView } from './SettingsView';
import { Sidebar } from './Sidebar';
import type { SaveState, View } from './types';

type ModalState =
  | { type: 'delete'; note: UiNote }
  | { type: 'rename'; note: UiNote }
  | null;

const THEME_KEY = 'nodus-ui-theme';

function initialTheme(): 'light' | 'dark' {
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'light';
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
  const [searchResults, setSearchResults] = useState<UiSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
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
  const [editorError, setEditorError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pickingVault, setPickingVault] = useState(false);
  const [openingVault, setOpeningVault] = useState(false);
  const [vaultPathDraft, setVaultPathDraft] = useState('');

  const [modal, setModal] = useState<ModalState>(null);
  const [renameValue, setRenameValue] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);

  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.title = status === null ? 'Nodus' : `${status.vault.name} — Nodus`;
    if (status !== null) setVaultPathDraft(status.vault.path);
  }, [status]);

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
    setStatusLoading(true);
    setStatusError(null);
    try {
      setStatus(await api.status());
    } catch (error) {
      setStatusError(messageOf(error));
    } finally {
      setStatusLoading(false);
    }
  }

  async function refreshNotes(quiet = false): Promise<void> {
    if (!quiet) setNotesLoading(true);
    setNotesError(null);
    try {
      const result = await api.notes();
      setNotes(result.notes);
      setSearchRevision((value) => value + 1);
    } catch (error) {
      setNotesError(messageOf(error));
    } finally {
      if (!quiet) setNotesLoading(false);
    }
  }

  async function applyVault(nextStatus: UiVaultStatus): Promise<void> {
    setStatus(nextStatus);
    setVaultPathDraft(nextStatus.vault.path);
    setQuery('');
    setActiveNote(null);
    setSelectedNoteId(null);
    setDraftTitle('');
    setDraftBody('');
    setDraftIcon(null);
    setIconTouched(false);
    setDirty(false);
    setSaveState('idle');
    setEditorError(null);
    setView('notes');
    await Promise.all([refreshNotes(), refreshDatabases()]);
  }

  async function chooseVault(): Promise<void> {
    if (dirty) {
      const proceed = window.confirm('Discard unsaved changes and switch vault?');
      if (!proceed) return;
    }

    setPickingVault(true);
    setStatusError(null);
    try {
      const result = await api.pickVault();
      if (result.canceled) return;
      await applyVault(result.status);
    } catch (error) {
      setStatusError(messageOf(error));
    } finally {
      setPickingVault(false);
    }
  }

  async function openVaultPath(): Promise<void> {
    const nextPath = vaultPathDraft.trim();
    if (nextPath === '') return;
    if (dirty) {
      const proceed = window.confirm('Discard unsaved changes and switch vault?');
      if (!proceed) return;
    }

    setOpeningVault(true);
    setStatusError(null);
    try {
      await applyVault(await api.openVault({ path: nextPath }));
    } catch (error) {
      setStatusError(messageOf(error));
    } finally {
      setOpeningVault(false);
    }
  }

  async function refreshDatabases(): Promise<void> {
    setDatabasesLoading(true);
    setDatabasesError(null);
    try {
      const result = await api.databases();
      setDatabases(result.databases);
    } catch (error) {
      setDatabasesError(messageOf(error));
    } finally {
      setDatabasesLoading(false);
    }
  }

  async function openNoteById(id: string, confirmDiscard = true): Promise<void> {
    if (confirmDiscard && dirty) {
      const proceed = window.confirm('Discard unsaved changes and open another note?');
      if (!proceed) return;
    }

    setSelectedNoteId(id);
    setNoteLoading(true);
    setEditorError(null);
    setSidebarOpen(false);
    try {
      const { note } = await api.note(id);
      setActiveNote(note);
      setDraftTitle(note.title);
      setDraftBody(note.body);
      setDraftIcon(note.icon);
      setIconTouched(false);
      setDirty(false);
      setSaveState('idle');
    } catch (error) {
      setActiveNote(null);
      setEditorError(messageOf(error));
    } finally {
      setNoteLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setNotesLoading(true);
      setDatabasesLoading(true);
      setStatusLoading(true);
      const [statusResult, notesResult, databasesResult] = await Promise.allSettled([
        api.status(),
        api.notes(),
        api.databases(),
      ]);
      if (cancelled) return;

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
        if (first !== undefined) {
          setSelectedNoteId(first.id);
          setNoteLoading(true);
          try {
            const result = await api.note(first.id);
            if (!cancelled) {
              setActiveNote(result.note);
              setDraftTitle(result.note.title);
              setDraftBody(result.note.body);
              setDraftIcon(result.note.icon);
              setIconTouched(false);
              setDirty(false);
              setSaveState('idle');
            }
          } catch (error) {
            if (!cancelled) setEditorError(messageOf(error));
          } finally {
            if (!cancelled) setNoteLoading(false);
          }
        } else {
          setNoteLoading(false);
        }
      } else {
        setNotesError(messageOf(notesResult.reason));
        setNoteLoading(false);
      }
      setNotesLoading(false);

      if (databasesResult.status === 'fulfilled') {
        setDatabases(databasesResult.value.databases);
        setDatabasesError(null);
      } else {
        setDatabasesError(messageOf(databasesResult.reason));
      }
      setDatabasesLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q === '') {
      setSearchResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }

    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    const timer = window.setTimeout(() => {
      api
        .search(q)
        .then((result) => {
          if (!cancelled) setSearchResults(result.results);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setSearchResults([]);
            setSearchError(messageOf(error));
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, searchRevision]);

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
    if (dirty) {
      const proceed = window.confirm('Discard unsaved changes and create a new note?');
      if (!proceed) return;
    }

    setCreating(true);
    setNotesError(null);
    try {
      const { note } = await api.createNote({ title: 'Untitled note' });
      setView('notes');
      setQuery('');
      setSidebarOpen(false);
      await refreshNotes(true);
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
      setCreating(false);
    }
  }

  async function saveNote(): Promise<void> {
    if (activeNote === null || !dirty || saveState === 'saving') return;
    setSaveState('saving');
    setEditorError(null);
    try {
      const { note } = await api.saveNote(activeNote.id, {
        title: draftTitle,
        body: draftBody,
        baseHash: activeNote.contentHash,
        ...(iconTouched ? { icon: draftIcon } : {}),
      });
      setActiveNote(note);
      setDraftTitle(note.title);
      setDraftBody(note.body);
      setDraftIcon(note.icon);
      setIconTouched(false);
      setDirty(false);
      setSaveState('saved');
      await refreshNotes(true);
    } catch (error) {
      setSaveState('error');
      setEditorError(messageOf(error));
    }
  }

  async function reloadNote(): Promise<void> {
    const id = activeNote?.id ?? selectedNoteId;
    if (id === null) return;
    if (dirty) {
      const proceed = window.confirm('Discard unsaved changes and reload from disk?');
      if (!proceed) return;
    }
    setNoteLoading(true);
    setEditorError(null);
    try {
      const { note } = await api.note(id);
      setActiveNote(note);
      setDraftTitle(note.title);
      setDraftBody(note.body);
      setDraftIcon(note.icon);
      setIconTouched(false);
      setDirty(false);
      setSaveState('idle');
    } catch (error) {
      setEditorError(messageOf(error));
    } finally {
      setNoteLoading(false);
    }
  }

  function changePageIcon(icon: string | null): void {
    setDraftIcon(icon);
    setIconTouched(true);
    setDirty(true);
    setSaveState('idle');
  }

  function requestRename(): void {
    if (activeNote === null) return;
    if (dirty) {
      const proceed = window.confirm('Discard unsaved changes and rename this page?');
      if (!proceed) return;
    }
    setRenameValue(activeNote.path);
    setModalError(null);
    setModal({ type: 'rename', note: activeNote });
  }

  async function confirmRename(): Promise<void> {
    if (modal?.type !== 'rename' || modalBusy) return;
    setModalBusy(true);
    setModalError(null);
    try {
      const { note } = await api.moveNote(modal.note.id, {
        path: renameValue,
        baseHash: modal.note.contentHash,
      });
      setActiveNote(note);
      setDraftTitle(note.title);
      setDraftBody(note.body);
      setDraftIcon(note.icon);
      setIconTouched(false);
      setDirty(false);
      setSaveState('saved');
      setModal(null);
      await refreshNotes(true);
    } catch (error) {
      setModalError(messageOf(error));
    } finally {
      setModalBusy(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (modal?.type !== 'delete' || modalBusy) return;
    setModalBusy(true);
    setModalError(null);
    try {
      await api.deleteNote(modal.note.id, { baseHash: modal.note.contentHash });
      setModal(null);
      setActiveNote(null);
      setSelectedNoteId(null);
      setDraftTitle('');
      setDraftBody('');
      setDraftIcon(null);
      setIconTouched(false);
      setDirty(false);
      setSaveState('saved');
      setEditorError(null);
      await Promise.all([refreshNotes(true), refreshStatus()]);
    } catch (error) {
      setModalError(messageOf(error));
    } finally {
      setModalBusy(false);
    }
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
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
  });

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
        focusMode ? 'md:grid-cols-1' : 'md:grid-cols-[240px_minmax(0,1fr)]',
        'md:grid-rows-1',
      )}
    >
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
          onRetry={() => void refreshNotes()}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
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
            <div className="truncate font-mono text-[9.5px] text-muted-foreground">
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
            onToggleFocus={() => setFocusMode((value) => !value)}
            onTitleChange={(value) => {
              setDraftTitle(value);
              setDirty(true);
              setSaveState('idle');
            }}
            onBodyChange={(value) => {
              setDraftBody(value);
              setDirty(true);
              setSaveState('idle');
            }}
            onSave={() => void saveNote()}
            onReload={() => void reloadNote()}
            onRename={requestRename}
            onDelete={() => {
              if (activeNote !== null) {
                setModalError(null);
                setModal({ type: 'delete', note: activeNote });
              }
            }}
            onOpenNote={(id) => void openNoteById(id)}
          />
        ) : null}

        {view === 'databases' ? (
          <DatabasesView
            databases={databases}
            loading={databasesLoading}
            error={databasesError}
            selectedId={selectedDatabaseId}
            onSelect={setSelectedDatabaseId}
            onRetry={() => void refreshDatabases()}
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
          />
        ) : null}
      </main>

      <CommandPalette
        open={commandOpen}
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
