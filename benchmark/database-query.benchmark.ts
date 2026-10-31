import { cpus, platform, release } from 'node:os';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { Property } from '../src/database/schema.js';
import type { UiDatabaseRow } from '../src/ui-server/dto.js';
import { filterDatabaseRows, selectDatabaseRows, sortDatabaseRowsBy } from '../ui/src/database-table.js';
import { ListView } from '../ui/src/DatabaseLayouts.js';
import { formatPropertyValue } from '../ui/src/DatabasesView.js';
import { groupDatabaseRows } from '../ui/src/database-view-layout.js';

const sizes = (process.env.NODUS_QUERY_BENCH_SIZES ?? '100,500,1000,5000').split(',').map((value) => integer(value, 1, 100_000));
const iterations = integer(process.env.NODUS_QUERY_BENCH_ITERATIONS ?? '7', 1, 100);
const warmups = integer(process.env.NODUS_QUERY_BENCH_WARMUPS ?? '2', 0, 100);
const properties: Property[] = [
  { id: 'status', name: 'Status', type: 'select', options: Array.from({ length: 20 }, (_, index) => ({ id: `status-${index}`, name: `Status ${index}` })) },
  { id: 'score', name: 'Score', type: 'number' },
  { id: 'active', name: 'Active', type: 'checkbox' },
  { id: 'summary', name: 'Summary', type: 'text' },
];

it('measures filtering, multi-sort, and grouping for database row sets', () => {
  const environment = { node: process.version, platform: `${platform()} ${release()}`, arch: process.arch, cpu: cpus()[0]?.model, cpus: cpus().length };
  const results = sizes.map((count) => {
    const rows = makeRows(count);
    const filters = [
      { id: 'active-filter', propertyId: 'active', operator: 'is', value: true },
      { id: 'score-filter', propertyId: 'score', operator: 'greater', value: 100 },
    ] as const;
    const sorts = [
      { propertyId: 'status', direction: 'asc' },
      { propertyId: 'score', direction: 'desc' },
      { propertyId: 'title', direction: 'asc' },
    ] as const;
    const filtered = filterDatabaseRows(rows, properties, filters);
    const ordered = sortDatabaseRowsBy(filtered, properties, sorts);
    const run = () => {
      const selected = selectDatabaseRows(rows, properties, filters, sorts);
      return { selected, groups: groupDatabaseRows(selected, properties[0]!) };
    };
    const querySamples: number[] = [];
    const filterSamples: number[] = [];
    const sortSamples: number[] = [];
    const groupSamples: number[] = [];
    const renderSamples: number[] = [];
    let result = run();
    let markup = '';
    const render = () => renderToStaticMarkup(createElement(ListView, {
      rows: ordered, groupProperty: properties[0], visibleProperties: properties, disabled: false,
      onOpen: () => undefined, onEdit: () => undefined, formatValue: formatPropertyValue,
    }));
    for (let index = 0; index < warmups; index++) { result = run(); markup = render(); }
    for (let index = 0; index < iterations; index++) {
      let start = performance.now();
      const next = selectDatabaseRows(rows, properties, filters, sorts);
      querySamples.push(performance.now() - start);
      start = performance.now(); filterDatabaseRows(rows, properties, filters); filterSamples.push(performance.now() - start);
      start = performance.now(); sortDatabaseRowsBy(filtered, properties, sorts); sortSamples.push(performance.now() - start);
      start = performance.now(); groupDatabaseRows(ordered, properties[0]!); groupSamples.push(performance.now() - start);
      result = { selected: next, groups: groupDatabaseRows(next, properties[0]!) };
      start = performance.now(); markup = render(); renderSamples.push(performance.now() - start);
    }
    expect(result.selected.length).toBe(rows.filter((row) => row.values.active === true && Number(row.values.score) > 100).length);
    expect(result.groups.reduce((sum, group) => sum + group.rows.length, 0)).toBe(result.selected.length);
    return {
      records: count, matchingRecords: result.selected.length, groups: result.groups.length, iterations, warmups,
      queryMedianMs: percentile(querySamples, 0.5), queryP95Ms: percentile(querySamples, 0.95),
      filterMedianMs: percentile(filterSamples, 0.5), sortMedianMs: percentile(sortSamples, 0.5), groupMedianMs: percentile(groupSamples, 0.5),
      listSsrMedianMs: percentile(renderSamples, 0.5), listSsrP95Ms: percentile(renderSamples, 0.95), renderedHtmlBytes: Buffer.byteLength(markup),
    };
  });
  console.table(results.map(({ records, matchingRecords, groups, queryMedianMs, filterMedianMs, sortMedianMs, groupMedianMs, listSsrMedianMs }) => ({ records, matchingRecords, groups, queryMedianMs, filterMedianMs, sortMedianMs, groupMedianMs, listSsrMedianMs })));
  process.stdout.write(`${JSON.stringify({ environment, methodology: 'In-memory typed row fixtures; AND checkbox/number filters, three-priority sort, Select grouping, and React server rendering of the production ListView with production formatter; warmups excluded; medians and p95 of repeated pipeline phases', results })}\n`);
});

function makeRows(count: number): UiDatabaseRow[] {
  return Array.from({ length: count }, (_, index) => ({
    noteId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    title: `Record ${String((index * 977) % count).padStart(5, '0')}`,
    path: `records/record-${index}.md`,
    updatedAt: '2026-10-31T00:00:00Z',
    contentHash: '0'.repeat(64),
    values: { status: `status-${index % 20}`, score: (index * 37) % 1000, active: index % 2 === 0, summary: `Summary text for record ${index}` },
    issues: [],
  } as UiDatabaseRow));
}

function percentile(values: number[], fraction: number): number { return [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1]!; }
function integer(raw: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Benchmark setting must be an integer from ${min} to ${max}`);
  return value;
}
