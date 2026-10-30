import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { addTag, normalizeTag, normalizeTagList, removeTag, TagValidationError, tagIdentity } from '../src/domain/tags.js';
import { parseNote, serializeNote } from '../src/format/note-format.js';

const ID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-10-25T12:00:00Z';

describe('tag contract', () => {
  it('normalizes new tags to NFC and trims whitespace without changing case', () => {
    expect(normalizeTag('  Cafe\u0301  ')).toBe('Café');
    expect(tagIdentity(' Café ')).toBe(tagIdentity('cafe\u0301'));
  });

  it('rejects empty and case-insensitive duplicate tags', () => {
    expect(() => normalizeTag(' \t ')).toThrow(TagValidationError);
    expect(() => normalizeTagList(['Nodus', ' nodus '])).toThrow(/already in this list/i);
  });

  it('preserves the first existing display spelling and requested order on replacement', () => {
    expect(normalizeTagList(['Second', 'nodus', 'first'], ['Nodus', 'NODUS', 'First'])).toEqual(['Second', 'Nodus', 'First']);
  });

  it('appends normalized values, rejects duplicate additions, and removes all matching legacy duplicates', () => {
    const legacy = [' Nodus ', 'nodus', 'Cafe\u0301'];
    expect(addTag(legacy, ' New ')).toEqual([...legacy, 'New']);
    expect(() => addTag(legacy, 'NODUS')).toThrow(/already exists/i);
    expect(removeTag(legacy, 'Nodus')).toEqual(['Cafe\u0301']);
  });

  it('normalizes optional initial tags without changing the note format', () => {
    const note = createNote({ id: ID, title: 'Tagged', path: 'tagged.md', body: 'Body', now: NOW, tags: ['  Café ', '日本語'] });
    expect(note.tags).toEqual(['Café', '日本語']);
    expect(parseNote(serializeNote(note), note.path).tags).toEqual(['Café', '日本語']);
  });

  it('reads and writes legacy duplicate, decomposed, and padded tags without silent normalization', () => {
    const source = `---\ntitle: Legacy tags\ntags:\n  - " Nodus "\n  - nodus\n  - "Cafe\u0301"\naliases:\n  - Alternate title\nnodus:\n  version: 1\n  id: ${ID}\n  createdAt: ${NOW}\n  updatedAt: ${NOW}\n---\nBody stays.\n`;
    const note = parseNote(source, 'legacy.md');
    expect(note.tags).toEqual([' Nodus ', 'nodus', 'Cafe\u0301']);
    expect(parseNote(serializeNote(note), note.path).tags).toEqual(note.tags);
    expect(note.aliases).toEqual(['Alternate title']);
  });
});
