import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, unlink } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import type {
  DatabaseStore,
  DatabaseSummary,
  DatabaseViewWriteOptions,
  FolderImpact,
  ImportOptions,
  ImportPlan,
  ImportReport,
  NoteStore,
  NoteSummary,
  StorageHealth,
  StorageIssue,
  VaultEntry,
  VaultAttachment,
  VaultStorage,
} from '../contracts.js';
import type { DatabaseDefinition } from '../../database/schema.js';
import { parseDatabase, serializeDatabase } from '../../database/schema.js';
import { parseDatabaseView, serializeDatabaseView, validateViewReferences, type DatabaseView } from '../../database/database-view.js';
import { resolveLink } from '../../links/wikilink.js';
import { addNoteDatabaseMembership, setNotePropertyValue, type SetNotePropertyInput, type SetNotePropertyResult } from '../../database/note-properties.js';
import { relationWriteIssue } from '../../database/relations.js';
import { isUuidV4 } from '../../domain/ids.js';
import type { Note } from '../../domain/note.js';
import { validateNote } from '../../domain/note.js';
import { validateNotePath } from '../../domain/paths.js';
import { parseNote, serializeNote } from '../../format/note-format.js';
import { StorageError, storageFailure, wrapContentError, wrapInputError } from '../errors.js';
import type { ConditionalWriteOptions } from '../contracts.js';
import { writeFileAtomic, writeFileAtomicExclusive } from './atomic.js';
import { databasePath, databaseViewPath, isReservedNotePath } from './layout.js';
import { withVaultRootLock } from './root-lock.js';
import { assertInsideRoot, assertNotSymlink, pathExists, resolveInsideRoot } from './safe-path.js';
import { isManagedAttachmentDirectory, walkVault, type WalkEntry } from './scan.js';
import { attachmentPathId, createAttachmentPath, markdownReferencesAttachment, validateAttachmentBytes, ATTACHMENT_MAX_BYTES, ATTACHMENTS_DIR } from './attachments.js';
import { createVaultFolder, deleteVaultFolder, inspectVaultFolder, listVaultFolders, moveVaultFolder } from './folders.js';

interface ParsedNote {
  note: Note;
  text: string;
  /** Raw file bytes the note was parsed from; source of the SHA-256 token. */
  bytes: Buffer;
}

interface ParsedDatabase {
  database: DatabaseDefinition;
  text: string;
  bytes: Buffer;
}

interface ParsedDatabaseView { view: DatabaseView; text: string; bytes: Buffer; path: string }

const NOTE_NOT_FOUND = (id: string) =>
  new StorageError('NOT_FOUND', `Note "${id}" was not found`, { details: { ids: [id] } });

const DATABASE_NOT_FOUND = (id: string) =>
  new StorageError('NOT_FOUND', `Database "${id}" was not found`, { details: { ids: [id] } });

function staleWrite(path: string, currentHash: string): StorageError {
  return new StorageError(
    'STALE_WRITE',
    `File "${path}" changed on disk after the caller read it (current SHA-256: ${currentHash}); no write occurred`,
    { path, details: { paths: [path], currentHash } },
  );
}

/** SHA-256 of raw file bytes, as lowercase hex. */
export function sha256Hex(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Filesystem-backed Markdown vault.
 *
 * Notes live at their Phase 1 relative paths; database definitions live at
 * `databases/<id>.json`. All writes go through a temporary sibling and a rename.
 */
export class FileSystemVault implements VaultStorage, NoteStore, DatabaseStore {
  readonly root: string;
  // Derived note-only snapshots never participate in authoritative reads or writes.
  private noteSnapshot = new Map<string, { hash: string; note: Note }>();

  private constructor(root: string) {
    this.root = root;
  }

  /** Opens (and creates) a vault directory. */
  static async open(root: string): Promise<FileSystemVault> {
    const absolute = resolve(root);
    await mkdir(absolute, { recursive: true });
    const realRoot = await realpath(absolute);
    return new FileSystemVault(realRoot);
  }

  async listNotes(): Promise<NoteSummary[]> {
    const parsed = await this.parseNotesStrict();
    return parsed.map(({ note }) => summaryOf(note));
  }

  async listFolders(): Promise<string[]> {
    return listVaultFolders(this.root);
  }

  async createFolder(path: string): Promise<void> {
    return withVaultRootLock(this.root, () => createVaultFolder(this.root, path));
  }

  async moveFolder(fromPath: string, toPath: string): Promise<void> {
    return withVaultRootLock(this.root, () => moveVaultFolder(this.root, fromPath, toPath));
  }

  async inspectFolder(path: string): Promise<FolderImpact> {
    return inspectVaultFolder(this.root, path);
  }

  async deleteFolder(path: string, expectedToken: string): Promise<string[]> {
    return withVaultRootLock(this.root, async () => (await deleteVaultFolder(this.root, path, expectedToken)).noteIds);
  }

  /** Returns the full parsed notes, including extra frontmatter. */
  async listNoteDetails(): Promise<Note[]> {
    const parsed = await this.parseNotesStrict();
    return parsed.map(({ note }) => note);
  }

  async readNote(id: string): Promise<Note> {
    const located = await this.locateNote(id);
    return located.note;
  }

  async readNoteAtPath(path: string): Promise<Note> {
    const absolute = await this.validateReadPath(path);
    const text = await this.readTextAt(absolute, path);
    try {
      return parseNote(text, path);
    } catch (error) {
      throw wrapContentError(error, path);
    }
  }

  /** Read a bounded, non-symlink image asset from within this vault. */
  async readImage(path: string): Promise<{ bytes: Buffer; contentType: string }> {
    const imageTypes: Record<string, string> = {
      '.avif': 'image/avif', '.gif': 'image/gif', '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    };
    if (path.startsWith('/') || path.includes('\\') || /[\u0000-\u001f\u007f:]/.test(path) || path.split('/').some((part) => part === '' || part === '.' || part === '..' || part.startsWith('.'))) {
      throw new StorageError('UNSAFE_PATH', 'Invalid image path', { path });
    }
    const contentType = imageTypes[extname(path).toLowerCase()];
    if (contentType === undefined) throw new StorageError('INVALID_INPUT', 'Unsupported image type', { path });
    const absolute = await this.validateInternalPath(path);
    let info;
    try { info = await lstat(absolute); }
    catch (error) { throw storageFailure(error, 'Read image', path); }
    if (info.isSymbolicLink() || !info.isFile()) throw new StorageError('UNSAFE_PATH', 'Image must be a regular file inside the vault', { path });
    if (info.size > 10 * 1024 * 1024) throw new StorageError('INVALID_INPUT', 'Image is larger than 10 MiB', { path });
    const bytes = await this.readBytesAt(absolute, path);
    if (bytes.length > 10 * 1024 * 1024) throw new StorageError('INVALID_INPUT', 'Image is larger than 10 MiB', { path });
    return { bytes, contentType };
  }

  async listAttachments(): Promise<VaultAttachment[]> {
    return withVaultRootLock(this.root, () => this.listAttachmentsUnlocked());
  }

  async createAttachment(name: string, data: Uint8Array): Promise<VaultAttachment> {
    return withVaultRootLock(this.root, async () => {
      if (data.byteLength > ATTACHMENT_MAX_BYTES) throw new StorageError('INVALID_INPUT', 'Attachments must be 10 MiB or smaller.');
      const created = createAttachmentPath(name);
      const valid = validateAttachmentBytes(created.path, data);
      const directory = resolveInsideRoot(this.root, ATTACHMENTS_DIR);
      await assertInsideRoot(this.root, directory, ATTACHMENTS_DIR);
      await assertNotSymlink(directory, ATTACHMENTS_DIR);
      const rootFolders = await listVaultFolders(this.root);
      const conflictingFolder = rootFolders.find((folder) => folder.split('/')[0]?.normalize('NFC').toLowerCase() === ATTACHMENTS_DIR && folder !== ATTACHMENTS_DIR);
      if (conflictingFolder) throw new StorageError('CONFLICT', `A folder named "${conflictingFolder}" already uses the attachments storage path on this filesystem. Rename it before adding attachments.`, { path: conflictingFolder });
      if (await pathExists(directory) && !(await isManagedAttachmentDirectory(directory))) throw new StorageError('CONFLICT', 'A user folder named "attachments" already exists. Rename it before adding managed attachments.', { path: ATTACHMENTS_DIR });
      await mkdir(directory, { recursive: true });
      const absolute = await this.validateInternalPath(created.path);
      try {
        await writeFileAtomicExclusive(absolute, data);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new StorageError('CONFLICT', 'An attachment already exists at the generated path.', { path: created.path });
        throw storageFailure(error, 'Write attachment', created.path);
      }
      return { id: created.id, path: created.path, name: created.name, contentType: valid.contentType, size: data.byteLength, references: [] };
    });
  }

  async readAttachment(path: string): Promise<{ attachment: VaultAttachment; bytes: Buffer }> {
    return withVaultRootLock(this.root, async () => {
      const absolute = await this.validateAttachmentPath(path);
      const bytes = await this.readAttachmentBytesAt(absolute, path);
      const valid = validateAttachmentBytes(path, bytes);
      return { attachment: { id: valid.id, path, name: valid.name, contentType: valid.contentType, size: bytes.length, references: [] }, bytes };
    });
  }

  async deleteAttachment(path: string, confirmReferenced = false): Promise<void> {
    return withVaultRootLock(this.root, async () => {
      const absolute = await this.validateAttachmentPath(path);
      const bytes = await this.readAttachmentBytesAt(absolute, path);
      validateAttachmentBytes(path, bytes);
      const notes = await this.parseNotesStrict();
      const references = notes.filter(({ note }) => markdownReferencesAttachment(note.body, note.path, path)).map(({ note }) => note.path);
      if (references.length > 0 && !confirmReferenced) {
        throw new StorageError('CONFLICT', `Attachment is referenced by ${references.length} note(s); confirm deletion to continue.`, { path, details: { paths: references } });
      }
      await assertNotSymlink(absolute, path);
      const current = await this.readAttachmentBytesAt(absolute, path);
      if (sha256Hex(current) !== sha256Hex(bytes)) throw new StorageError('STALE_WRITE', `Attachment "${path}" changed during deletion; refresh and retry.`, { path });
      try { await unlink(absolute); } catch (error) { throw storageFailure(error, 'Delete attachment', path); }
    });
  }

  private async validateAttachmentPath(path: string): Promise<string> {
    if (attachmentPathId(path) === undefined) throw new StorageError('UNSAFE_PATH', 'Invalid attachment path', { path });
    return this.validateInternalPath(path);
  }

  private async readAttachmentBytesAt(absolute: string, path: string): Promise<Buffer> {
    let info;
    try { info = await lstat(absolute); } catch (error) {
      if (isMissing(error)) throw new StorageError('NOT_FOUND', `Attachment "${path}" was not found`, { path });
      throw storageFailure(error, 'Read attachment', path);
    }
    if (info.isSymbolicLink() || !info.isFile()) throw new StorageError('UNSAFE_PATH', 'Attachment must be a regular file inside the vault', { path });
    if (info.size > ATTACHMENT_MAX_BYTES) throw new StorageError('INVALID_CONTENT', 'Attachment is larger than 10 MiB.', { path });
    const bytes = await this.readBytesAt(absolute, path);
    if (bytes.length > ATTACHMENT_MAX_BYTES) throw new StorageError('INVALID_CONTENT', 'Attachment is larger than 10 MiB.', { path });
    return bytes;
  }

  private async listAttachmentsUnlocked(): Promise<VaultAttachment[]> {
    const { entries, issues, folders } = await walkVault(this.root);
    const bad = issues.filter((issue) => issue.path === ATTACHMENTS_DIR || issue.path.startsWith(`${ATTACHMENTS_DIR}/`));
    if (bad.length > 0) throw new StorageError('INVALID_CONTENT', 'Attachment storage contains invalid entries.', { details: { issues: bad.map((issue) => `${issue.path}: ${issue.message}`) } });
    if (folders.includes(ATTACHMENTS_DIR)) throw new StorageError('CONFLICT', 'A user folder named "attachments" already exists and is not managed attachment storage.', { path: ATTACHMENTS_DIR });
    const notes = await this.parseNotesStrict();
    const attachments: VaultAttachment[] = [];
    for (const entry of entries) {
      if (entry.kind !== 'attachment') continue;
      const bytes = await this.readAttachmentBytesAt(entry.absolute, entry.path);
      const valid = validateAttachmentBytes(entry.path, bytes);
      attachments.push({ id: valid.id, path: entry.path, name: valid.name, contentType: valid.contentType, size: bytes.length,
        references: notes.filter(({ note }) => markdownReferencesAttachment(note.body, note.path, entry.path)).map(({ note }) => note.path) });
    }
    return attachments;
  }

  /**
   * Reads a note and its SHA-256 revision token from ONE read: the hash covers
   * the exact raw bytes that were parsed, so it can be passed back as
   * `expectedHash` without a second, racing read.
   */
  async readNoteWithHash(id: string): Promise<{ note: Note; hash: string; text: string }> {
    const located = await this.locateNote(id);
    return { note: located.note, hash: sha256Hex(located.bytes), text: located.text };
  }

  async createNote(note: Note): Promise<void> {
    return withVaultRootLock(this.root, () => this.createNoteUnlocked(note));
  }

  /** Root-locked, byte-verified snapshot for derived search/discovery indexes. */
  async snapshotNotes(): Promise<Note[]> {
    return withVaultRootLock(this.root, async () => {
      const { entries } = await walkVault(this.root);
      const notes = entries.filter((entry) => entry.kind === 'note');
      const next = new Map<string, { hash: string; note: Note }>();
      const seen = new Map<string, string>();
      const result: Note[] = [];
      // Bound open files and memory, overlap I/O, and drain a whole batch before
      // throwing so no reads outlive the root lock. Errors stay in path order.
      for (let offset = 0; offset < notes.length; offset += 8) {
        const batch = notes.slice(offset, offset + 8);
        const reads = await Promise.allSettled(batch.map((entry) => this.readBytes(entry)));
        for (const [index, read] of reads.entries()) {
          const entry = batch[index]!;
          let note: Note;
          try {
            if (read.status === 'rejected') throw read.reason;
            const hash = sha256Hex(read.value);
            const previous = this.noteSnapshot.get(entry.path);
            // Always re-read/hash bytes: same-size edits with preserved timestamps
            // must not be hidden, even after an explicit refresh or restore.
            note = previous?.hash === hash ? previous.note : parseNote(decodeVaultText(read.value, entry.path), entry.path);
            next.set(entry.path, { hash, note });
          } catch (error) { throw wrapContentError(error, entry.path); }
          const duplicate = seen.get(note.id);
          if (duplicate !== undefined) throw new StorageError('DUPLICATE_ID', `Note ID "${note.id}" is used by both "${duplicate}" and "${entry.path}"`,
            { details: { ids: [note.id], paths: [duplicate, entry.path] } });
          seen.set(note.id, entry.path);
          // Callers cannot mutate the parsed cache through returned arrays/metadata.
          result.push(structuredClone(note));
        }
      }
      // Publish only complete successful snapshots; removed paths are evicted.
      this.noteSnapshot = next;
      return result;
    });
  }

  /** Relation target validation and the conditional source write share one root lock. */
  async setNoteProperty(id: string, input: SetNotePropertyInput | { databaseId: string; membershipOnly: true; confirmCreate: boolean }, options: { expectedHash: string; now: string }): Promise<SetNotePropertyResult> {
    return withVaultRootLock(this.root, async () => {
      const parsed = await this.parseNotesStrict();
      const current = parsed.find(({ note }) => note.id === id);
      if (!current) throw NOTE_NOT_FOUND(id);
      if (sha256Hex(current.bytes) !== options.expectedHash) throw staleWrite(current.note.path, sha256Hex(current.bytes));
      const schemas = new Map((await this.parseDatabasesStrict()).map(({ database }) => [database.id, database]));
      const result = 'membershipOnly' in input ? addNoteDatabaseMembership(current.note, schemas, input.databaseId, input.confirmCreate) : setNotePropertyValue(current.note, schemas, input);
      if (!result.ok) return result;
      const property = 'propertyId' in input ? schemas.get(input.databaseId)!.properties.find((property) => property.id === input.propertyId)! : undefined;
      const updated = { ...current.note, extraFrontmatter: result.extraFrontmatter, updatedAt: options.now };
      const notes = parsed.map(({ note }) => note.id === id ? updated : note);
      const problem = property && 'propertyId' in input ? relationWriteIssue(property, notes, schemas, input.remove ? null : input.value) : undefined;
      if (problem) return { ok: false, issues: [{ noteId: id, path: current.note.path, databaseId: input.databaseId, propertyId: property!.id, code: 'INCOMPATIBLE_TARGET', message: problem }] };
      const absolute = await this.validateNoteTarget(updated.path);
      await this.assertUnchanged(absolute, updated.path, options.expectedHash);
      await this.writeDocument(updated.path, this.serializeNoteInput(updated));
      return result;
    });
  }

  /** Recheck resolution and create atomically with respect to all Nodus writers. */
  async createNoteForLink(target: string, candidate: Note): Promise<Note> {
    return withVaultRootLock(this.root, async () => {
      const notes = await this.listNoteDetails();
      const resolution = resolveLink(target, notes);
      if (resolution.status === 'resolved') return notes.find((note) => note.id === resolution.noteId)!;
      if (resolution.status === 'ambiguous') throw new StorageError('CONFLICT', 'The link now matches multiple notes. Choose a destination instead.');
      const intended = resolveLink(target, [candidate]);
      if (intended.status !== 'resolved') throw new StorageError('INVALID_INPUT', 'The new note must resolve the intended link.');
      await this.createNoteUnlocked(candidate);
      return candidate;
    });
  }

  private async createNoteUnlocked(note: Note): Promise<void> {
    try {
      validateNote(note);
    } catch (error) {
      throw wrapInputError(error, 'Invalid note');
    }

    const absolute = await this.validateNoteTarget(note.path);
    if (await pathExists(absolute)) {
      throw new StorageError('CONFLICT', `A file already exists at "${note.path}"`, {
        path: note.path,
        details: { paths: [note.path] },
      });
    }

    const existing = await this.parseNotesStrict();
    const duplicate = existing.find(({ note: candidate }) => candidate.id === note.id);
    if (duplicate !== undefined) {
      throw new StorageError(
        'DUPLICATE_ID',
        `Note ID "${note.id}" is already stored at "${duplicate.note.path}"`,
        { details: { ids: [note.id], paths: [duplicate.note.path] } },
      );
    }
    const foldedPath = foldPath(note.path);
    const pathCollision = existing.find(({ note: candidate }) => foldPath(candidate.path) === foldedPath);
    if (pathCollision !== undefined) {
      throw new StorageError(
        'CONFLICT',
        `Path "${note.path}" collides with "${pathCollision.note.path}" on case-insensitive filesystems`,
        { path: note.path, details: { paths: [pathCollision.note.path, note.path] } },
      );
    }

    await this.writeDocument(note.path, this.serializeNoteInput(note));
  }

  async replaceNote(note: Note, options: ConditionalWriteOptions = {}): Promise<void> {
    return withVaultRootLock(this.root, async () => {
    try {
      validateNote(note);
    } catch (error) {
      throw wrapInputError(error, 'Invalid note');
    }

    const current = await this.findNote(note.id);
    if (current.note.path !== note.path) {
      throw new StorageError(
        'CONFLICT',
        `Note "${note.id}" is stored at "${current.note.path}", not "${note.path}"; use moveNote to change its path`,
        { path: note.path, details: { ids: [note.id], paths: [current.note.path, note.path] } },
      );
    }

    const absolute = await this.validateNoteTarget(note.path);
    await this.assertUnchanged(absolute, note.path, options.expectedHash);
    await this.writeDocument(note.path, this.serializeNoteInput(note));
    });
  }

  async moveNote(
    id: string,
    toPath: string,
    options: ConditionalWriteOptions = {},
  ): Promise<Note> {
    return withVaultRootLock(this.root, async () => {
    const current = await this.findNote(id);
    if (toPath === current.note.path) return current.note;

    const source = await this.validateReadPath(current.note.path);
    const absolute = await this.validateNoteTarget(toPath);
    if (await pathExists(absolute)) {
      throw new StorageError('CONFLICT', `A file already exists at "${toPath}"`, {
        path: toPath,
        details: { paths: [toPath] },
      });
    }

    const existing = await this.parseNotesStrict();
    const foldedTarget = foldPath(toPath);
    const collision = existing.find(({ note: candidate }) => foldPath(candidate.path) === foldedTarget);
    if (collision !== undefined) {
      throw new StorageError(
        'CONFLICT',
        `Path "${toPath}" collides with "${collision.note.path}" on case-insensitive filesystems`,
        { path: toPath, details: { paths: [collision.note.path, toPath] } },
      );
    }

    await this.assertUnchanged(source, current.note.path, options.expectedHash);
    const movedText =
      current.note.sourceFormat === 'plain-markdown'
        ? this.serializeNoteInput({ ...current.note, path: toPath, sourceFormat: undefined })
        : current.text;
    await this.writeDocument(toPath, movedText);

    try {
      await unlink(source);
    } catch (error) {
      throw new StorageError(
        'PARTIAL_WRITE',
        `Note "${id}" was written to "${toPath}" but the old file at "${current.note.path}" could not be removed: ${describe(error)}`,
        {
          cause: error,
          details: { ids: [id], paths: [current.note.path, toPath] },
        },
      );
    }

    return { ...current.note, path: toPath };
    });
  }

  async deleteNote(id: string, options: ConditionalWriteOptions = {}): Promise<void> {
    return withVaultRootLock(this.root, async () => {
    const current = await this.findNote(id);
    const source = await this.validateReadPath(current.note.path);
    await this.assertUnchanged(source, current.note.path, options.expectedHash);
    try {
      await unlink(source);
    } catch (error) {
      if (isMissing(error)) throw NOTE_NOT_FOUND(id);
      throw storageFailure(error, 'Delete note', current.note.path);
    }
    });
  }

  async listDatabases(): Promise<DatabaseSummary[]> {
    const parsed = await this.parseDatabasesStrict();
    return parsed.map(({ database }) => ({
      id: database.id,
      name: database.name,
      path: databasePath(database.id),
      propertyCount: database.properties.length,
    }));
  }

  async readDatabase(id: string): Promise<DatabaseDefinition> {
    return (await this.readDatabaseWithHash(id)).database;
  }

  /** Reads a database definition and its raw-byte revision token from one read. */
  async readDatabaseWithHash(id: string): Promise<{ database: DatabaseDefinition; hash: string }> {
    if (!isUuidV4(id)) throw DATABASE_NOT_FOUND(id);
    const path = databasePath(id);
    const absolute = await this.validateInternalPath(path);
    const bytes = await this.readBytesAt(absolute, path);
    const text = decodeVaultText(bytes, path);

    let database: DatabaseDefinition;
    try {
      database = parseDatabase(text);
    } catch (error) {
      throw wrapContentError(error, path);
    }
    if (database.id !== id) {
      throw new StorageError('INVALID_CONTENT', `Database file "${path}" contains ID "${database.id}"`, {
        path,
        details: { ids: [database.id, id], paths: [path] },
      });
    }
    return { database, hash: sha256Hex(bytes) };
  }

  async createDatabase(database: DatabaseDefinition): Promise<void> {
    return withVaultRootLock(this.root, async () => {
    const text = this.serializeDatabaseInput(database);
    const path = databasePath(database.id);
    const absolute = await this.validateInternalPath(path);
    if (await pathExists(absolute)) {
      throw new StorageError('CONFLICT', `A database with ID "${database.id}" already exists`, {
        path,
        details: { ids: [database.id], paths: [path] },
      });
    }
    await this.writeDocument(path, text, true);
    });
  }

  async replaceDatabase(database: DatabaseDefinition, options: ConditionalWriteOptions = {}): Promise<void> {
    return withVaultRootLock(this.root, async () => {
    const text = this.serializeDatabaseInput(database);
    const path = databasePath(database.id);
    const absolute = await this.validateInternalPath(path);
    if (!(await pathExists(absolute))) throw DATABASE_NOT_FOUND(database.id);
    const existingBytes = await this.readBytesAt(absolute, path);
    const existingText = decodeVaultText(existingBytes, path);
    let existing: DatabaseDefinition;
    try {
      existing = parseDatabase(existingText);
    } catch (error) {
      throw wrapContentError(error, path);
    }
    if (existing.id !== database.id) {
      throw new StorageError('INVALID_CONTENT', `Database file "${path}" contains ID "${existing.id}"`, {
        path,
        details: { ids: [existing.id, database.id], paths: [path] },
      });
    }
    if (options.expectedHash !== undefined) {
      const currentHash = sha256Hex(existingBytes);
      if (currentHash !== options.expectedHash) throw staleWrite(path, currentHash);
    }
    await this.writeDocument(path, text, true);
    });
  }

  async deleteDatabase(id: string): Promise<void> {
    return withVaultRootLock(this.root, async () => {
    if (!isUuidV4(id)) throw DATABASE_NOT_FOUND(id);
    await assertNotSymlink(resolveInsideRoot(this.root, 'databases'), 'databases');
    const absolute = await this.validateInternalPath(databasePath(id));
    try {
      await unlink(absolute);
    } catch (error) {
      if (isMissing(error)) throw DATABASE_NOT_FOUND(id);
      throw storageFailure(error, 'Delete database', databasePath(id));
    }
    });
  }

  async listDatabaseViews(databaseId?: string) {
    if (databaseId !== undefined && !isUuidV4(databaseId)) throw new StorageError('INVALID_INPUT', 'Database ID must be a lowercase UUID v4');
    return withVaultRootLock(this.root, async () => {
      const parsed = await this.parseDatabaseViewsStrict();
      return parsed.filter(({ view }) => databaseId === undefined || view.databaseId === databaseId)
        .map(({ view, bytes, path }) => ({ view, path, hash: sha256Hex(bytes) }));
    });
  }

  async createDatabaseView(view: DatabaseView, options: DatabaseViewWriteOptions = {}): Promise<void> {
    return withVaultRootLock(this.root, async () => {
      const text = this.serializeDatabaseViewInput(view);
      await this.validateDatabaseViewSchema(view, options.expectedDatabaseHash);
      const path = databaseViewPath(view.databaseId, view.id);
      const absolute = await this.validateInternalPath(path);
      if (await pathExists(absolute)) throw new StorageError('CONFLICT', `A saved view already exists at "${path}"`, { path, details: { paths: [path] } });
      const existing = await this.parseDatabaseViewsStrict();
      if (existing.some(({ view: candidate }) => candidate.id === view.id)) throw new StorageError('DUPLICATE_ID', `Saved view ID "${view.id}" already exists`, { details: { ids: [view.id] } });
      await this.writeDocument(path, text, true);
    });
  }

  async readDatabaseView(databaseId: string, viewId: string) {
    if (!isUuidV4(databaseId) || !isUuidV4(viewId)) throw new StorageError('INVALID_INPUT', 'Saved view IDs must be lowercase UUID v4');
    return withVaultRootLock(this.root, async () => {
      const stored = (await this.parseDatabaseViewsStrict()).find(({ view }) => view.databaseId === databaseId && view.id === viewId);
      if (!stored) throw new StorageError('NOT_FOUND', 'Saved view was not found');
      return { view: stored.view, path: stored.path, hash: sha256Hex(stored.bytes) };
    });
  }

  async duplicateDatabaseView(databaseId: string, viewId: string, newId: string, name: string, options: Required<ConditionalWriteOptions>): Promise<void> {
    return withVaultRootLock(this.root, async () => {
      const stored = await this.parseDatabaseViewsStrict();
      const source = stored.find(({ view }) => view.databaseId === databaseId && view.id === viewId);
      if (!source) throw new StorageError('NOT_FOUND', 'Saved view was not found');
      if (sha256Hex(source.bytes) !== options.expectedHash) throw staleWrite(source.path, sha256Hex(source.bytes));
      const duplicate = { ...source.view, id: newId, name };
      const text = this.serializeDatabaseViewInput(duplicate);
      await this.validateDatabaseViewSchema(duplicate);
      const path = databaseViewPath(databaseId, newId);
      const absolute = await this.validateInternalPath(path);
      if (stored.some(({ view }) => view.id === newId) || await pathExists(absolute)) throw new StorageError('CONFLICT', 'The duplicate saved view ID already exists', { path });
      await this.writeDocument(path, text, true);
    });
  }

  async replaceDatabaseView(view: DatabaseView, options: DatabaseViewWriteOptions = {}): Promise<void> {
    return withVaultRootLock(this.root, async () => {
      const text = this.serializeDatabaseViewInput(view);
      await this.validateDatabaseViewSchema(view, options.expectedDatabaseHash);
      const path = databaseViewPath(view.databaseId, view.id);
      const absolute = await this.validateInternalPath(path);
      const bytes = await this.readBytesAt(absolute, path);
      let current: DatabaseView;
      try { current = parseDatabaseView(decodeVaultText(bytes, path)); } catch (error) { throw wrapContentError(error, path); }
      if (current.id !== view.id || current.databaseId !== view.databaseId) throw new StorageError('INVALID_CONTENT', `Saved view at "${path}" does not match its path`, { path });
      if (options.expectedHash !== undefined && sha256Hex(bytes) !== options.expectedHash) throw staleWrite(path, sha256Hex(bytes));
      await this.writeDocument(path, text, true);
    });
  }

  async deleteDatabaseView(databaseId: string, viewId: string, options: ConditionalWriteOptions = {}): Promise<void> {
    return withVaultRootLock(this.root, async () => {
      if (!isUuidV4(databaseId) || !isUuidV4(viewId)) throw new StorageError('NOT_FOUND', 'Saved view was not found');
      const path = databaseViewPath(databaseId, viewId);
      const absolute = await this.validateInternalPath(path);
      const bytes = await this.readBytesAt(absolute, path);
      const currentHash = sha256Hex(bytes);
      if (options.expectedHash !== undefined && currentHash !== options.expectedHash) throw staleWrite(path, currentHash);
      try { await unlink(absolute); } catch (error) { if (isMissing(error)) throw new StorageError('NOT_FOUND', `Saved view "${viewId}" was not found`, { path }); throw storageFailure(error, 'Delete saved view', path); }
    });
  }

  async snapshot(): Promise<VaultEntry[]> {
    return withVaultRootLock(this.root, async () => {
      const notes = await this.parseNotesStrict();
      const databases = await this.parseDatabasesStrict();
      const views = await this.parseDatabaseViewsStrict();
      const walked = await walkVault(this.root);
      const attachmentIssues = walked.issues.filter((issue) => issue.path === ATTACHMENTS_DIR || issue.path.startsWith(`${ATTACHMENTS_DIR}/`));
      if (attachmentIssues.length > 0) throw new StorageError('INVALID_CONTENT', 'Attachment storage contains invalid entries.', { details: { issues: attachmentIssues.map((issue) => `${issue.path}: ${issue.message}`) } });
      const attachments: VaultEntry[] = [];
      for (const entry of walked.entries) {
        if (entry.kind !== 'attachment') continue;
        const bytes = await this.readAttachmentBytesAt(entry.absolute, entry.path);
        validateAttachmentBytes(entry.path, bytes);
        attachments.push({ kind: 'attachment', id: attachmentPathId(entry.path)!, path: entry.path, text: '', rawBytes: Buffer.from(bytes) });
      }

      return [
        ...notes.map(({ note, text, bytes }) => ({
          kind: 'note' as const,
          id: note.id,
          path: note.path,
          text,
          rawBytes: Buffer.from(bytes),
        })),
        ...databases.map(({ database, text, bytes }) => ({
          kind: 'database' as const,
          id: database.id,
          path: databasePath(database.id),
          text,
          rawBytes: Buffer.from(bytes),
        })),
        ...views.map(({ view, text, bytes, path }) => ({ kind: 'database-view' as const, id: view.id, path, text, rawBytes: Buffer.from(bytes) })),
        ...attachments,
      ];
    });
  }

  async checkHealth(): Promise<StorageHealth> {
    const { entries, issues } = await walkVault(this.root);
    const notes: NoteSummary[] = [];
    const databases: DatabaseSummary[] = [];
    const databaseViews: import('../contracts.js').DatabaseViewSummary[] = [];
    const notePathsById = new Map<string, string[]>();

    for (const entry of entries) {
      if (entry.kind === 'temp') {
        issues.push({
          code: 'INCOMPLETE_WRITE',
          path: entry.path,
          message: 'Temporary file from an active or interrupted write; stop vault writers and preserve and inspect it before cleanup',
        });
        continue;
      }

      if (entry.kind === 'attachment') {
        try { validateAttachmentBytes(entry.path, await this.readAttachmentBytesAt(entry.absolute, entry.path)); }
        catch (error) { issues.push(contentIssue(error, entry.path)); }
        continue;
      }

      if (entry.kind === 'note') {
        try {
          const note = parseNote(await this.readText(entry), entry.path);
          notes.push(summaryOf(note));
          const paths = notePathsById.get(note.id) ?? [];
          paths.push(entry.path);
          notePathsById.set(note.id, paths);
        } catch (error) {
          issues.push(contentIssue(error, entry.path));
        }
        continue;
      }

      try {
        const text = await this.readText(entry);
        if (entry.kind === 'database-view') {
          const view = parseDatabaseView(text);
          if (entry.path !== databaseViewPath(view.databaseId, view.id)) throw new StorageError('INVALID_CONTENT', 'Saved view ID must match its path', { path: entry.path });
          const bytes = await this.readBytes(entry);
          databaseViews.push({ view, path: entry.path, hash: sha256Hex(bytes) });
          continue;
        }
        const database = parseDatabase(text);
        if (entry.path !== databasePath(database.id)) {
          throw new StorageError(
            'INVALID_CONTENT',
            `Database ID "${database.id}" must be stored at "${databasePath(database.id)}"`,
            { path: entry.path },
          );
        }
        databases.push({
          id: database.id,
          name: database.name,
          path: entry.path,
          propertyCount: database.properties.length,
        });
      } catch (error) {
        issues.push(contentIssue(error, entry.path));
      }
    }

    for (const [id, paths] of notePathsById) {
      if (paths.length < 2) continue;
      for (const path of paths) {
        const others = paths.filter((other) => other !== path);
        issues.push({
          code: 'DUPLICATE_ID',
          path,
          message: `Note ID "${id}" is also used by ${others.join(', ')}`,
        });
      }
    }

    return {
      notes: sortByPath(notes),
      databases: sortByPath(databases),
      databaseViews: sortByPath(databaseViews),
      issues: issues.sort((left, right) =>
        left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
      ),
    };
  }

  async applyImport(plan: ImportPlan, options: ImportOptions = {}): Promise<ImportReport> {
    return withVaultRootLock(this.root, () => this.applyImportLocked(plan, options));
  }

  private async applyImportLocked(plan: ImportPlan, options: ImportOptions): Promise<ImportReport> {
    for (const note of plan.notes) {
      try {
        validateNote(note);
        await this.validateNoteTarget(note.path);
      } catch (error) {
        throw wrapInputError(error, `Invalid imported note "${note.path}"`);
      }
    }
    for (const database of plan.databases) {
      this.serializeDatabaseInput(database);
      await this.validateInternalPath(databasePath(database.id));
    }
    const incomingViews = plan.databaseViews ?? [];
    for (const view of incomingViews) {
      this.serializeDatabaseViewInput(view);
      await this.validateInternalPath(databaseViewPath(view.databaseId, view.id));
    }
    const viewEntries = plan.entries.filter((entry) => entry.kind === 'database-view');
    if (viewEntries.length !== incomingViews.length) throw new StorageError('INVALID_CONTENT', 'Import plan saved-view entries do not match its validated saved views');
    const parsedEntryPaths = new Set<string>();
    for (const entry of viewEntries) {
      let parsed: DatabaseView;
      try { parsed = parseDatabaseView(entry.text); } catch (error) { throw wrapContentError(error, entry.path); }
      const expectedPath = databaseViewPath(parsed.databaseId, parsed.id);
      if (entry.path !== expectedPath || entry.id !== parsed.id || !incomingViews.some((view) => view.id === parsed.id && view.databaseId === parsed.databaseId)) {
        throw new StorageError('INVALID_CONTENT', `Import saved-view entry "${entry.path}" does not match its validated view`, { path: entry.path });
      }
      const key = foldPath(entry.path);
      if (parsedEntryPaths.has(key)) throw new StorageError('CONFLICT', `Import contains duplicate saved-view path "${entry.path}"`, { path: entry.path });
      parsedEntryPaths.add(key);
    }

    const attachmentEntries = plan.entries.filter((entry) => entry.kind === 'attachment');
    for (const entry of attachmentEntries) {
      const bytes = entry.rawBytes;
      const valid = bytes === undefined ? undefined : validateAttachmentBytes(entry.path, bytes);
      if (!valid || valid.id !== entry.id) throw new StorageError('INVALID_CONTENT', `Import attachment "${entry.path}" does not match its ID or has no binary content.`, { path: entry.path });
      await this.validateAttachmentPath(entry.path);
    }

    const noteText = new Map<string, string>();
    const databaseText = new Map<string, string>();
    for (const entry of plan.entries) {
      if (entry.kind === 'note') noteText.set(entry.id, entry.text);
      else if (entry.kind === 'database') databaseText.set(entry.id, entry.text);
    }

    const existingNotes = await this.parseNotesStrict();
    const existingDatabases = await this.parseDatabasesStrict();
    const existingViews = await this.parseDatabaseViewsStrict();

    const existingNoteIds = new Map(existingNotes.map(({ note }) => [note.id, note.path] as const));
    const existingNotePaths = new Map(existingNotes.map(({ note }) => [foldPath(note.path), note.path] as const));
    const existingNotePathToId = new Map(existingNotes.map(({ note }) => [foldPath(note.path), note.id] as const));
    const existingDatabaseIds = new Set(existingDatabases.map(({ database }) => database.id));
    const expectedHashes = new Map<string, string>();
    for (const { note, bytes } of existingNotes) expectedHashes.set(note.path, sha256Hex(bytes));
    for (const { database, bytes } of existingDatabases) {
      expectedHashes.set(databasePath(database.id), sha256Hex(bytes));
    }
    for (const { path, bytes } of existingViews) expectedHashes.set(path, sha256Hex(bytes));
    const existingAttachments = await this.listAttachmentsUnlocked();
    for (const item of existingAttachments) {
      const stored = await this.readBytesAt(await this.validateAttachmentPath(item.path), item.path);
      expectedHashes.set(item.path, sha256Hex(stored));
    }

    const plannedPaths = new Set<string>();
    const plannedNoteIds = new Set<string>();
    for (const note of plan.notes) {
      const folded = foldPath(note.path);
      if (plannedNoteIds.has(note.id)) {
        throw new StorageError('DUPLICATE_ID', `Import contains duplicate note ID "${note.id}"`, {
          details: { ids: [note.id] },
        });
      }
      plannedNoteIds.add(note.id);
      if (plannedPaths.has(folded)) {
        throw new StorageError('CONFLICT', `Import contains duplicate path "${note.path}"`, {
          path: note.path,
          details: { paths: [note.path] },
        });
      }
      plannedPaths.add(folded);
    }
    const plannedDatabaseIds = new Set<string>();
    for (const database of plan.databases) {
      if (plannedDatabaseIds.has(database.id)) {
        throw new StorageError('DUPLICATE_ID', `Import contains duplicate database ID "${database.id}"`, {
          details: { ids: [database.id] },
        });
      }
      plannedDatabaseIds.add(database.id);
    }
    const plannedViewPaths = new Set<string>();
    for (const view of incomingViews) {
      const path = databaseViewPath(view.databaseId, view.id);
      const folded = foldPath(path);
      if (plannedViewPaths.has(folded)) throw new StorageError('CONFLICT', `Import contains duplicate saved-view path "${path}"`, { path, details: { paths: [path] } });
      if (incomingViews.some((candidate) => candidate.id === view.id && candidate !== view)) throw new StorageError('DUPLICATE_ID', `Import contains saved view ID "${view.id}" more than once`, { details: { ids: [view.id] } });
      plannedViewPaths.add(folded);
    }
    const plannedAttachmentPaths = new Set<string>();
    const plannedAttachmentIds = new Set<string>();
    for (const entry of attachmentEntries) {
      if (plannedAttachmentIds.has(entry.id)) throw new StorageError('DUPLICATE_ID', `Import contains duplicate attachment ID "${entry.id}"`, { details: { ids: [entry.id] } });
      plannedAttachmentIds.add(entry.id);
      const folded = foldPath(entry.path);
      if (plannedAttachmentPaths.has(folded)) throw new StorageError('CONFLICT', `Import contains duplicate attachment path "${entry.path}"`, { path: entry.path });
      plannedAttachmentPaths.add(folded);
    }

    const idConflicts = new Set<string>();
    const pathConflicts = new Set<string>();
    for (const note of plan.notes) {
      if (existingNoteIds.has(note.id)) idConflicts.add(note.id);
      const existingPath = existingNotePaths.get(foldPath(note.path));
      if (existingPath !== undefined) pathConflicts.add(existingPath);
      if (existingPath !== undefined && existingPath !== note.path) pathConflicts.add(note.path);
    }
    for (const database of plan.databases) {
      if (existingDatabaseIds.has(database.id)) idConflicts.add(database.id);
    }
    for (const view of incomingViews) {
      const path = databaseViewPath(view.databaseId, view.id);
      const existingById = existingViews.find((candidate) => candidate.view.id === view.id);
      if (existingById !== undefined && existingById.path !== path) {
        throw new StorageError('CONFLICT', `Saved view ID "${view.id}" already belongs to "${existingById.path}" and cannot be moved by import`, { path, details: { ids: [view.id], paths: [existingById.path, path] } });
      }
      const existingPath = existingViews.find((candidate) => foldPath(candidate.path) === foldPath(path));
      if (existingPath !== undefined) {
        if (existingPath.path !== path) pathConflicts.add(path);
        idConflicts.add(view.id);
      }
    }
    for (const entry of attachmentEntries) {
      const existingById = existingAttachments.find((candidate) => candidate.id === entry.id);
      if (existingById && existingById.path !== entry.path) throw new StorageError('CONFLICT', `Attachment ID "${entry.id}" already belongs to "${existingById.path}" and cannot be moved by import`, { details: { ids: [entry.id], paths: [existingById.path, entry.path] } });
      if (existingById) {
        idConflicts.add(entry.id);
        pathConflicts.add(entry.path);
      }
    }

    if (options.overwrite !== true && (idConflicts.size > 0 || pathConflicts.size > 0)) {
      throw new StorageError('CONFLICT', 'Import would overwrite existing data; pass { overwrite: true }', {
        details: {
          ids: [...idConflicts].sort(),
          paths: [...pathConflicts].sort(),
        },
      });
    }

    // Even with overwrite: true, two notes may not share a case-folded/NFC path,
    // because that would silently replace an unrelated note on a case-insensitive
    // filesystem or create a non-portable vault on a case-sensitive one.
    const caseCollisions = new Set<string>();
    for (const note of plan.notes) {
      const folded = foldPath(note.path);
      const existingPath = existingNotePaths.get(folded);
      const existingId = existingNotePathToId.get(folded);
      if (
        existingPath !== undefined &&
        (existingId !== note.id || existingPath !== note.path)
      ) {
        caseCollisions.add(existingPath);
        caseCollisions.add(note.path);
      }
    }
    if (caseCollisions.size > 0) {
      throw new StorageError(
        'CONFLICT',
        'Import would overwrite an existing note at a case-insensitive or normalized path collision',
        {
          details: {
            paths: [...caseCollisions].sort(),
          },
        },
      );
    }

    const stalePaths = [
      ...new Set(
        plan.notes
          .map((note) => existingNoteIds.get(note.id))
          .filter((path): path is string => path !== undefined),
      ),
    ].filter((path) => !plannedPaths.has(foldPath(path)));

    const written: string[] = [];
    const deleted: string[] = [];
    let failedPath: string | undefined;
    let notes = 0;
    let databases = 0;
    let databaseViews = 0;
    let attachments = 0;

    try {
      for (const note of plan.notes) {
        const text = noteText.get(note.id) ?? this.serializeNoteInput(note);
        failedPath = note.path;
        await this.writeDocument(note.path, text, false, () =>
          this.assertImportTargetUnchanged(note.path, expectedHashes.get(note.path)),
        );
        notes += 1;
        written.push(note.path);
      }

      for (const database of plan.databases) {
        const path = databasePath(database.id);
        const text = databaseText.get(database.id) ?? serializeDatabase(database);
        failedPath = path;
        await this.writeDocument(path, text, true, () =>
          this.assertImportTargetUnchanged(path, expectedHashes.get(path)),
        );
        databases += 1;
        written.push(path);
      }

      for (const view of incomingViews) {
        const path = databaseViewPath(view.databaseId, view.id);
        const entry = plan.entries.find((item) => item.kind === 'database-view' && item.id === view.id && item.path === path);
        failedPath = path;
        await this.writeDocument(path, entry?.text ?? this.serializeDatabaseViewInput(view), true, () =>
          this.assertImportTargetUnchanged(path, expectedHashes.get(path)),
        );
        databaseViews += 1;
        written.push(path);
      }

      for (const entry of attachmentEntries) {
        const path = entry.path;
        const bytes = entry.rawBytes!;
        const absolute = await this.validateAttachmentPath(path);
        failedPath = path;
        await this.assertImportTargetUnchanged(path, expectedHashes.get(path));
        await writeFileAtomic(absolute, bytes);
        attachments += 1;
        written.push(path);
      }

      // Remove old locations only after every target is written, so a failed
      // import never leaves a note in neither location.
      for (const stalePath of stalePaths) {
        failedPath = stalePath;
        await this.removeDocument(stalePath, expectedHashes.get(stalePath));
        deleted.push(stalePath);
      }
    } catch (error) {
      if (written.length === 0 && deleted.length === 0) throw error;
      const paths = [...new Set([...written, ...deleted, ...(failedPath === undefined ? [] : [failedPath])])];
      throw new StorageError(
        'PARTIAL_WRITE',
        `Import stopped after changing ${written.length + deleted.length} path(s); inspect all reported paths before manual recovery: ${describe(error)}`,
        {
          cause: error,
          details: { paths },
        },
      );
    }

    return { notes, databases, databaseViews, ...(attachments === 0 ? {} : { attachments }) };
  }

  private async assertImportTargetUnchanged(path: string, expectedHash: string | undefined): Promise<void> {
    const absolute = await this.validateInternalPath(path);
    if (!(await pathExists(absolute))) {
      if (expectedHash !== undefined) throw importTargetChanged(path);
      return;
    }
    if (expectedHash === undefined) throw importTargetChanged(path);
    const current = await this.readBytesAt(absolute, path);
    if (sha256Hex(current) !== expectedHash) throw importTargetChanged(path);
  }

  private async removeDocument(path: string, expectedHash: string | undefined): Promise<void> {
    const absolute = await this.validateReadPath(path);
    await this.assertImportTargetUnchanged(path, expectedHash);
    try {
      await unlink(absolute);
    } catch (error) {
      throw storageFailure(error, 'Remove imported file', path);
    }
  }

  private async parseNotesStrict(): Promise<ParsedNote[]> {
    const { entries } = await walkVault(this.root);
    const parsed: ParsedNote[] = [];
    const seen = new Map<string, string>();

    for (const entry of entries) {
      if (entry.kind !== 'note') continue;

      let note: Note;
      let text: string;
      let bytes: Buffer;
      try {
        bytes = await this.readBytes(entry);
        text = decodeVaultText(bytes, entry.path);
        note = parseNote(text, entry.path);
      } catch (error) {
        throw wrapContentError(error, entry.path);
      }

      const previous = seen.get(note.id);
      if (previous !== undefined) {
        throw new StorageError(
          'DUPLICATE_ID',
          `Note ID "${note.id}" is used by both "${previous}" and "${entry.path}"`,
          { details: { ids: [note.id], paths: [previous, entry.path] } },
        );
      }

      seen.set(note.id, entry.path);
      parsed.push({ note, text, bytes });
    }

    return parsed;
  }

  private async parseDatabasesStrict(): Promise<ParsedDatabase[]> {
    const { entries, issues } = await walkVault(this.root);
    const reservedIssue = issues.find((issue) => issue.path.startsWith('databases/'));
    if (reservedIssue !== undefined) {
      throw new StorageError('INVALID_CONTENT', reservedIssue.message, { path: reservedIssue.path });
    }
    const parsed: ParsedDatabase[] = [];

    for (const entry of entries) {
      if (entry.kind !== 'database') continue;

      let database: DatabaseDefinition;
      let text: string;
      let bytes: Buffer;
      try {
        bytes = await this.readBytes(entry);
        text = decodeVaultText(bytes, entry.path);
        database = parseDatabase(text);
      } catch (error) {
        throw wrapContentError(error, entry.path);
      }

      const expected = databasePath(database.id);
      if (entry.path !== expected) {
        throw new StorageError(
          'INVALID_CONTENT',
          `Database ID "${database.id}" must be stored at "${expected}", found "${entry.path}"`,
          { path: entry.path, details: { ids: [database.id], paths: [entry.path] } },
        );
      }

      parsed.push({ database, text, bytes });
    }

    return parsed;
  }

  private async parseDatabaseViewsStrict(): Promise<ParsedDatabaseView[]> {
    const { entries, issues } = await walkVault(this.root);
    const issue = issues.find((item) => item.path === 'database-views' || item.path.startsWith('database-views/'));
    if (issue) throw new StorageError('INVALID_CONTENT', issue.message, { path: issue.path });
    const parsed: ParsedDatabaseView[] = [];
    const ids = new Map<string, string>();
    for (const entry of entries) {
      if (entry.kind !== 'database-view') continue;
      let view: DatabaseView; let text: string; let bytes: Buffer;
      try { bytes = await this.readBytes(entry); text = decodeVaultText(bytes, entry.path); view = parseDatabaseView(text); }
      catch (error) { throw wrapContentError(error, entry.path); }
      const expected = databaseViewPath(view.databaseId, view.id);
      if (entry.path !== expected) throw new StorageError('INVALID_CONTENT', `Saved view must be stored at "${expected}", found "${entry.path}"`, { path: entry.path, details: { ids: [view.databaseId, view.id], paths: [entry.path, expected] } });
      const previous = ids.get(view.id);
      if (previous !== undefined) throw new StorageError('DUPLICATE_ID', `Saved view ID "${view.id}" is used by both "${previous}" and "${entry.path}"`, { details: { ids: [view.id], paths: [previous, entry.path] } });
      ids.set(view.id, entry.path);
      parsed.push({ view, text, bytes, path: entry.path });
    }
    return parsed;
  }

  private async findNote(id: string): Promise<ParsedNote> {
    return this.locateNote(id);
  }

  private async locateNote(id: string): Promise<ParsedNote> {
    const { entries } = await walkVault(this.root);
    const failures: StorageError[] = [];
    let found: ParsedNote | undefined;

    for (const entry of entries) {
      if (entry.kind !== 'note') continue;

      let note: Note;
      let text: string;
      let bytes: Buffer;
      try {
        bytes = await this.readBytes(entry);
        text = decodeVaultText(bytes, entry.path);
        note = parseNote(text, entry.path);
      } catch (error) {
        failures.push(wrapContentError(error, entry.path));
        continue;
      }

      if (note.id !== id) continue;

      if (found !== undefined) {
        throw new StorageError('DUPLICATE_ID', `Note ID "${id}" is used by more than one file`, {
          details: { ids: [id], paths: [found.note.path, entry.path] },
        });
      }
      found = { note, text, bytes };
    }

    if (found !== undefined) return found;
    const firstFailure = failures[0];
    if (firstFailure !== undefined) throw firstFailure;
    throw NOTE_NOT_FOUND(id);
  }

  private serializeDatabaseInput(database: DatabaseDefinition): string {
    try {
      return serializeDatabase(database);
    } catch (error) {
      throw wrapInputError(error, 'Invalid database definition');
    }
  }

  private serializeDatabaseViewInput(view: DatabaseView): string {
    try { return serializeDatabaseView(view); } catch (error) { throw wrapInputError(error, 'Invalid saved view'); }
  }

  private async validateDatabaseViewSchema(view: DatabaseView, expectedHash?: string): Promise<void> {
    let stored: { database: DatabaseDefinition; hash: string };
    try { stored = await this.readDatabaseWithHash(view.databaseId); }
    catch (error) { throw wrapInputError(error, 'Saved view database is unavailable'); }
    if (expectedHash !== undefined && expectedHash !== stored.hash) throw staleWrite(databasePath(view.databaseId), stored.hash);
    try { validateViewReferences(view, stored.database); }
    catch (error) { throw wrapInputError(error, 'Invalid saved view references'); }
  }

  private serializeNoteInput(note: Note): string {
    try {
      return serializeNote(note);
    } catch (error) {
      throw wrapInputError(error, 'Invalid note');
    }
  }

  private async validateReadPath(path: string): Promise<string> {
    return this.validateDocumentPath(path);
  }

  private async validateDocumentPath(path: string): Promise<string> {
    let valid: string;
    try {
      valid = validateNotePath(path);
    } catch (error) {
      throw wrapInputError(error, 'Invalid path');
    }
    return this.validateInternalPath(valid);
  }

  /** For Nodus-owned paths built from validated IDs, such as database files. */
  private async validateInternalPath(path: string): Promise<string> {
    const absolute = resolveInsideRoot(this.root, path);
    await assertInsideRoot(this.root, absolute, path);
    // The scanner excludes directory symlinks even when they stay inside the root.
    let component = this.root;
    for (const segment of path.split('/')) {
      component = join(component, segment);
      await assertNotSymlink(component, path);
    }
    return absolute;
  }

  private async validateNoteTarget(path: string): Promise<string> {
    const absolute = await this.validateDocumentPath(path);
    if (path.split('/').some((segment) => segment.startsWith('.'))) {
      throw new StorageError('UNSAFE_PATH', `Hidden note path "${path}" is excluded from the vault`, {
        path,
      });
    }
    if (isReservedNotePath(path.toLowerCase())) {
      throw new StorageError(
        'INVALID_INPUT',
        `Path "${path}" is reserved for Nodus database metadata`,
        { path, details: { paths: [path] } },
      );
    }
    if (path.split('/')[0]?.normalize('NFC').toLowerCase() === ATTACHMENTS_DIR) {
      const attachmentDirectory = resolveInsideRoot(this.root, ATTACHMENTS_DIR);
      if (await pathExists(attachmentDirectory) && await isManagedAttachmentDirectory(attachmentDirectory)) {
        throw new StorageError('INVALID_INPUT', `Path "${path}" is reserved for managed attachments`, { path });
      }
    }
    return absolute;
  }

  /**
 * Re-hashes the file immediately before a conditional write. No-op when
 * `expectedHash` was not supplied. Public mutations hold the shared root lock.
   */
  private async assertUnchanged(
    absolute: string,
    path: string,
    expectedHash: string | undefined,
  ): Promise<void> {
    if (expectedHash === undefined) return;
    const bytes = await this.readBytesAt(absolute, path);
    const current = sha256Hex(bytes);
    if (current !== expectedHash) throw staleWrite(path, current);
  }

  private async writeDocument(
    path: string,
    text: string | Uint8Array,
    allowReserved = false,
    beforeWrite?: () => Promise<void>,
  ): Promise<void> {
    const absolute = allowReserved
      ? await this.validateInternalPath(path)
      : await this.validateNoteTarget(path);
    await beforeWrite?.();
    try {
      await writeFileAtomic(absolute, text);
    } catch (error) {
      throw storageFailure(error, 'Write file', path);
    }
  }

  private async readText(entry: WalkEntry): Promise<string> {
    return this.readTextAt(entry.absolute, entry.path);
  }

  private async readBytes(entry: WalkEntry): Promise<Buffer> {
    return this.readBytesAt(entry.absolute, entry.path);
  }

  private async readTextAt(absolute: string, relativePath: string): Promise<string> {
    return decodeVaultText(await this.readBytesAt(absolute, relativePath), relativePath);
  }

  private async readBytesAt(absolute: string, relativePath: string): Promise<Buffer> {
    // A symlink swapped in after the directory walk would let one read escape
    // the vault, so assert before reading.
    await assertNotSymlink(absolute, relativePath);
    try {
      return await readFile(absolute);
    } catch (error) {
      if (isMissing(error)) {
        throw new StorageError('NOT_FOUND', `File "${relativePath}" was not found`, {
          path: relativePath,
        });
      }
      throw storageFailure(error, 'Read file', relativePath);
    }
  }
}

function decodeVaultText(bytes: Uint8Array, path: string): string {
  try {
    // Keep a valid BOM in raw text; the Markdown parser handles it separately.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new StorageError('INVALID_CONTENT', `File "${path}" is not valid UTF-8 text`, { path });
  }
}

function summaryOf(note: Note): NoteSummary {
  return { id: note.id, path: note.path, title: note.title, updatedAt: note.updatedAt };
}

function contentIssue(error: unknown, path: string): StorageIssue {
  const wrapped = wrapContentError(error, path);
  return {
    code: wrapped.code === 'UNSUPPORTED_VERSION' ? 'UNSUPPORTED_VERSION' : 'INVALID_CONTENT',
    path,
    message: wrapped.message,
  };
}

function sortByPath<T extends { path: string }>(items: T[]): T[] {
  return items.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

function foldPath(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

/** Mutex key: absolute path, case-folded so Windows path variants share one lock. */
function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function importTargetChanged(path: string): StorageError {
  return new StorageError('CONFLICT', `Import target "${path}" changed after preflight; no further write occurred`, {
    path,
    details: { paths: [path] },
  });
}
