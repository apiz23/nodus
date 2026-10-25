import { parseDocument, stringify } from 'yaml';
import { NodusError } from '../domain/errors.js';
import { NOTE_FORMAT_VERSION, type Note, validateNote } from '../domain/note.js';
import { validateNotePath } from '../domain/paths.js';

const KNOWN_TOP_LEVEL_KEYS = new Set(['title', 'tags', 'aliases', 'nodus']);
const NODUS_KEYS = new Set(['version', 'id', 'createdAt', 'updatedAt']);

export function parseNote(source: string, path: string): Note {
  validateNotePath(path);
  const { yaml, body } = splitFrontmatter(source);
  const data = parseFrontmatterYaml(yaml);

  const nodus = data.nodus;
  if (!isPlainObject(nodus)) {
    throw new NodusError('INVALID_FIELD', 'Missing nodus metadata block');
  }

  const version = nodus.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new NodusError('INVALID_FIELD', 'nodus.version must be a positive integer');
  }
  if (version > NOTE_FORMAT_VERSION) {
    throw new NodusError(
      'UNSUPPORTED_VERSION',
      `Note format version ${version} is newer than supported version ${NOTE_FORMAT_VERSION}; upgrade Nodus to read it`,
    );
  }
  for (const key of Object.keys(nodus)) {
    if (!NODUS_KEYS.has(key)) {
      throw new NodusError('INVALID_FRONTMATTER', `Unknown key "nodus.${key}"`);
    }
  }

  const extraFrontmatter: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) extraFrontmatter[key] = value;
  }

  const note: Note = {
    id: requireString(nodus.id, 'nodus.id'),
    title: requireString(data.title, 'title'),
    path,
    body,
    createdAt: requireString(nodus.createdAt, 'nodus.createdAt'),
    updatedAt: requireString(nodus.updatedAt, 'nodus.updatedAt'),
    tags: optionalStringArray(data.tags, 'tags'),
    aliases: optionalStringArray(data.aliases, 'aliases'),
    extraFrontmatter,
  };
  validateNote(note);
  return note;
}

export function serializeNote(note: Note): string {
  validateNote(note);
  for (const key of Object.keys(note.extraFrontmatter)) {
    if (KNOWN_TOP_LEVEL_KEYS.has(key)) {
      throw new NodusError('INVALID_FIELD', `extraFrontmatter key "${key}" collides with a Nodus-owned key`);
    }
  }

  const frontmatter: Record<string, unknown> = { title: note.title };
  if (note.tags.length > 0) frontmatter.tags = note.tags;
  if (note.aliases.length > 0) frontmatter.aliases = note.aliases;
  frontmatter.nodus = {
    version: NOTE_FORMAT_VERSION,
    id: note.id,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
  for (const [key, value] of Object.entries(note.extraFrontmatter)) {
    frontmatter[key] = value;
  }

  return `---\n${stringify(frontmatter, { lineWidth: 0 })}---\n${note.body}`;
}

function splitFrontmatter(source: string): { yaml: string; body: string } {
  const text = source.startsWith('\uFEFF') ? source.slice(1) : source;
  const opening = /^---\r?\n/.exec(text);
  if (!opening) {
    throw new NodusError('INVALID_FRONTMATTER', 'Note must start with a "---" frontmatter line');
  }

  let lineStart = opening[0].length;
  for (;;) {
    const newline = text.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(lineStart, lineEnd).replace(/\r$/, '');
    if (line === '---') {
      return {
        yaml: text.slice(opening[0].length, lineStart),
        body: newline === -1 ? '' : text.slice(newline + 1),
      };
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  throw new NodusError('INVALID_FRONTMATTER', 'Frontmatter is not closed by a "---" line');
}

function parseFrontmatterYaml(yaml: string): Record<string, unknown> {
  const document = parseDocument(yaml, { schema: 'core', uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new NodusError('INVALID_FRONTMATTER', `Invalid YAML: ${document.errors[0]?.message ?? 'unknown error'}`);
  }

  let data: unknown;
  try {
    data = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new NodusError('INVALID_FRONTMATTER', `Invalid YAML: ${String(error)}`);
  }
  if (data === null || data === undefined) return {};
  if (!isPlainObject(data)) {
    throw new NodusError('INVALID_FRONTMATTER', 'Frontmatter must be a YAML mapping');
  }
  return data;
}

function requireString(value: unknown, field: string): string {
  if (value === undefined) throw new NodusError('INVALID_FIELD', `${field} is required`);
  if (typeof value !== 'string') throw new NodusError('INVALID_FIELD', `${field} must be a string`);
  return value;
}

function optionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new NodusError('INVALID_FIELD', `${field} must be an array of strings`);
  }
  return [...value];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
