import { describe, expect, it } from 'vitest';
import { createNote, type Note } from '../src/domain/note.js';
import { buildLinkIndex } from '../src/links/link-index.js';
import { createPropertyCatalog } from '../src/properties/catalog.js';
import { buildRetrievalIndex } from '../src/search/retrieval.js';
import { analyzeOrganization, previewOrganizationMove } from '../src/organization/analysis.js';

const now = '2026-11-03T09:00:00Z';
function note(n: number, title: string, body: string, path = `notes/${n}.md`, tags: string[] = [], extraFrontmatter: Record<string, unknown> = {}): Note {
  return { ...createNote({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, title, path, body, now, tags }), extraFrontmatter };
}
function analyze(notes: Note[]) {
  return analyzeOrganization(notes, buildLinkIndex(notes), buildRetrievalIndex(notes.map((item) => ({ id: item.id, title: item.title,
    body: item.body, aliases: item.aliases, tags: item.tags, propertyText: '' }))));
}

describe('smart organization analysis', () => {
  it('finds exact duplicates and bounded near-duplicates with stable explanations and confidence', () => {
    const notes = [
      note(1, 'A', 'Canopy water cycles protect forest soil and support plant growth.'),
      note(2, 'B', 'Canopy water cycles protect forest soil and support plant growth.', 'notes/elsewhere/b.md'),
      note(3, 'C', 'Canopy water cycles protect forest soil and support plant growth for seedlings.'),
      note(4, 'Unrelated', 'A recipe for lemon cake uses flour butter and sugar.'),
    ];
    const first = analyze(notes);
    const second = analyze([...notes].reverse());
    const exact = first.suggestions.find((item) => item.type === 'duplicate' && item.confidence === 1)!;
    expect(exact.affectedNotes).toHaveLength(2);
    expect(exact.evidence[0]).toContain('Exact body match');
    expect(first.suggestions.map((item) => item.id)).toEqual(second.suggestions.map((item) => item.id));
    expect(first.suggestions.every((item) => item.confidence >= 0 && item.confidence <= 1)).toBe(true);
    expect(first.suggestions.some((item) => item.type === 'duplicate' && item.confidence < 1)).toBe(true);
    expect(first.suggestions.some((item) => item.affectedNotes.some((affected) => affected.id === notes[3]!.id))).toBe(false);
  });

  it('recommends useful existing tags from similar notes, ignoring generic tags and title-only matches', () => {
    const notes = [
      note(1, 'Forest overview', 'Canopy water cycles support diverse plants, rich soil, and resilient forests.'),
      note(2, 'Canopy methods', 'Canopy water cycles support diverse plants, rich soil, and resilient forests.', 'notes/research/a.md', ['ecology']),
      note(3, 'Forest study', 'Canopy water cycles support diverse plants, rich soil, and resilient forests.', 'notes/research/b.md', ['ecology']),
      note(4, 'Forest overview', 'A completely separate discussion of ancient pottery and kiln firing.'),
    ];
    const result = analyze(notes);
    const tag = result.suggestions.find((item) => item.type === 'tag' && item.action.type === 'add-tag');
    expect(tag?.action).toMatchObject({ type: 'add-tag', noteId: notes[0]!.id, tag: 'ecology' });
    expect(tag?.evidence.join(' ')).toContain('2 similar notes');
    expect(result.suggestions.some((item) => item.type === 'tag' && item.affectedNotes.some((affected) => affected.id === notes[3]!.id))).toBe(false);
  });

  it('suggests existing folders only when multiple resolved or similar peers support them', () => {
    const root = note(1, 'Canopy overview', 'Canopy ecology studies measure forest water cycles, soil and growth.');
    const linkedA = note(2, 'Canopy field study', 'Canopy ecology studies measure forest water cycles, soil and growth.', 'notes/research/a.md');
    const linkedB = note(3, 'Forest field notes', 'Canopy ecology studies measure forest water cycles, soil and growth.', 'notes/research/b.md');
    root.body = 'Related [[Canopy field study]] and [[Forest field notes]].';
    const result = analyze([root, linkedA, linkedB]);
    const move = result.suggestions.find((item) => item.type === 'folder' && item.action.type === 'preview-move');
    expect(move?.action).toMatchObject({ type: 'preview-move', noteId: root.id, folder: 'notes/research' });
    expect(move?.evidence.join(' ')).toContain('2 linked or content-similar notes');
  });

  it('reports legacy tag spelling variants and registered metadata coverage without mutating notes', () => {
    const notes = [
      note(1, 'One', 'Some useful local content.', 'notes/1.md', ['Research']),
      note(2, 'Two', 'Different useful local content.', 'notes/2.md', ['research'], { status: 'Ready' }),
      note(3, 'Three', 'Another useful local content.', 'notes/3.md', [], { status: 'Ready' }),
      note(4, 'Four', 'More useful local content.', 'notes/4.md', [], { status: 'Ready' }),
      note(5, 'Five', 'Last useful local content.', 'notes/5.md', []),
    ];
    const before = JSON.stringify(notes);
    const catalog = createPropertyCatalog([{ id: '00000000-0000-4000-8000-000000000099', key: 'status', name: 'Status', type: 'text' }]);
    const result = analyzeOrganization(notes, buildLinkIndex(notes), undefined, catalog);
    expect(result.suggestions.some((item) => item.type === 'tag' && item.explanation.includes('Research, research'))).toBe(true);
    expect(result.suggestions.some((item) => item.type === 'metadata' && item.explanation.includes('Five'))).toBe(true);
    expect(JSON.stringify(notes)).toBe(before);
  });

  it('assigns distinct stable IDs to different suggestions affecting the same notes', () => {
    const notes = [
      note(1, 'One', 'A useful note.', 'notes/1.md'),
      note(2, 'Two', 'Another useful note.', 'notes/2.md', [], { status: 'Ready', owner: 'Mina' }),
      note(3, 'Three', 'More useful note.', 'notes/3.md', [], { status: 'Ready', owner: 'Mina' }),
      note(4, 'Four', 'A fourth useful note.', 'notes/4.md', [], { status: 'Ready', owner: 'Mina' }),
    ];
    const catalog = createPropertyCatalog([
      { id: '00000000-0000-4000-8000-000000000091', key: 'status', name: 'Status', type: 'text' },
      { id: '00000000-0000-4000-8000-000000000092', key: 'owner', name: 'Owner', type: 'text' },
    ]);
    const first = analyzeOrganization(notes, buildLinkIndex(notes), undefined, catalog);
    const second = analyzeOrganization([...notes].reverse(), buildLinkIndex([...notes].reverse()), undefined, catalog);
    const missing = first.suggestions.filter((item) => item.type === 'metadata' && item.action.type === 'review' && item.action.noteId === notes[0]!.id);
    expect(missing).toHaveLength(2);
    expect(new Set(missing.map((item) => item.id)).size).toBe(2);
    expect(first.suggestions.map((item) => item.id)).toEqual(second.suggestions.map((item) => item.id));
  });

  it('previews exact path-link occurrences while excluding title and stable-ID links', () => {
    const target = note(1, 'Canopy record', 'A note about forest canopy and rainfall.', 'research/canopy-record.md');
    const source = note(2, 'References', `[[research/canopy-record]] and [[Canopy record]] and [[${target.id}]].`);
    const links = buildLinkIndex([target, source]);
    const preview = previewOrganizationMove([target, source], links, target.id, 'archive/field-notes');
    expect(preview).toMatchObject({ currentPath: 'research/canopy-record.md', destinationPath: 'archive/field-notes/canopy-record.md', pathLinkCount: 1, affectedSourceCount: 1 });
    expect(preview?.pathLinks[0]).toMatchObject({ sourceId: source.id, target: 'research/canopy-record', line: 1 });
  });
});
