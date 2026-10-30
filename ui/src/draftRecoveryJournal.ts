export interface DraftRecoveryEntry {
  vaultIdentity: string;
  noteId: string;
  writerId: string;
  revision: number;
  title: string;
  body: string;
  icon: string | null;
  iconTouched: boolean;
  baseHash: string;
  updatedAt: string;
}

interface StoredDraft extends DraftRecoveryEntry { key: string }
interface Watermark { key: string; savedRevision: number }
interface DeletedNote { key: string; deleted: true }
type IndexedKey = string | number | readonly (string | number)[];
interface IndexedRequest<T> {
  result: T;
  error: Error | null;
  onsuccess: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}
interface IndexedStore {
  index(name: string): { getAll(key: IndexedKey): IndexedRequest<unknown> };
  get(key: IndexedKey): IndexedRequest<unknown>;
  getAll(key?: IndexedKey): IndexedRequest<unknown>;
  put(value: unknown): unknown;
  delete(key: IndexedKey): unknown;
  createIndex(name: string, keyPath: string | readonly string[], options: { unique: boolean }): unknown;
}
interface IndexedTransaction {
  objectStore(name: string): IndexedStore;
  oncomplete: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onabort: ((event: unknown) => void) | null;
  error: Error | null;
}
interface IndexedDatabase {
  transaction(stores: string | readonly string[], mode: 'readonly' | 'readwrite'): IndexedTransaction;
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, options: { keyPath: string }): IndexedStore;
  close(): void;
}
interface IndexedOpenRequest extends IndexedRequest<IndexedDatabase> {
  onupgradeneeded: ((event: unknown) => void) | null;
  onblocked: ((event: unknown) => void) | null;
}
interface IndexedFactory { open(name: string, version: number): IndexedOpenRequest }

const DATABASE = 'nodus-draft-recovery';
const DATABASE_VERSION = 1;
const DRAFTS = 'drafts';
const WATERMARKS = 'watermarks';
const DELETED_NOTES = 'deleted-notes';

/** Guard used inside the IndexedDB transaction to reject delayed stale writes. */
export function canWriteDraftRevision(revision: number, savedThrough: number, currentRevision: number): boolean {
  return revision > savedThrough && revision >= currentRevision;
}

export interface DraftJournal {
  list(vaultIdentity: string, noteId: string): Promise<DraftRecoveryEntry[]>;
  pruneMissing(vaultIdentity: string, noteIds: ReadonlySet<string>): Promise<void>;
  allowNote(vaultIdentity: string, noteId: string): Promise<void>;
  write(entry: DraftRecoveryEntry): Promise<void>;
  adopt(previous: DraftRecoveryEntry, next: DraftRecoveryEntry): Promise<void>;
  clearThrough(vaultIdentity: string, noteId: string, writerId: string, revision: number): Promise<void>;
  deleteNote(vaultIdentity: string, noteId: string): Promise<void>;
}

/** Browser-local recovery only; Markdown files remain authoritative. */
export class IndexedDbDraftJournal implements DraftJournal {
  private database: Promise<IndexedDatabase> | null = null;

  constructor(private readonly factory?: IndexedFactory) {}

  async list(vaultIdentity: string, noteId: string): Promise<DraftRecoveryEntry[]> {
    const db = await this.open();
    const tx = db.transaction(DRAFTS, 'readonly');
    const request = tx.objectStore(DRAFTS).index('vaultNote').getAll([vaultIdentity, noteId]) as IndexedRequest<StoredDraft[]>;
    const drafts = await requestResult(request);
    await transactionDone(tx);
    return drafts.filter(isValidDraft).map(stripKey).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async pruneMissing(vaultIdentity: string, noteIds: ReadonlySet<string>): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([DRAFTS, WATERMARKS, DELETED_NOTES], 'readwrite');
    const drafts = tx.objectStore(DRAFTS);
    const entries = await requestResult(drafts.index('vaultIdentity').getAll(vaultIdentity) as IndexedRequest<StoredDraft[]>);
    const watermarks = tx.objectStore(WATERMARKS);
    const deleted = tx.objectStore(DELETED_NOTES);
    const removedIds = new Set<string>();
    for (const entry of entries) {
      if (noteIds.has(entry.noteId)) continue;
      drafts.delete(entry.key);
      watermarks.put({ key: entry.key, savedRevision: Number.MAX_SAFE_INTEGER } satisfies Watermark);
      removedIds.add(entry.noteId);
    }
    for (const noteId of removedIds) deleted.put({ key: deletedNoteKey(vaultIdentity, noteId), deleted: true } satisfies DeletedNote);
    await transactionDone(tx);
  }

  async allowNote(vaultIdentity: string, noteId: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(DELETED_NOTES, 'readwrite');
    tx.objectStore(DELETED_NOTES).delete(deletedNoteKey(vaultIdentity, noteId));
    await transactionDone(tx);
  }

  async write(entry: DraftRecoveryEntry): Promise<void> {
    if (!isValidDraft(entry)) throw new Error('Invalid recovery draft.');
    const db = await this.open();
    const tx = db.transaction([DRAFTS, WATERMARKS, DELETED_NOTES], 'readwrite');
    const drafts = tx.objectStore(DRAFTS);
    const watermarks = tx.objectStore(WATERMARKS);
    const deleted = tx.objectStore(DELETED_NOTES);
    const key = draftKey(entry);
    const deletedKey = deletedNoteKey(entry.vaultIdentity, entry.noteId);
    const [deletedMarker, watermark, current] = await Promise.all([
      requestResult(deleted.get(deletedKey) as IndexedRequest<DeletedNote | undefined>),
      requestResult(watermarks.get(key) as IndexedRequest<Watermark | undefined>),
      requestResult(drafts.get(key) as IndexedRequest<StoredDraft | undefined>),
    ]);
    if (!deletedMarker && canWriteDraftRevision(entry.revision, watermark?.savedRevision ?? -1, current?.revision ?? -1)) {
      drafts.put({ ...entry, key } satisfies StoredDraft);
    }
    await transactionDone(tx);
  }

  /** Atomically re-keys a recovered draft to this app session and retires its old journal row. */
  async adopt(previous: DraftRecoveryEntry, next: DraftRecoveryEntry): Promise<void> {
    if (!isValidDraft(previous) || !isValidDraft(next) || previous.vaultIdentity !== next.vaultIdentity || previous.noteId !== next.noteId) {
      throw new Error('Invalid recovery draft transition.');
    }
    const db = await this.open();
    const tx = db.transaction([DRAFTS, WATERMARKS, DELETED_NOTES], 'readwrite');
    const drafts = tx.objectStore(DRAFTS);
    const watermarks = tx.objectStore(WATERMARKS);
    const deleted = tx.objectStore(DELETED_NOTES);
    const oldKey = draftKey(previous);
    const newKey = draftKey(next);
    const [deletedMarker, nextWatermark] = await Promise.all([
      requestResult(deleted.get(deletedNoteKey(next.vaultIdentity, next.noteId)) as IndexedRequest<DeletedNote | undefined>),
      requestResult(watermarks.get(newKey) as IndexedRequest<Watermark | undefined>),
    ]);
    if (!deletedMarker && next.revision > (nextWatermark?.savedRevision ?? -1)) drafts.put({ ...next, key: newKey } satisfies StoredDraft);
    if (oldKey !== newKey || previous.revision < next.revision) {
      const oldWatermark = await requestResult(watermarks.get(oldKey) as IndexedRequest<Watermark | undefined>);
      watermarks.put({ key: oldKey, savedRevision: Math.max(oldWatermark?.savedRevision ?? -1, previous.revision) } satisfies Watermark);
      const oldDraft = await requestResult(drafts.get(oldKey) as IndexedRequest<StoredDraft | undefined>);
      if (oldDraft && oldDraft.revision <= previous.revision) drafts.delete(oldKey);
    }
    await transactionDone(tx);
  }

  async clearThrough(vaultIdentity: string, noteId: string, writerId: string, revision: number): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([DRAFTS, WATERMARKS], 'readwrite');
    const key = draftKey({ vaultIdentity, noteId, writerId });
    const watermarks = tx.objectStore(WATERMARKS);
    const current = await requestResult(watermarks.get(key) as IndexedRequest<Watermark | undefined>);
    watermarks.put({ key, savedRevision: Math.max(current?.savedRevision ?? -1, revision) } satisfies Watermark);
    const drafts = tx.objectStore(DRAFTS);
    const entry = await requestResult(drafts.get(key) as IndexedRequest<StoredDraft | undefined>);
    if (entry && entry.revision <= revision) drafts.delete(key);
    await transactionDone(tx);
  }

  async deleteNote(vaultIdentity: string, noteId: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([DRAFTS, WATERMARKS, DELETED_NOTES], 'readwrite');
    const drafts = tx.objectStore(DRAFTS);
    const entries = await requestResult(drafts.index('vaultNote').getAll([vaultIdentity, noteId]) as IndexedRequest<StoredDraft[]>);
    const watermarks = tx.objectStore(WATERMARKS);
    for (const entry of entries) {
      drafts.delete(entry.key);
      watermarks.put({ key: entry.key, savedRevision: Number.MAX_SAFE_INTEGER } satisfies Watermark);
    }
    tx.objectStore(DELETED_NOTES).put({ key: deletedNoteKey(vaultIdentity, noteId), deleted: true } satisfies DeletedNote);
    await transactionDone(tx);
  }

  private open(): Promise<IndexedDatabase> {
    if (this.database !== null) return this.database;
    this.database = new Promise<IndexedDatabase>((resolve, reject) => {
      let request: IndexedOpenRequest;
      let settled = false;
      try {
        const factory = this.factory ?? (globalThis as typeof globalThis & { indexedDB?: IndexedFactory }).indexedDB;
        if (!factory) throw new Error('This browser does not provide IndexedDB draft recovery storage.');
        request = factory.open(DATABASE, DATABASE_VERSION);
      }
      catch (error) { reject(error); return; }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DRAFTS)) {
          const store = db.createObjectStore(DRAFTS, { keyPath: 'key' });
          store.createIndex('vaultNote', ['vaultIdentity', 'noteId'], { unique: false });
          store.createIndex('vaultIdentity', 'vaultIdentity', { unique: false });
        }
        if (!db.objectStoreNames.contains(WATERMARKS)) db.createObjectStore(WATERMARKS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(DELETED_NOTES)) db.createObjectStore(DELETED_NOTES, { keyPath: 'key' });
      };
      request.onsuccess = () => {
        if (settled) request.result.close();
        else { settled = true; resolve(request.result); }
      };
      request.onerror = () => {
        if (!settled) { settled = true; reject(request.error ?? new Error('Could not open draft recovery storage.')); }
      };
      request.onblocked = () => {
        if (!settled) { settled = true; reject(new Error('Draft recovery storage is blocked by another Nodus tab.')); }
      };
    }).catch((error: unknown) => {
      this.database = null;
      throw error;
    });
    return this.database!;
  }
}

function draftKey(entry: Pick<DraftRecoveryEntry, 'vaultIdentity' | 'noteId' | 'writerId'>): string {
  return JSON.stringify([entry.vaultIdentity, entry.noteId, entry.writerId]);
}

function deletedNoteKey(vaultIdentity: string, noteId: string): string {
  return JSON.stringify([vaultIdentity, noteId]);
}

function isValidDraft(value: unknown): value is DraftRecoveryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<DraftRecoveryEntry>;
  return typeof entry.vaultIdentity === 'string' && entry.vaultIdentity.length > 0
    && typeof entry.noteId === 'string' && entry.noteId.length > 0
    && typeof entry.writerId === 'string' && entry.writerId.length > 0
    && Number.isSafeInteger(entry.revision) && (entry.revision ?? -1) >= 0
    && typeof entry.title === 'string' && typeof entry.body === 'string'
    && (typeof entry.icon === 'string' || entry.icon === null)
    && typeof entry.iconTouched === 'boolean' && typeof entry.baseHash === 'string'
    && typeof entry.updatedAt === 'string' && Number.isFinite(Date.parse(entry.updatedAt));
}

function stripKey({ key: _key, ...entry }: StoredDraft): DraftRecoveryEntry {
  return entry;
}

function requestResult<T>(request: IndexedRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Draft recovery storage request failed.'));
  });
}

function transactionDone(transaction: IndexedTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Draft recovery storage transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Draft recovery storage transaction was aborted.'));
  });
}
