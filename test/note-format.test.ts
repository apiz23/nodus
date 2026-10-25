import { describe, expect, it } from 'vitest';
import { createNote, type Note } from '../src/domain/note.js';
import { parseNote, serializeNote } from '../src/format/note-format.js';
import validNote from './fixtures/valid-note.md?raw';
import minimalNote from './fixtures/minimal-note.md?raw';
import emptyBodyNote from './fixtures/empty-body-note.md?raw';
import unknownFieldsNote from './fixtures/unknown-fields-note.md?raw';
import noIdNote from './fixtures/note-no-id.md?raw';
import futureVersionNote from './fixtures/note-future-version.md?raw';
import malformedYamlNote from './fixtures/note-malformed-yaml.md?raw';
import { errorCode } from './helpers.js';

const ID = '6f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c';
const NOW = '2026-10-25T09:00:00Z';

function frontmatter(extra: string, nodusExtra = ''): string {
  return `---\ntitle: Test\n${extra}nodus:\n  version: 1\n  id: ${ID}\n  createdAt: ${NOW}\n  updatedAt: ${NOW}\n${nodusExtra}---\n`;
}

describe('parseNote', () => {
  it('parses the full valid fixture into domain fields', () => {
    const note = parseNote(validNote, 'notes/roadmap.md');
    expect(note).toEqual({
      id: ID,
      title: 'Nodus roadmap',
      path: 'notes/roadmap.md',
      body: validNote.slice(validNote.indexOf('\n---\n') + 5),
      createdAt: NOW,
      updatedAt: '2026-10-25T10:30:00Z',
      tags: ['planning', 'phase-1'],
      aliases: ['Roadmap'],
      extraFrontmatter: {},
    });
  });

  it('defaults optional tags and aliases to empty arrays', () => {
    const note = parseNote(minimalNote, 'minimal.md');
    expect(note.tags).toEqual([]);
    expect(note.aliases).toEqual([]);
    expect(note.body).toBe('Just a body, no heading.\n');
  });

  it('parses an empty body', () => {
    expect(parseNote(emptyBodyNote, 'empty.md').body).toBe('');
  });

  it('strips a UTF-8 byte order mark and does not keep it in the body', () => {
    const note = parseNote(`\uFEFF${frontmatter('')}Body\n`, 'bom.md');
    expect(note.title).toBe('Test');
    expect(note.body).toBe('Body\n');
  });

  it('preserves CRLF line endings, code fences, links, and Unicode in the body byte-for-byte', () => {
    const body = '# Título\r\n\r\n```ts\r\nconst x = "[[Link]]";\r\n```\r\n\r\n日本語 🙂 [[Target|Alias]]\r\n';
    const note = parseNote(`${frontmatter('')}${body}`, 'crlf.md');
    expect(note.body).toBe(body);
  });

  it('accepts CRLF frontmatter delimiters', () => {
    const source = `---\r\ntitle: Windows\r\nnodus:\r\n  version: 1\r\n  id: ${ID}\r\n  createdAt: ${NOW}\r\n  updatedAt: ${NOW}\r\n---\r\nBody\r\n`;
    const note = parseNote(source, 'windows.md');
    expect(note.title).toBe('Windows');
    expect(note.body).toBe('Body\r\n');
  });

  it('keeps unknown top-level keys in extraFrontmatter', () => {
    const note = parseNote(unknownFieldsNote, 'unknown.md');
    expect(note.extraFrontmatter).toEqual({
      project: 'Research',
      priority: 2,
      owner: { name: 'Hafizuddin' },
    });
  });

  it('rejects a file without frontmatter', () => {
    expect(errorCode(() => parseNote('# Just markdown\n', 'plain.md'))).toBe('INVALID_FRONTMATTER');
  });

  it('rejects unclosed frontmatter', () => {
    const source = `---\ntitle: Open\nnodus:\n  version: 1\n  id: ${ID}\n`;
    expect(errorCode(() => parseNote(source, 'open.md'))).toBe('INVALID_FRONTMATTER');
  });

  it('rejects malformed YAML', () => {
    expect(errorCode(() => parseNote(malformedYamlNote, 'bad.md'))).toBe('INVALID_FRONTMATTER');
  });

  it('rejects duplicate YAML keys', () => {
    const source = `---\ntitle: One\ntitle: Two\nnodus:\n  version: 1\n  id: ${ID}\n  createdAt: ${NOW}\n  updatedAt: ${NOW}\n---\n`;
    expect(errorCode(() => parseNote(source, 'dup.md'))).toBe('INVALID_FRONTMATTER');
  });

  it('rejects YAML aliases and anchors', () => {
    const source = `---\ntitle: &t Ref\ncopy: *t\nnodus:\n  version: 1\n  id: ${ID}\n  createdAt: ${NOW}\n  updatedAt: ${NOW}\n---\n`;
    expect(errorCode(() => parseNote(source, 'alias.md'))).toBe('INVALID_FRONTMATTER');
  });

  it('rejects frontmatter that is not a mapping', () => {
    expect(errorCode(() => parseNote('---\n- one\n- two\n---\n', 'list.md'))).toBe('INVALID_FRONTMATTER');
  });

  it('rejects an unknown key under nodus', () => {
    const source = frontmatter('', '  surprise: true\n');
    expect(errorCode(() => parseNote(source, 'x.md'))).toBe('INVALID_FRONTMATTER');
  });

  it('rejects a note missing nodus.id', () => {
    expect(errorCode(() => parseNote(noIdNote, 'no-id.md'))).toBe('INVALID_FIELD');
  });

  it('rejects a note without a nodus block', () => {
    expect(errorCode(() => parseNote('---\ntitle: Bare\n---\n', 'bare.md'))).toBe('INVALID_FIELD');
  });

  it('rejects a missing title', () => {
    const source = `---\nnodus:\n  version: 1\n  id: ${ID}\n  createdAt: ${NOW}\n  updatedAt: ${NOW}\n---\n`;
    expect(errorCode(() => parseNote(source, 'x.md'))).toBe('INVALID_FIELD');
  });

  it('rejects a non-string title', () => {
    expect(errorCode(() => parseNote(frontmatter('').replace('title: Test', 'title: 42'), 'x.md'))).toBe(
      'INVALID_FIELD',
    );
  });

  it('rejects a title with surrounding whitespace', () => {
    expect(errorCode(() => parseNote(frontmatter('').replace('title: Test', 'title: " Test "'), 'x.md'))).toBe(
      'INVALID_FIELD',
    );
  });

  it('rejects a title that looks like a UUID', () => {
    expect(errorCode(() => parseNote(frontmatter('').replace('title: Test', `title: ${ID}`), 'x.md'))).toBe(
      'INVALID_FIELD',
    );
  });

  it('rejects a non-UUID nodus.id', () => {
    expect(errorCode(() => parseNote(frontmatter('').replace(ID, 'not-a-uuid'), 'x.md'))).toBe('INVALID_FIELD');
  });

  it('rejects a UUID that is not version 4', () => {
    const v1 = '6f1c2a9e-3b7d-1c8e-9f0a-1d2e3f4a5b6c';
    expect(errorCode(() => parseNote(frontmatter('').replace(ID, v1), 'x.md'))).toBe('INVALID_FIELD');
  });

  it('rejects an uppercase UUID', () => {
    expect(errorCode(() => parseNote(frontmatter('').replace(ID, ID.toUpperCase()), 'x.md'))).toBe('INVALID_FIELD');
  });

  it('rejects a timestamp without a trailing Z', () => {
    expect(
      errorCode(() => parseNote(frontmatter('').replace(`createdAt: ${NOW}`, 'createdAt: 2026-10-25T09:00:00'), 'x.md')),
    ).toBe('INVALID_FIELD');
  });

  it('rejects a timestamp that is not a real date', () => {
    expect(
      errorCode(() => parseNote(frontmatter('').replace(`createdAt: ${NOW}`, 'createdAt: 2026-02-30T09:00:00Z'), 'x.md')),
    ).toBe('INVALID_FIELD');
  });

  it('rejects an unsafe note path before parsing', () => {
    expect(errorCode(() => parseNote(validNote, '../escape.md'))).toBe('UNSAFE_PATH');
  });

  it('rejects a nodus.version that is not an integer', () => {
    expect(errorCode(() => parseNote(frontmatter('').replace('version: 1', 'version: "1"'), 'x.md'))).toBe(
      'INVALID_FIELD',
    );
  });

  it('rejects nodus.version 0', () => {
    expect(errorCode(() => parseNote(frontmatter('').replace('version: 1', 'version: 0'), 'x.md'))).toBe(
      'INVALID_FIELD',
    );
  });

  it('rejects a future format version without parsing the rest', () => {
    expect(errorCode(() => parseNote(futureVersionNote, 'future.md'))).toBe('UNSUPPORTED_VERSION');
  });

  it('rejects tags that are not an array of non-empty strings', () => {
    expect(errorCode(() => parseNote(frontmatter('tags: planning\n'), 'x.md'))).toBe('INVALID_FIELD');
    expect(errorCode(() => parseNote(frontmatter('tags:\n  - ""\n'), 'x.md'))).toBe('INVALID_FIELD');
  });

  it('rejects aliases that are not an array of strings', () => {
    expect(errorCode(() => parseNote(frontmatter('aliases:\n  - 7\n'), 'x.md'))).toBe('INVALID_FIELD');
  });
});

describe('serializeNote', () => {
  it('writes the canonical valid fixture back byte-for-byte', () => {
    expect(serializeNote(parseNote(validNote, 'notes/roadmap.md'))).toBe(validNote);
  });

  it('writes the canonical minimal fixture back byte-for-byte', () => {
    expect(serializeNote(parseNote(minimalNote, 'minimal.md'))).toBe(minimalNote);
  });

  it('writes the canonical empty-body fixture back byte-for-byte', () => {
    expect(serializeNote(parseNote(emptyBodyNote, 'empty.md'))).toBe(emptyBodyNote);
  });

  it('round-trips a note through serialize and parse with equal fields', () => {
    const note = parseNote(unknownFieldsNote, 'unknown.md');
    expect(parseNote(serializeNote(note), note.path)).toEqual(note);
  });

  it('keeps unknown fields through a serialize and parse cycle', () => {
    const once = serializeNote(parseNote(unknownFieldsNote, 'unknown.md'));
    expect(parseNote(once, 'unknown.md').extraFrontmatter).toEqual({
      project: 'Research',
      priority: 2,
      owner: { name: 'Hafizuddin' },
    });
  });

  it('writes LF line endings in frontmatter and keeps the body verbatim', () => {
    const note = parseNote(`---\r\ntitle: Win\r\nnodus:\r\n  version: 1\r\n  id: ${ID}\r\n  createdAt: ${NOW}\r\n  updatedAt: ${NOW}\r\n---\r\nBody\r\n`, 'win.md');
    const output = serializeNote(note);
    expect(output.startsWith('---\ntitle: Win\n')).toBe(true);
    expect(output.endsWith('---\nBody\r\n')).toBe(true);
  });

  it('omits empty tags and aliases', () => {
    const output = serializeNote(parseNote(minimalNote, 'minimal.md'));
    expect(output).not.toContain('tags:');
    expect(output).not.toContain('aliases:');
  });

  it('rejects an extraFrontmatter key that collides with a Nodus-owned key', () => {
    const note = parseNote(minimalNote, 'minimal.md');
    const conflicting = { ...note, extraFrontmatter: { nodus: { version: 1 } } };
    expect(errorCode(() => serializeNote(conflicting))).toBe('INVALID_FIELD');
  });
});

describe('identity across rename and move', () => {
  it('keeps the same id when the same content is parsed from a different path', () => {
    expect(parseNote(validNote, 'notes/a.md').id).toBe(parseNote(validNote, 'archive/b.md').id);
  });

  it('keeps the id when the title changes on serialize and parse', () => {
    const note = parseNote(minimalNote, 'minimal.md');
    const renamed = parseNote(serializeNote({ ...note, title: 'Renamed note' }), 'minimal.md');
    expect(renamed.title).toBe('Renamed note');
    expect(renamed.id).toBe(note.id);
  });

  it('keeps the id when the path changes on serialize and parse', () => {
    const note = parseNote(minimalNote, 'minimal.md');
    const moved = parseNote(serializeNote(note), 'projects/moved.md');
    expect(moved.id).toBe(note.id);
    expect(moved.path).toBe('projects/moved.md');
  });
});

describe('createNote', () => {
  it('sets createdAt and updatedAt to the given time and defaults the optional fields', () => {
    const note = createNote({ id: ID, title: 'New', path: 'new.md', body: '', now: NOW });
    expect(note).toEqual({
      id: ID,
      title: 'New',
      path: 'new.md',
      body: '',
      createdAt: NOW,
      updatedAt: NOW,
      tags: [],
      aliases: [],
      extraFrontmatter: {},
    } satisfies Note);
  });

  it('rejects a non-UUID id', () => {
    expect(errorCode(() => createNote({ id: 'x', title: 'New', path: 'new.md', body: '', now: NOW }))).toBe(
      'INVALID_FIELD',
    );
  });

  it('rejects an unsafe path', () => {
    expect(errorCode(() => createNote({ id: ID, title: 'New', path: '/new.md', body: '', now: NOW }))).toBe(
      'UNSAFE_PATH',
    );
  });
});
