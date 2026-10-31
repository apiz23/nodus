import { describe, expect, it } from 'vitest';
import { parseNote, serializeNote } from '../src/format/note-format.js';
import {
  PROPERTY_CATALOG_FORMAT,
  PROPERTY_CATALOG_PATH,
  PROPERTY_CATALOG_VERSION,
  createPropertyCatalog,
  parsePropertyCatalog,
  projectPropertyValues,
  renamePropertyOptionLabel,
  serializePropertyCatalog,
  validateNotePropertyValue,
  type NotePropertyDefinition,
  type PropertyCatalog,
} from '../src/properties/catalog.js';
import { errorCode } from './helpers.js';

const ID = '6f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c';
const TEXT_ID = '11111111-1111-4111-8111-111111111111';
const NUMBER_ID = '22222222-2222-4222-8222-222222222222';
const CHECKBOX_ID = '33333333-3333-4333-8333-333333333333';
const DATE_ID = '44444444-4444-4444-8444-444444444444';
const SELECT_ID = '55555555-5555-4555-8555-555555555555';
const MULTI_ID = '66666666-6666-4666-8666-666666666666';
const URL_ID = '77777777-7777-4777-8777-777777777777';
const OPTION_A = '88888888-8888-4888-8888-888888888888';
const OPTION_B = '99999999-9999-4999-8999-999999999999';
const OPTION_C = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OPTION_D = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOW = '2026-10-25T09:00:00Z';

function catalog(properties: NotePropertyDefinition[] = definitions): PropertyCatalog {
  return { properties };
}

const definitions: NotePropertyDefinition[] = [
  { id: TEXT_ID, key: 'summary', name: 'Summary', type: 'text' },
  { id: NUMBER_ID, key: 'estimate', name: 'Estimate', type: 'number' },
  { id: CHECKBOX_ID, key: 'reviewed', name: 'Reviewed', type: 'checkbox' },
  { id: DATE_ID, key: 'due', name: 'Due date', type: 'date' },
  { id: SELECT_ID, key: 'status', name: 'Status', type: 'select', options: [
    { id: OPTION_A, label: 'In progress' },
    { id: OPTION_B, label: 'Done' },
  ] },
  { id: MULTI_ID, key: 'topics', name: 'Topics', type: 'multi-select', options: [
    { id: OPTION_C, label: 'Research' },
    { id: OPTION_D, label: 'Design' },
  ] },
  { id: URL_ID, key: 'homepage', name: 'Homepage', type: 'url' },
];

function catalogJson(properties: unknown = definitions, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ format: PROPERTY_CATALOG_FORMAT, version: PROPERTY_CATALOG_VERSION, properties, ...extra });
}

describe('versioned property catalog', () => {
  it('uses a distinct canonical vault location and parses every supported type', () => {
    expect(PROPERTY_CATALOG_PATH).toBe('properties/catalog.json');
    expect(createPropertyCatalog()).toEqual({ properties: [] });
    expect(parsePropertyCatalog(catalogJson()).properties.map((property) => property.type)).toEqual([
      'text', 'number', 'checkbox', 'date', 'select', 'multi-select', 'url',
    ]);
  });

  it('serializes deterministically by stable YAML key and option ID', () => {
    const reversed = catalog([...definitions].reverse());
    const first = serializePropertyCatalog(reversed);
    expect(first).toBe(serializePropertyCatalog(parsePropertyCatalog(first)));
    expect(parsePropertyCatalog(first).properties.map((property) => property.key)).toEqual([...definitions].map((item) => item.key).sort());
    expect(first.endsWith('\n')).toBe(true);
  });

  it('keeps IDs and YAML keys independent from display-name changes', () => {
    const renamed = catalog(definitions.map((property) => property.id === TEXT_ID ? { ...property, name: 'Short description' } : property));
    const parsed = parsePropertyCatalog(serializePropertyCatalog(renamed));
    expect(parsed.properties.find((property) => property.id === TEXT_ID)).toMatchObject({ id: TEXT_ID, key: 'summary', name: 'Short description' });
  });

  it('rejects duplicate property IDs, YAML keys, display names, and option IDs', () => {
    expect(errorCode(() => parsePropertyCatalog(catalogJson([definitions[0], { ...definitions[1]!, id: TEXT_ID }])))).toBe('INVALID_FIELD');
    expect(errorCode(() => parsePropertyCatalog(catalogJson([definitions[0], { ...definitions[1]!, key: 'summary' }])))).toBe('INVALID_FIELD');
    expect(errorCode(() => parsePropertyCatalog(catalogJson([definitions[0], { ...definitions[1]!, name: 'summary' }])))).toBe('INVALID_FIELD');
    const reusedOption = definitions.map((property) => property.id === MULTI_ID
      ? { ...property, options: [{ id: OPTION_A, label: 'Other' }] }
      : property);
    expect(errorCode(() => parsePropertyCatalog(catalogJson(reusedOption)))).toBe('INVALID_FIELD');
  });

  it.each(['Title', 'nodus', 'nodus_data', 'icon', 'true', 'null', '__proto__', 'Bad Key', 'UPPER', 'a.', 'a'.repeat(65)])(
    'rejects unsafe or reserved YAML property key %s',
    (key) => {
      expect(errorCode(() => parsePropertyCatalog(catalogJson([{ ...definitions[0]!, key }])))).toBe('INVALID_FIELD');
    },
  );

  it('rejects unsupported future versions and unknown fields without interpreting them', () => {
    expect(errorCode(() => parsePropertyCatalog(catalogJson(definitions, { version: 2 })))).toBe('UNSUPPORTED_VERSION');
    expect(errorCode(() => parsePropertyCatalog(catalogJson(definitions, { future: true })))).toBe('INVALID_FIELD');
    expect(errorCode(() => parsePropertyCatalog(catalogJson([{ ...definitions[0]!, future: 'x' }])))).toBe('INVALID_FIELD');
    expect(errorCode(() => serializePropertyCatalog({ ...catalog(), future: true } as PropertyCatalog))).toBe('INVALID_FIELD');
  });

  it('requires options only on select and multi-select definitions', () => {
    expect(errorCode(() => parsePropertyCatalog(catalogJson([{ ...definitions[0]!, options: [] }])))).toBe('INVALID_FIELD');
    expect(errorCode(() => parsePropertyCatalog(catalogJson([{ ...definitions[0]!, type: 'select' }])))).toBe('INVALID_FIELD');
    expect(parsePropertyCatalog(catalogJson([{ ...definitions[4]!, options: [] }])).properties[0]?.options).toEqual([]);
  });

  it('retains previous option labels when changing the display label', () => {
    const renamed = renamePropertyOptionLabel(catalog(), SELECT_ID, OPTION_A, 'Doing');
    const option = renamed.properties.find((property) => property.id === SELECT_ID)?.options?.[0];
    expect(option).toEqual({ id: OPTION_A, label: 'Doing', aliases: ['In progress'] });
    expect(validateNotePropertyValue(renamed.properties.find((property) => property.id === SELECT_ID)!, 'In progress')).toMatchObject({ ok: true, value: 'In progress' });
    expect(validateNotePropertyValue(renamed.properties.find((property) => property.id === SELECT_ID)!, 'Doing')).toMatchObject({ ok: true, value: 'Doing' });
  });

  it('renames an option back to a retained label without aliasing itself', () => {
    const renamed = renamePropertyOptionLabel(catalog(), SELECT_ID, OPTION_A, 'Doing');
    const restored = renamePropertyOptionLabel(renamed, SELECT_ID, OPTION_A, 'In progress');
    const option = restored.properties.find((property) => property.id === SELECT_ID)?.options?.[0];
    expect(option).toEqual({ id: OPTION_A, label: 'In progress', aliases: ['Doing'] });
  });
});

describe('general note property YAML values', () => {
  const byKey = new Map(definitions.map((property) => [property.key, property]));
  const check = (key: string, value: unknown) => validateNotePropertyValue(byKey.get(key)!, value);

  it('accepts typed values without coercion, including false, empty text, and an empty multi-select', () => {
    expect(check('summary', '')).toEqual({ ok: true, value: '' });
    expect(check('estimate', 0)).toEqual({ ok: true, value: 0 });
    expect(check('reviewed', false)).toEqual({ ok: true, value: false });
    expect(check('due', '2024-02-29')).toEqual({ ok: true, value: '2024-02-29' });
    expect(check('status', 'In progress')).toEqual({ ok: true, value: 'In progress' });
    expect(check('topics', [])).toEqual({ ok: true, value: [] });
    expect(check('homepage', 'https://example.com/path')).toEqual({ ok: true, value: 'https://example.com/path' });
  });

  it('distinguishes a missing key from false and empty values', () => {
    const projected = projectPropertyValues(catalog(), { reviewed: false, summary: '', topics: [] });
    expect(projected.values).toEqual({ [CHECKBOX_ID]: false, [TEXT_ID]: '', [MULTI_ID]: [] });
    expect(projected.issues).toEqual([]);
    expect(projectPropertyValues(catalog(), {}).values).toEqual({});
  });

  it.each([
    ['summary', null], ['summary', 3],
    ['estimate', '3'], ['estimate', Number.POSITIVE_INFINITY], ['estimate', Number.NaN],
    ['reviewed', 'false'], ['reviewed', null],
    ['due', '2026-02-30'], ['due', '2026-1-2'], ['due', null],
    ['status', 'Unknown'], ['status', 1], ['status', null],
    ['topics', ['Research', 'Unknown']], ['topics', ['Research', 'research']], ['topics', [1]], ['topics', null],
    ['homepage', 'javascript:alert(1)'], ['homepage', 'file:///etc/passwd'], ['homepage', 'not a URL'], ['homepage', null],
  ])('rejects invalid %s value %j without coercion', (key, value) => {
    expect(check(key!, value).ok).toBe(false);
  });

  it('allows only HTTP and HTTPS absolute URLs', () => {
    expect(check('homepage', 'http://example.com')).toMatchObject({ ok: true });
    expect(check('homepage', 'mailto:user@example.com').ok).toBe(false);
    expect(check('homepage', 'https://example.com with whitespace').ok).toBe(false);
  });

  it('reports invalid registered data and unregistered keys without dropping either', () => {
    const input = { reviewed: 'false', legacy: { keep: true }, project: 'Research' };
    const projected = projectPropertyValues(catalog(), input);
    expect(projected.issues).toMatchObject([{ key: 'reviewed', propertyId: CHECKBOX_ID, code: 'TYPE_MISMATCH' }]);
    expect(projected.unregisteredKeys).toEqual(['legacy', 'project']);
    expect(input).toEqual({ reviewed: 'false', legacy: { keep: true }, project: 'Research' });
  });

  it('allows a catalog to reference existing custom frontmatter without rewriting its value or note body', () => {
    const body = '# Keep this body verbatim\n\nText stays here.\n';
    const source = `---\ntitle: Existing\nproject: Research\nnodus:\n  version: 1\n  id: ${ID}\n  createdAt: ${NOW}\n  updatedAt: ${NOW}\n---\n${body}`;
    const note = parseNote(source, 'existing.md');
    const projectDefinition: NotePropertyDefinition = { id: TEXT_ID, key: 'project', name: 'Project', type: 'text' };
    const before = serializeNote(note);
    expect(projectPropertyValues(catalog([projectDefinition]), note.extraFrontmatter)).toMatchObject({
      values: { [TEXT_ID]: 'Research' }, issues: [], unregisteredKeys: [],
    });
    expect(serializeNote(note)).toBe(before);
    expect(parseNote(before, note.path)).toMatchObject({ id: ID, body, extraFrontmatter: { project: 'Research' } });
  });

  it('preserves note-format v1 identity, standard metadata, database data, custom YAML, and body', () => {
    const body = '# Existing note\n\n[[Other note]] and 日本語 🙂.\n';
    const nodusData = { format: 'nodus-note-properties', version: 1, databases: { [ID]: { [TEXT_ID]: 'Keep' } } };
    const source = `---\ntitle: Existing\ntags:\n  - planning\naliases:\n  - Legacy name\nicon: 📘\ncustom:\n  nested:\n    - preserved\n  enabled: true\nnodus_data:\n  format: ${nodusData.format}\n  version: 1\n  databases:\n    ${ID}:\n      ${TEXT_ID}: Keep\nnodus:\n  version: 1\n  id: ${ID}\n  createdAt: ${NOW}\n  updatedAt: ${NOW}\n---\n${body}`;
    const original = parseNote(source, 'existing.md');
    const roundTrip = parseNote(serializeNote(original), original.path);
    expect(roundTrip).toMatchObject({
      id: ID,
      title: 'Existing',
      tags: ['planning'],
      aliases: ['Legacy name'],
      createdAt: NOW,
      updatedAt: NOW,
      body,
      extraFrontmatter: {
        icon: '📘',
        custom: { nested: ['preserved'], enabled: true },
        nodus_data: nodusData,
      },
    });
    expect(serializeNote(roundTrip)).toBe(serializeNote(original));
  });

  it('leaves YAML-looking Markdown without valid Nodus frontmatter as body', () => {
    const source = '---\nproject: Research\n---\n# Body';
    const note = parseNote(source, 'plain.md');
    expect(note.body).toBe(source);
    expect(projectPropertyValues(catalog(), note.extraFrontmatter).unregisteredKeys).toEqual([]);
  });
});
