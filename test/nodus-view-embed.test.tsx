import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Property } from '../src/database/schema';
import type { UiDatabaseRow } from '../src/ui-server/dto';
import type { LinkableNote } from '../src/links/wikilink';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MarkdownPreview } from '@/editor/MarkdownPreview';
import { EmbeddedViewTable } from '@/embeds/EmbeddedDatabaseView';
import { findEmbeddedView, parseNodusViewDirective, serializeNodusViewDirective } from '@/embeds/nodusView';

const DATABASE = '11111111-1111-4111-8111-111111111111';
const VIEW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

function directive(body: string): string {
  return `\`\`\`nodus-view\n${body}\n\`\`\``;
}

describe('nodus-view directive', () => {
  it('parses a valid directive and defaults the height', () => {
    const result = parseNodusViewDirective(`database: ${DATABASE}\nview: ${VIEW}`);
    expect(result).toEqual({ ok: true, spec: { databaseId: DATABASE, viewId: VIEW, height: 320 } });
  });

  it('accepts an in-range height and ignores blank lines', () => {
    const result = parseNodusViewDirective(`\ndatabase: ${DATABASE}\n\nview: ${VIEW}\nheight: 240\n`);
    expect(result.ok && result.spec.height).toBe(240);
  });

  it('round-trips through the serializer', () => {
    const body = serializeNodusViewDirective({ databaseId: DATABASE, viewId: VIEW, height: 480 });
    const parsed = parseNodusViewDirective(body);
    expect(parsed.ok && parsed.spec.height).toBe(480);
  });

  it.each([
    ['empty', '', /Missing "database/],
    ['no view', `database: ${DATABASE}`, /Missing "view/],
    ['bad database id', `database: not-a-uuid\nview: ${VIEW}`, /database must be/],
    ['uppercase id', `database: AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAA1\nview: ${VIEW}`, /database must be/],
    ['unknown key', `database: ${DATABASE}\nview: ${VIEW}\ncolor: red`, /Unknown key "color"/],
    ['duplicate key', `database: ${DATABASE}\ndatabase: ${DATABASE}\nview: ${VIEW}`, /appears twice/],
    ['bad height', `database: ${DATABASE}\nview: ${VIEW}\nheight: tall`, /height must be/],
    ['height too small', `database: ${DATABASE}\nview: ${VIEW}\nheight: 10`, /between 160 and 1200/],
    ['no colon', `database ${DATABASE}`, /not "key: value"/],
    ['oversized', `database: ${DATABASE}\nview: ${VIEW}\n${'x'.repeat(2100)}`, /longer than/],
  ])('rejects %s', (_label, body, message) => {
    const result = parseNodusViewDirective(body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });

  it('finds the referenced saved view and reports a missing one', () => {
    const views = [{ view: { id: VIEW, name: 'Staging' } }];
    expect(findEmbeddedView(views, VIEW)?.view.name).toBe('Staging');
    expect(findEmbeddedView(views, '88888888-8888-4888-8888-888888888888')).toBeNull();
  });
});

const status: Property = {
  id: 'd0000003-0000-4000-8000-000000000002',
  name: 'Status',
  type: 'select',
  options: [
    { id: 'e0000003-0000-4000-8000-000000000023', name: 'Not started' },
    { id: 'e0000003-0000-4000-8000-000000000025', name: 'Done' },
  ],
};
const version: Property = { id: 'd0000003-0000-4000-8000-000000000003', name: 'Version', type: 'text' };

function row(index: number, title: string, values: Record<string, unknown>): UiDatabaseRow {
  return {
    noteId: `f0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    path: `notes/row-${index}.md`,
    databaseId: DATABASE,
    title,
    updatedAt: '2026-11-27T00:00:00Z',
    contentHash: 'hash',
    issues: [],
    values,
  } as UiDatabaseRow;
}

describe('embedded view table', () => {
  const rows = [
    row(1, 'Store build', { [status.id]: 'e0000003-0000-4000-8000-000000000025', [version.id]: 'v1.1.1' }),
    row(2, 'Offline cache', { [status.id]: 'e0000003-0000-4000-8000-000000000023', [version.id]: 'v1.1.0' }),
  ];

  it('renders the database, view, row count and option labels', () => {
    const html = renderToStaticMarkup(createElement(EmbeddedViewTable, {
      databaseName: 'Test case repository',
      viewName: 'Staging checklist',
      properties: [status, version],
      rows,
      height: 320,
      total: 2,
      onOpenNote: () => undefined,
    }));
    expect(html).toContain('Test case repository');
    expect(html).toContain('Staging checklist');
    expect(html).toContain('2 rows');
    expect(html).toContain('Done');
    expect(html).toContain('Not started');
    expect(html).toContain('v1.1.0');
    expect(html).toContain('Read-only');
  });

  it('renders an empty state without rows', () => {
    const html = renderToStaticMarkup(createElement(EmbeddedViewTable, {
      databaseName: 'Bug tracker',
      viewName: 'Open bugs',
      properties: [status],
      rows: [],
      height: 320,
      total: 0,
      onOpenNote: () => undefined,
    }));
    expect(html).toContain('No rows match this view.');
  });
});

const notes: LinkableNote[] = [];

function preview(value: string): string {
  return renderToStaticMarkup(createElement(TooltipProvider, null, createElement(MarkdownPreview, {
    value,
    notePath: 'notes/Demo/Note composition.md',
    notes,
    onOpenNote: () => undefined,
  })));
}

describe('Markdown preview embedding', () => {
  it('renders an embedded view for a valid directive', () => {
    const html = preview(`# Page\n\nIntro prose.\n\n${directive(`database: ${DATABASE}\nview: ${VIEW}`)}\n\nAfter.`);
    expect(html).toContain('Intro prose.');
    expect(html).toContain('data-testid="nodus-view-embed-loading"');
    expect(html).not.toContain('Copy code block');
  });

  it('shows a readable error for a malformed directive', () => {
    const html = preview(directive(`database: nope\nview: ${VIEW}`));
    expect(html).toContain('data-testid="nodus-view-embed-invalid"');
    expect(html).toContain('database must be a lowercase UUID v4');
    expect(html).toContain('Expected: database:');
  });

  it('leaves ordinary fenced code untouched', () => {
    const html = preview('```js\nconst untouched = true;\n```');
    expect(html).toContain('untouched =');
    expect(html).toContain('Copy code block');
  });

  it('leaves a legacy note without embeds unchanged', () => {
    const html = preview('# Legacy\n\nJust **Markdown** and a [[Wiki link]].');
    expect(html).toContain('Legacy');
    expect(html).toContain('Markdown');
    expect(html).not.toContain('nodus-view-embed');
  });
});
