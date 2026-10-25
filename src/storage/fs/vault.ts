import { mkdir, readFile, realpath, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  DatabaseStore,
  DatabaseSummary,
  ImportOptions,
  ImportPlan,
  ImportReport,
  NoteStore,
  NoteSummary,
  StorageHealth,
  StorageIssue,
  VaultEntry,
  VaultStorage,
} from '../contracts.js';
import type { DatabaseDefinition } from '../../database/schema.js';
import { parseDatabase, serializeDatabase } from '../../database/schema.js';
import { isUuidV4 } from '../../domain/ids.js';
import type { Note } from '../../domain/note.js';
import { validateNote } from '../../domain/note.js';
import { validateNotePath } from '../../domain/paths.js';
import { parseNote, serializeNote } from '../../format/note-format.js';
import { StorageError, storageFailure, wrapContentError, wrapInputError } from '../errors.js';
import { writeFileAtomic } from './atomic.js';
import { databasePath, isReservedNotePath } from './layout.js';
import { assertInsideRoot, assertNotSymlink, pathExists, resolveInsideRoot } from './safe-path.js';
import { walkVault, type WalkEntry } from './scan.js';

interface ParsedNote {
  note: Note;
  text: string;
}

interface ParsedDatabase {
  database: DatabaseDefinition;
  text: string;
}

const NOTE_NOT_FOUND = (id: string) =>
  new StorageError('NOT_FOUND', `Note "${id}" was not found`, { details: { ids: [id] } });

const DATABASE_NOT_FOUND = (id: string) =>
  new StorageError('NOT_FOUND', `Database "${id}" was not found`, { details: { ids: [id] } });

/**
 * Filesystem-backed Markdown vault.
 *
 * Notes live at their Phase 1 relative paths; database definitions live at
 * `databases/<id>.json`. All writes go through a temporary sibling and a rename.
 */
export class FileSystemVault implements VaultStorage, NoteStore, DatabaseStore {
  readonly root: string;

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

  async createNote(note: Note): Promise<void> {
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

  async replaceNote(note: Note): Promise<void> {
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

    await this.writeDocument(note.path, this.serializeNoteInput(note));
  }

  async moveNote(id: string, toPath: string): Promise<Note> {
    const current = await this.findNote(id);
    if (toPath === current.note.path) return current.note;

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

    await this.writeDocument(toPath, current.text);

    try {
      await unlink(resolveInsideRoot(this.root, current.note.path));
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
  }

  async deleteNote(id: string): Promise<void> {
    const current = await this.findNote(id);
    try {
      await unlink(resolveInsideRoot(this.root, current.note.path));
    } catch (error) {
      if (isMissing(error)) throw NOTE_NOT_FOUND(id);
      throw storageFailure(error, 'Delete note', current.note.path);
    }
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
    if (!isUuidV4(id)) throw DATABASE_NOT_FOUND(id);
    const path = databasePath(id);
    const absolute = await this.validateInternalPath(path);
    const text = await this.readTextAt(absolute, path);

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
    return database;
  }

  async createDatabase(database: DatabaseDefinition): Promise<void> {
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
  }

  async replaceDatabase(database: DatabaseDefinition): Promise<void> {
    const text = this.serializeDatabaseInput(database);
    const path = databasePath(database.id);
    const absolute = await this.validateInternalPath(path);
    if (!(await pathExists(absolute))) throw DATABASE_NOT_FOUND(database.id);
    await this.writeDocument(path, text, true);
  }

  async deleteDatabase(id: string): Promise<void> {
    if (!isUuidV4(id)) throw DATABASE_NOT_FOUND(id);
    try {
      await unlink(resolveInsideRoot(this.root, databasePath(id)));
    } catch (error) {
      if (isMissing(error)) throw DATABASE_NOT_FOUND(id);
      throw storageFailure(error, 'Delete database', databasePath(id));
    }
  }

  async snapshot(): Promise<VaultEntry[]> {
    const notes = await this.parseNotesStrict();
    const databases = await this.parseDatabasesStrict();

    return [
      ...notes.map(({ note, text }) => ({
        kind: 'note' as const,
        id: note.id,
        path: note.path,
        text,
      })),
      ...databases.map(({ database, text }) => ({
        kind: 'database' as const,
        id: database.id,
        path: databasePath(database.id),
        text,
      })),
    ];
  }

  async checkHealth(): Promise<StorageHealth> {
    const { entries, issues } = await walkVault(this.root);
    const notes: NoteSummary[] = [];
    const databases: DatabaseSummary[] = [];
    const notePathsById = new Map<string, string[]>();

    for (const entry of entries) {
      if (entry.kind === 'temp') {
        issues.push({
          code: 'INCOMPLETE_WRITE',
          path: entry.path,
          message: 'Leftover temporary file from an interrupted write; it is safe to delete',
        });
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
      issues: issues.sort((left, right) =>
        left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
      ),
    };
  }

  async applyImport(plan: ImportPlan, options: ImportOptions = {}): Promise<ImportReport> {
    for (const note of plan.notes) {
      try {
        validateNote(note);
      } catch (error) {
        throw wrapInputError(error, `Invalid imported note "${note.path}"`);
      }
    }
    for (const database of plan.databases) {
      this.serializeDatabaseInput(database);
    }

    const noteText = new Map<string, string>();
    const databaseText = new Map<string, string>();
    for (const entry of plan.entries) {
      if (entry.kind === 'note') noteText.set(entry.id, entry.text);
      else databaseText.set(entry.id, entry.text);
    }

    const existingNotes = await this.parseNotesStrict();
    const existingDatabases = await this.parseDatabasesStrict();

    const existingNoteIds = new Map(existingNotes.map(({ note }) => [note.id, note.path] as const));
    const existingNotePaths = new Map(existingNotes.map(({ note }) => [foldPath(note.path), note.path] as const));
    const existingNotePathToId = new Map(existingNotes.map(({ note }) => [foldPath(note.path), note.id] as const));
    const existingDatabaseIds = new Set(existingDatabases.map(({ database }) => database.id));

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

    const plannedPaths = new Set(plan.notes.map((note) => foldPath(note.path)));
    const stalePaths = [
      ...new Set(
        plan.notes
          .map((note) => existingNoteIds.get(note.id))
          .filter((path): path is string => path !== undefined),
      ),
    ].filter((path) => !plannedPaths.has(foldPath(path)));

    const written: string[] = [];
    let notes = 0;
    let databases = 0;

    try {
      for (const note of plan.notes) {
        const text = noteText.get(note.id) ?? this.serializeNoteInput(note);
        await this.writeDocument(note.path, text);
        notes += 1;
        written.push(note.path);
      }

      for (const database of plan.databases) {
        const path = databasePath(database.id);
        const text = databaseText.get(database.id) ?? serializeDatabase(database);
        await this.writeDocument(path, text, true);
        databases += 1;
        written.push(path);
      }

      // Remove old locations only after every target is written, so a failed
      // import never leaves a note in neither location.
      for (const stalePath of stalePaths) {
        await unlink(resolveInsideRoot(this.root, stalePath));
      }
    } catch (error) {
      throw new StorageError(
        'PARTIAL_WRITE',
        `Import stopped after writing ${written.length} file(s); already written files are valid but the import is incomplete: ${describe(error)}`,
        {
          cause: error,
          details: { paths: written },
        },
      );
    }

    return { notes, databases };
  }

  private async parseNotesStrict(): Promise<ParsedNote[]> {
    const { entries } = await walkVault(this.root);
    const parsed: ParsedNote[] = [];
    const seen = new Map<string, string>();

    for (const entry of entries) {
      if (entry.kind !== 'note') continue;

      let note: Note;
      let text: string;
      try {
        text = await this.readText(entry);
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
      parsed.push({ note, text });
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
      try {
        text = await this.readText(entry);
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

      parsed.push({ database, text });
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
      try {
        text = await this.readText(entry);
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
      found = { note, text };
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
    await assertNotSymlink(absolute, path);
    return absolute;
  }

  private async validateNoteTarget(path: string): Promise<string> {
    const absolute = await this.validateDocumentPath(path);
    if (isReservedNotePath(path)) {
      throw new StorageError(
        'INVALID_INPUT',
        `Path "${path}" is reserved for database definitions`,
        { path, details: { paths: [path] } },
      );
    }
    return absolute;
  }

  private async writeDocument(path: string, text: string, allowReserved = false): Promise<void> {
    const absolute = allowReserved
      ? await this.validateInternalPath(path)
      : await this.validateNoteTarget(path);
    try {
      await writeFileAtomic(absolute, text);
    } catch (error) {
      throw storageFailure(error, 'Write file', path);
    }
  }

  private async readText(entry: WalkEntry): Promise<string> {
    return this.readTextAt(entry.absolute, entry.path);
  }

  private async readTextAt(absolute: string, relativePath: string): Promise<string> {
    try {
      return await readFile(absolute, 'utf8');
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

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
