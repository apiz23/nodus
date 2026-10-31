import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { projectIncomingRelations } from '../src/database/relations.js';
import type { DatabaseDefinition } from '../src/database/schema.js';

const makeId = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SOURCE_DB = makeId(1);
const TARGET_DB = makeId(2);
const RELATION = makeId(3);
const schemas = new Map<string, DatabaseDefinition>([
  [SOURCE_DB, { id: SOURCE_DB, name: 'Sources', properties: [{ id: RELATION, name: 'Targets', type: 'relation', relation: { databaseId: TARGET_DB, cardinality: 'one' } }] }],
  [TARGET_DB, { id: TARGET_DB, name: 'Targets', properties: [] }],
]);

function makeDataset(size: number, manyIncoming: boolean) {
  const note = (id: number, databaseId: string, targetId?: string) => {
    const created = createNote({ id: makeId(id), title: `Record ${id}`, path: `records/${id}.md`, body: '', now: '2026-10-30T00:00:00Z' });
    return {
      ...created,
      extraFrontmatter: { nodus_data: { format: 'nodus-note-properties', version: 1, databases: {
        [databaseId]: targetId ? { [RELATION]: targetId } : {},
      } } },
    };
  };
  const notes = [];
  if (manyIncoming) {
    const targetId = makeId(size + 1);
    notes.push(note(size + 1, TARGET_DB));
    for (let i = 1; i < size; i++) notes.push(note(i, SOURCE_DB, targetId));
  } else {
    const targetCount = Math.floor(size / 2);
    for (let i = 1; i <= targetCount; i++) notes.push(note(i, TARGET_DB));
    for (let i = 1; i <= size - targetCount; i++) notes.push(note(size + i, SOURCE_DB, makeId(i)));
  }
  return notes;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

it('measures incoming relation projection at realistic vault sizes', () => {
  const results: Array<{ records: number; scenario: string; edges: number; medianMs: number; incoming: number; responseBytes: number }> = [];
  for (const size of [100, 500, 1000, 5000]) {
    for (const manyIncoming of [true, false]) {
      const notes = makeDataset(size, manyIncoming);
      const targetId = manyIncoming ? makeId(size + 1) : makeId(1);
      projectIncomingRelations(notes, schemas); // Warm runtime and module paths.
      const durations: number[] = [];
      let incoming = 0;
      let responseBytes = 0;
      for (let run = 0; run < 5; run++) {
        const start = performance.now();
        const projection = projectIncomingRelations(notes, schemas);
        durations.push(performance.now() - start);
        const entries = projection.get(targetId) ?? [];
        incoming = entries.length;
        responseBytes = Buffer.byteLength(JSON.stringify({ backlinks: entries }));
      }
      results.push({
        records: size,
        scenario: manyIncoming ? 'many-incoming' : 'many-unrelated',
        edges: manyIncoming ? size - 1 : size - Math.floor(size / 2),
        medianMs: Number(median(durations).toFixed(2)),
        incoming,
        responseBytes,
      });
    }
  }
  expect(results).toHaveLength(8);
  console.log(JSON.stringify({ node: process.version, method: '5-run median after one warm-up; projection only, no filesystem or UI', results }, null, 2));
}, 60_000);
