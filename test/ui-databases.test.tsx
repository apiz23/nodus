import { RelationControl, RelationValue } from '../ui/src/RelationControl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Property } from '../src/database/schema.js';
import { DatabaseSelectorItem, formatPropertyValue, PropertyControl } from '../ui/src/DatabasesView.js';
import { RelationSchemaFields } from '../ui/src/RelationSchemaFields.js';
import type { UiDatabase } from '../src/ui-server/dto.js';

const OPTION_A = '11111111-1111-4111-8111-111111111111';
const OPTION_B = '22222222-2222-4222-8222-222222222222';

describe('database property controls and display', () => {
  it('formats each supported stored value type for readable table display', () => {
    expect(formatPropertyValue({ id: 't', name: 'Text', type: 'text' }, 'Café 日本語 🙂')).toBe('Café 日本語 🙂');
    expect(formatPropertyValue({ id: 'n', name: 'Number', type: 'number' }, 3.25)).toBe('3.25');
    expect(formatPropertyValue({ id: 'b', name: 'Done', type: 'checkbox' }, true)).toBe('Yes');
    expect(formatPropertyValue({ id: 'd', name: 'Date', type: 'date' }, '2026-10-28')).toBe('2026-10-28');
    expect(formatPropertyValue({
      id: 's', name: 'Status', type: 'select', options: [{ id: OPTION_A, name: 'In progress' }],
    }, OPTION_A)).toBe('In progress');
    expect(formatPropertyValue({
      id: 'm', name: 'Topics', type: 'multi-select', options: [
        { id: OPTION_A, name: 'Work' }, { id: OPTION_B, name: 'Research' },
      ],
    }, [OPTION_A, OPTION_B])).toBe('Work, Research');
  });

  it('renders accessible controls appropriate to the property type', () => {
    const properties: Array<{ property: Property; value: unknown }> = [
      { property: { id: 't', name: 'Summary', type: 'text' }, value: 'A note' },
      { property: { id: 'n', name: 'Rating', type: 'number' }, value: '2.5' },
      { property: { id: 'd', name: 'Due', type: 'date' }, value: '2026-10-28' },
      { property: { id: 'b', name: 'Done', type: 'checkbox' }, value: true },
      { property: { id: 's', name: 'Status', type: 'select', options: [{ id: OPTION_A, name: 'Ready' }] }, value: OPTION_A },
      { property: { id: 'm', name: 'Topics', type: 'multi-select', options: [{ id: OPTION_A, name: 'Work' }] }, value: [OPTION_A] },
    ];
    const markup = properties.map(({ property, value }) => renderToStaticMarkup(createElement(
      PropertyControl,
      { property, value, label: `${property.name} for Test note`, onChange: () => undefined },
    ))).join('\n');

    expect(markup).toContain('aria-label="Summary for Test note"');
    expect(markup).toContain('type="number"');
    expect(markup).toContain('type="date"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-label="Status for Test note"');
    expect(markup).toContain('aria-label="Topics for Test note"');
    expect(markup).toContain('Ready');
  });

  it('renders absent values as an em dash instead of inventing stored data', () => {
    expect(formatPropertyValue({ id: 't', name: 'Summary', type: 'text' }, undefined)).toBe('—');
  });

  it('renders same-named database selector items with stable IDs in visible and accessible labels', () => {
    const makeDatabase = (id: string): UiDatabase => ({
      id,
      name: 'Tasks',
      path: `databases/${id}.json`,
      contentHash: '0'.repeat(64),
      properties: [],
    });
    const markup = [IDS_DB_A, IDS_DB_B].map((id) => renderToStaticMarkup(createElement(
      DatabaseSelectorItem,
      { database: makeDatabase(id), selected: false, disabled: false, onSelect: () => undefined },
    ))).join('\n');
    expect(markup.match(/>Tasks</g)).toHaveLength(2);
    expect(markup).toContain(`aria-label="Tasks — databases/${IDS_DB_A}.json — ${IDS_DB_A}"`);
    expect(markup).toContain(`aria-label="Tasks — databases/${IDS_DB_B}.json — ${IDS_DB_B}"`);
    expect(markup).toContain(`aria-label="Database ID ${IDS_DB_A}"`);
    expect(markup).toContain(`aria-label="Database ID ${IDS_DB_B}"`);
  });
});

const IDS_DB_A = '77777777-7777-4777-8777-777777777777';
const IDS_DB_B = '88888888-8888-4888-8888-888888888888';

it('escapes untrusted related-record labels and never renders missing targets as navigation buttons', () => {
  const html = renderToStaticMarkup(createElement(RelationValue, { onOpen: () => {}, references: [
    { id: OPTION_A, title: '<img src=x onerror=alert(1)>', path: 'safe.md', status: 'resolved' },
    { id: OPTION_B, title: '<script>missing</script>', status: 'missing' },
  ] }));
  expect(html).toContain('&lt;img'); expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain('<img'); expect(html).not.toContain('<script>');
  expect(html.match(/<button/g)).toHaveLength(1);
});

it('shows unresolved relation states without exposing full UUIDs and distinguishes duplicate titles by path', () => {
  const missing = '33333333-3333-4333-8333-333333333333';
  const incompatible = '44444444-4444-4444-8444-444444444444';
  const html = renderToStaticMarkup(createElement(RelationValue, { onOpen: () => {}, references: [
    { id: OPTION_A, title: 'Shared title', path: 'projects/one.md', status: 'resolved' },
    { id: OPTION_B, title: 'Shared title', path: 'projects/two.md', status: 'resolved' },
    { id: missing, status: 'missing' },
    { id: incompatible, title: 'Moved record', status: 'incompatible' },
  ] }));

  expect(html).toContain('Missing record');
  expect(html).toContain('Incompatible record');
  expect(html).toContain(missing.slice(-8));
  expect(html).not.toContain(missing);
  expect(html).not.toContain(incompatible);
  expect(html).toContain('projects/one.md');
  expect(html).toContain('projects/two.md');
});

it('keeps unresolved relation values removable and identifies the target database and cardinality', () => {
  const missing = '55555555-5555-4555-8555-555555555555';
  const property: Property = { id: 'relation', name: 'Related', type: 'relation', relation: { databaseId: IDS_DB_A, cardinality: 'many' } };
  const html = renderToStaticMarkup(createElement(RelationControl, {
    property,
    value: [missing],
    references: [{ id: missing, status: 'missing' }],
    label: 'Related for Example',
    targetDatabaseName: 'Tasks',
    targetAvailable: true,
    onChange: () => undefined,
  }));

  expect(html).toContain('Multiple records can be linked');
  expect(html).toContain('Tasks');
  expect(html).toContain('Missing record');
  expect(html).toContain(`Remove missing relation ${missing.slice(-8)}`);
  expect(html).not.toContain(missing);
});

it('bounds selected relation chips and exposes pagination for large selections', () => {
  const ids = Array.from({ length: 40 }, (_, index) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`);
  const property: Property = { id: 'relation', name: 'Related', type: 'relation', relation: { databaseId: IDS_DB_A, cardinality: 'many' } };
  const html = renderToStaticMarkup(createElement(RelationControl, {
    property,
    value: ids,
    references: ids.map((id) => ({ id, status: 'missing' as const })),
    label: 'Related for Example',
    onChange: () => undefined,
  }));

  expect(html.match(/aria-label="Remove missing relation/g)).toHaveLength(12);
  expect(html).toContain('Next selected records');
  expect(html).toContain('Showing 1');
  expect(html).not.toContain(ids[12]!);
});

it('explains a deleted relation target in the schema editor without hiding its configuration', () => {
  const source: DatabaseDefinition = {
    id: IDS_DB_A,
    name: 'Projects',
    properties: [{ id: 'relation', name: 'Tasks', type: 'relation', relation: { databaseId: IDS_DB_B, cardinality: 'one' } }],
  };
  const markup = renderToStaticMarkup(createElement(RelationSchemaFields, {
    property: source.properties[0]!,
    database: source,
    databases: [],
    onChange: () => undefined,
  }));

  expect(markup).toContain('role="alert"');
  expect(markup).toContain('The configured target database is unavailable');
  expect(markup).toContain('Stored references remain intact');
});
