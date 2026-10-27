import { NodusError } from './errors.js';
import { isUuidShaped, isUuidV4 } from './ids.js';
import { validateNotePath } from './paths.js';

export const NOTE_FORMAT_VERSION = 1;

export interface Note {
  id: string;
  title: string;
  path: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  aliases: string[];
  extraFrontmatter: Record<string, unknown>;
  /** Set only for Markdown files that do not contain valid Nodus frontmatter. */
  sourceFormat?: 'plain-markdown';
}

export interface CreateNoteInput {
  id: string;
  title: string;
  path: string;
  body: string;
  now: string;
  tags?: string[];
  aliases?: string[];
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export function isTimestamp(value: string): boolean {
  if (!TIMESTAMP.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value.replace('Z', '.000Z');
}

export function validateNote(note: Note): void {
  if (!isUuidV4(note.id)) {
    throw invalidField(`id "${note.id}" must be a lowercase UUID v4`);
  }
  validateTitle(note.title);
  validateNotePath(note.path);
  validateTimestamp('createdAt', note.createdAt);
  validateTimestamp('updatedAt', note.updatedAt);
  validateStrings('tags', note.tags);
  validateStrings('aliases', note.aliases);
}

export function createNote(input: CreateNoteInput): Note {
  const note: Note = {
    id: input.id,
    title: input.title,
    path: input.path,
    body: input.body,
    createdAt: input.now,
    updatedAt: input.now,
    tags: input.tags ?? [],
    aliases: input.aliases ?? [],
    extraFrontmatter: {},
  };
  validateNote(note);
  return note;
}

function validateTitle(title: string): void {
  if (title.trim() === '') throw invalidField('title must not be empty');
  if (title.trim() !== title) throw invalidField('title must not have leading or trailing whitespace');
  if (/[\r\n]/.test(title)) throw invalidField('title must be a single line');
  if (isUuidShaped(title)) throw invalidField('title must not look like a UUID');
}

function validateTimestamp(field: string, value: string): void {
  if (!isTimestamp(value)) {
    throw invalidField(`${field} must be an RFC 3339 UTC timestamp ending in Z, such as 2026-10-25T09:00:00Z`);
  }
}

function validateStrings(field: string, values: readonly string[]): void {
  for (const value of values) {
    if (value.trim() === '' || value.trim() !== value) {
      throw invalidField(`${field} entries must be non-empty and trimmed`);
    }
  }
}

function invalidField(message: string): NodusError {
  return new NodusError('INVALID_FIELD', message);
}
