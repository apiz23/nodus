import { describe, expect, it } from 'vitest';
import { buildSearchIndex, searchIndex } from '../src/search/search-index.js';
import { createNote } from '../src/domain/note.js';
import { validateNoteFilters, matchesNoteFilters } from '../src/search/note-filters.js';
import type { PropertyCatalog } from '../src/properties/catalog.js';

const catalog: PropertyCatalog = { properties: [
  { id: '11111111-1111-4111-8111-111111111111', key: 'status', name: 'Workflow', type: 'select', options: [
    { id: '21111111-1111-4111-8111-111111111111', label: 'Active' },
    { id: '31111111-1111-4111-8111-111111111111', label: 'Paused' },
  ] },
  { id: '41111111-1111-4111-8111-111111111111', key: 'estimate', name: 'Estimate', type: 'number' },
  { id: '51111111-1111-4111-8111-111111111111', key: 'checked', name: 'Reviewed', type: 'checkbox' },
  { id: '61111111-1111-4111-8111-111111111111', key: 'topics', name: 'Topics', type: 'multi-select', options: [
    { id: '71111111-1111-4111-8111-111111111111', label: 'Design' },
    { id: '81111111-1111-4111-8111-111111111111', label: 'Research' },
  ] },
] };
const note = (title: string, tags: string[] = [], properties: Record<string, unknown> = {}) => ({
  ...createNote({ id: 'aaaaaaaa-1111-4111-8111-111111111111', title, path: 'notes/test.md', body: 'Body text', aliases: ['Short name'], tags, now: '2026-10-30T00:00:00Z' }),
  extraFrontmatter: { unregistered: 'secret-token', ...properties },
});

describe('metadata search and reusable filters', () => {
  it('searches tags, aliases, registered property labels and values without indexing unknown YAML', () => {
    const index = buildSearchIndex([note('Planning', ['Field notes'], { status: 'Active', checked: false })], catalog);
    expect(searchIndex(index, 'short name')[0]?.match.field).toBe('alias');
    expect(searchIndex(index, 'field notes')[0]?.match.field).toBe('tag');
    const label = searchIndex(index, 'workflow')[0]!;
    expect(label.match.field).toBe('property');
    expect(label.match.propertyId).toBe(catalog.properties[0]?.id);
    expect(searchIndex(index, 'active')[0]?.snippet).toContain('Workflow: Active');
    expect(searchIndex(index, 'secret-token')).toEqual([]);
  });

  it('keeps exact title matches ahead of common metadata and reports invalid registered values', () => {
    const index = buildSearchIndex([
      note('Active', [], { status: 'Active' }),
      note('Other', ['Active'], { status: 17 }),
    ], catalog);
    expect(searchIndex(index, 'active')[0]?.title).toBe('Active');
    expect(index.metadataIssues).toHaveLength(1);
    expect(searchIndex(index, '17')).toEqual([]);
  });

  it('distinguishes missing, explicit false, empty text and empty arrays', () => {
    const checkbox = catalog.properties.find((property) => property.key === 'checked')!;
    const values = validateNoteFilters([{ type: 'property', propertyId: checkbox.id, operator: 'is-unchecked' }], catalog);
    expect(matchesNoteFilters({ tags: [], values: { [checkbox.id]: false }, invalidPropertyIds: new Set() }, values, 'and')).toBe(true);
    expect(matchesNoteFilters({ tags: [], values: {}, invalidPropertyIds: new Set() }, values, 'and')).toBe(false);
    const textCatalog: PropertyCatalog = { properties: [{ id: '91111111-1111-4111-8111-111111111111', key: 'summary', name: 'Summary', type: 'text' }] };
    const empty = validateNoteFilters([{ type: 'property', propertyId: textCatalog.properties[0]!.id, operator: 'is-empty' }], textCatalog);
    expect(matchesNoteFilters({ tags: [], values: { [textCatalog.properties[0]!.id]: '' }, invalidPropertyIds: new Set() }, empty, 'and')).toBe(true);
    expect(matchesNoteFilters({ tags: [], values: {}, invalidPropertyIds: new Set() }, empty, 'and')).toBe(true);
  });

  it('validates type-specific operators and values, including multi-select membership', () => {
    const topicId = catalog.properties[3]!.id;
    expect(validateNoteFilters([{ type: 'property', propertyId: topicId, operator: 'contains', value: 'Design' }], catalog)).toHaveLength(1);
    expect(() => validateNoteFilters([{ type: 'property', propertyId: topicId, operator: 'greater-than', value: 1 }], catalog)).toThrow(/not valid/);
    expect(() => validateNoteFilters([{ type: 'property', propertyId: topicId, operator: 'contains', value: 'Unknown' }], catalog)).toThrow(/configured option/);
    expect(() => validateNoteFilters([{ type: 'property', propertyId: 'deadbeef-1111-4111-8111-111111111111', operator: 'is-empty' }], catalog)).toThrow(/deleted or unknown/);
  });

  it('combines filters with AND and OR and compares text case-insensitively', () => {
    const statusId = catalog.properties[0]!.id;
    const tagFilter = validateNoteFilters([{ type: 'tag', operator: 'contains', value: 'WORK' }], catalog)[0]!;
    const propertyFilter = validateNoteFilters([{ type: 'property', propertyId: statusId, operator: 'is', value: 'Paused' }], catalog)[0]!;
    const target = { tags: ['work'], values: { [statusId]: 'Active' }, invalidPropertyIds: new Set<string>() };
    expect(matchesNoteFilters(target, [tagFilter!, propertyFilter!], 'and')).toBe(false);
    expect(matchesNoteFilters(target, [tagFilter!, propertyFilter!], 'or')).toBe(true);
  });

  it('evaluates the supported type-specific operators and empty arrays consistently', () => {
    const typed: PropertyCatalog = { properties: [
      { id: 'a1111111-1111-4111-8111-111111111111', key: 'summary', name: 'Summary', type: 'text' },
      { id: 'a2111111-1111-4111-8111-111111111111', key: 'due', name: 'Due', type: 'date' },
      { id: 'a3111111-1111-4111-8111-111111111111', key: 'link', name: 'Link', type: 'url' },
    ] };
    const target = { tags: ['Design', 'Research'], values: {
      [typed.properties[0]!.id]: 'Local history',
      [typed.properties[1]!.id]: '2026-10-30',
      [typed.properties[2]!.id]: 'https://example.test/research',
      [catalog.properties[0]!.id]: 'Active',
      [catalog.properties[1]!.id]: 3,
      [catalog.properties[3]!.id]: ['Design', 'Research'],
    }, invalidPropertyIds: new Set<string>() };
    const matches = (filter: unknown) => matchesNoteFilters(target, validateNoteFilters([filter], { properties: [...catalog.properties, ...typed.properties] }), 'and');
    expect(matches({ type: 'property', propertyId: typed.properties[0]!.id, operator: 'equals', value: 'local HISTORY' })).toBe(true);
    expect(matches({ type: 'property', propertyId: typed.properties[0]!.id, operator: 'contains', value: 'history' })).toBe(true);
    expect(matches({ type: 'property', propertyId: catalog.properties[1]!.id, operator: 'equals', value: 3 })).toBe(true);
    expect(matches({ type: 'property', propertyId: catalog.properties[1]!.id, operator: 'greater-than', value: 2 })).toBe(true);
    expect(matches({ type: 'property', propertyId: catalog.properties[1]!.id, operator: 'less-than', value: 4 })).toBe(true);
    expect(matches({ type: 'property', propertyId: typed.properties[1]!.id, operator: 'equals', value: '2026-10-30' })).toBe(true);
    expect(matches({ type: 'property', propertyId: typed.properties[1]!.id, operator: 'before', value: '2026-11-01' })).toBe(true);
    expect(matches({ type: 'property', propertyId: typed.properties[1]!.id, operator: 'after', value: '2026-10-29' })).toBe(true);
    expect(matches({ type: 'property', propertyId: catalog.properties[0]!.id, operator: 'is', value: 'active' })).toBe(true);
    expect(matches({ type: 'property', propertyId: catalog.properties[0]!.id, operator: 'is-not', value: 'Paused' })).toBe(true);
    expect(matches({ type: 'property', propertyId: catalog.properties[3]!.id, operator: 'contains', value: 'Design' })).toBe(true);
    expect(matches({ type: 'property', propertyId: catalog.properties[3]!.id, operator: 'does-not-contain', value: 'Research' })).toBe(false);
    expect(matches({ type: 'property', propertyId: catalog.properties[3]!.id, operator: 'contains-all', value: ['Research', 'Design'] })).toBe(true);
    expect(matches({ type: 'property', propertyId: typed.properties[2]!.id, operator: 'equals', value: 'https://example.test/research' })).toBe(true);
    expect(matches({ type: 'property', propertyId: typed.properties[2]!.id, operator: 'contains', value: 'research' })).toBe(true);
    expect(matches({ type: 'tag', operator: 'contains-all', value: ['design', 'research'] })).toBe(true);
    const empty = validateNoteFilters([{ type: 'property', propertyId: catalog.properties[3]!.id, operator: 'is-empty' }], catalog);
    expect(matchesNoteFilters({ tags: [], values: { [catalog.properties[3]!.id]: [] }, invalidPropertyIds: new Set() }, empty, 'and')).toBe(true);
  });
});
