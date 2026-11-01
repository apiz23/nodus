import { createServer } from 'node:http';
import { appendFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { cpus, platform, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import type { UiDatabaseRowsResponse } from '../src/ui-server/dto.js';
import { createNote } from '../src/domain/note.js';
import * as databaseSchema from '../src/database/schema.js';
const serializeDatabase = databaseSchema.serializeDatabase;
import * as noteFormat from '../src/format/note-format.js';
import * as properties from '../src/database/note-properties.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';

const NOW = '2026-10-28T12:00:00Z';
const DB = '11111111-1111-4111-8111-111111111111';
const OTHER_DB = '22222222-2222-4222-8222-222222222222';
const TEXT = '33333333-3333-4333-8333-333333333333';
const NUMBER = '44444444-4444-4444-8444-444444444444';
const RELATION = '55555555-5555-4555-8555-555555555555';
const ROLLUP = '66666666-6666-4666-8666-666666666666';
const FORMULA = '77777777-7777-4777-8777-777777777777';
const TASK_NUMBER = '88888888-8888-4888-8888-888888888888';
const sizes = (process.env.NODUS_ROWS_BENCH_SIZES ?? '1000,5000,10000').split(',').map((value) => integer(value, 1, 100_000));
const iterations = integer(process.env.NODUS_ROWS_BENCH_ITERATIONS ?? '5', 1, 100);
const warmups = integer(process.env.NODUS_ROWS_BENCH_WARMUPS ?? '1', 0, 100);

it('measures the production database rows endpoint with deterministic temporary vaults', async () => {
  const environment = { node: process.version, platform: `${platform()} ${release()}`, arch: process.arch, cpu: cpus()[0]?.model, cpus: cpus().length };
  const results = [];
  for (const count of sizes) {
    const root = await mkdtemp(join(tmpdir(), 'nodus-database-benchmark-'));
    const vaultPath = join(root, 'vault');
    const api = createLocalApiMiddleware({ vaultPath, now: () => NOW, watchSnapshots: true });
    const server = createServer((request, response) => api(request, response, () => {
      response.writeHead(404).end();
    }));
    const reconciliationRuns: Array<{ durationMs: number; filesRead: number; bytesRead: number; noteFilesRead: number; databaseFilesRead: number; noteParseCalls: number; databaseParseCalls: number }> = [];
    type Profile = { totalMs: number; databaseSnapshotInclusiveMs: number; noteParseMs: number; propertyProjectionMs: number; snapshotResidualMs: number; postSnapshotMs: number; noteParseCalls: number; projectionCalls: number };
    let profile: Profile | undefined;
    let noteParseCalls = 0;
    let databaseParseCalls = 0;
    const originalParseNote = noteFormat.parseNote;
    const originalParseDatabase = databaseSchema.parseDatabase;
    const originalProjectProperties = properties.projectNoteProperties;
    const parseNoteSpy = vi.spyOn(noteFormat, 'parseNote').mockImplementation((...args) => {
      const start = performance.now();
      try { return originalParseNote(...args); }
      finally { noteParseCalls++; if (profile) { profile.noteParseCalls++; profile.noteParseMs += performance.now() - start; } }
    });
    const parseDatabaseSpy = vi.spyOn(databaseSchema, 'parseDatabase').mockImplementation((...args) => {
      databaseParseCalls++;
      return originalParseDatabase(...args);
    });
    const projectPropertiesSpy = vi.spyOn(properties, 'projectNoteProperties').mockImplementation((...args) => {
      const start = performance.now();
      try { return originalProjectProperties(...args); }
      finally { if (profile) { profile.projectionCalls++; profile.propertyProjectionMs += performance.now() - start; } }
    });
    const originalSnapshot = FileSystemVault.prototype.databaseRowsSnapshot;
    const snapshotSpy = vi.spyOn(FileSystemVault.prototype, 'databaseRowsSnapshot').mockImplementation(async function (this: FileSystemVault) {
      const start = performance.now();
      const noteParsesBefore = noteParseCalls;
      const databaseParsesBefore = databaseParseCalls;
      try { return await originalSnapshot.call(this); }
      finally {
        const durationMs = performance.now() - start;
        if (profile) profile.databaseSnapshotInclusiveMs += durationMs;
        const metrics = this.databaseRowsSnapshotMetrics;
        if (metrics) reconciliationRuns.push({ ...metrics, durationMs, noteParseCalls: noteParseCalls - noteParsesBefore, databaseParseCalls: databaseParseCalls - databaseParsesBefore });
      }
    });
    try {
      const bytes = await generate(vaultPath, count);
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('No benchmark port');
      const url = `http://127.0.0.1:${address.port}/api/databases/${DB}/rows`;
      const request = async () => {
        const start = performance.now();
        const response = await fetch(url, { signal: AbortSignal.timeout(600_000) });
        if (!response.ok) throw new Error(`Rows endpoint returned HTTP ${response.status}`);
        const body = await response.json() as UiDatabaseRowsResponse;
        const elapsed = performance.now() - start;
        // Correctness checks run outside the measured HTTP + body decode interval.
        const expected = Array.from({ length: count }, (_, index) => index).filter((index) => index % 10 < 3);
        expect(body.rows.map((row) => row.noteId).sort()).toEqual(expected.map(noteId).sort());
        expect(body.diagnostics).toEqual([]);
        for (const row of body.rows) {
          expect(row.values[TEXT]).toBe(`Value ${Number(row.noteId.slice(-12)) - 1}`);
          expect(row.contentHash).toMatch(/^[a-f0-9]{64}$/);
          const index = Number(row.noteId.slice(-12)) - 1;
          const relatedIndex = Math.floor(index / 10) * 10 + 3;
          const relatedId = noteId(relatedIndex);
          expect(row.relations[RELATION]).toEqual([{ id: relatedId, title: `Note ${relatedIndex}`, path: `group-${relatedIndex % 20}/note-${relatedIndex}.md`, status: 'resolved' }]);
          expect(row.values[ROLLUP]).toBe(relatedIndex);
          expect(row.values[FORMULA]).toBe((Number(row.values[NUMBER]) as number) * 2);
        }
        return { elapsed, rows: body.rows.length, responseBytes: Buffer.byteLength(JSON.stringify(body)) };
      };
      // Files have just been generated. This is a first API request, NOT a cold-cache run.
      const first = await request();
      for (let index = 0; index < warmups; index++) await request();
      const samples = [];
      for (let index = 0; index < iterations; index++) samples.push((await request()).elapsed);

      // Separate instrumented request. Spy/timer overhead is not included in primary latency samples.
      const currentProfile = { totalMs: 0, databaseSnapshotInclusiveMs: 0, noteParseMs: 0, propertyProjectionMs: 0, snapshotResidualMs: 0, postSnapshotMs: 0, noteParseCalls: 0, projectionCalls: 0 };
      profile = currentProfile;
      const measuredRequest = request;
      const profiledRequest = async () => { const start = performance.now(); try { return await measuredRequest(); } finally { profile.totalMs += performance.now() - start; } };
      try {
        await profiledRequest();
        // Warm manifest reconciliation reuses the previously parsed snapshot.
        expect(currentProfile.noteParseCalls).toBe(0);
        expect(currentProfile.projectionCalls).toBe(count);
        // Snapshot contains parsing and property projection. Report the residual only
        // after subtracting those nested timers; post-snapshot covers relation graph,
        // row/DTO assembly, HTTP response writing and client JSON decode/measurement.
        currentProfile.snapshotResidualMs = Math.max(0, currentProfile.databaseSnapshotInclusiveMs - currentProfile.noteParseMs - currentProfile.propertyProjectionMs);
        currentProfile.postSnapshotMs = Math.max(0, currentProfile.totalMs - currentProfile.databaseSnapshotInclusiveMs);
      } finally { profile = undefined; }

      const eventIndex = reconciliationRuns.length;
      await appendFile(join(vaultPath, 'group-0', 'note-0.md'), '\nExternal benchmark modification.\n');
      await waitFor(() => reconciliationRuns.length > eventIndex, 120_000);
      const eventTriggeredRebuild = reconciliationRuns[eventIndex]!;
      const periodicIndex = reconciliationRuns.length;
      await waitFor(() => reconciliationRuns.length > periodicIndex, 600_000);
      const periodicReconciliation = reconciliationRuns[periodicIndex]!;
      const result = { notes: count, markdownBytes: bytes, rows: first.rows, responseBytes: first.responseBytes, firstRequestMs: first.elapsed, warmups, iterations, medianMs: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95), minMs: Math.min(...samples), maxMs: Math.max(...samples), samplesMs: samples, profile: currentProfile, initialBuild: reconciliationRuns[0], eventTriggeredRebuild, periodicReconciliation };
      results.push(result);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } finally {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      await api.dispose();
      snapshotSpy.mockRestore();
      projectPropertiesSpy.mockRestore();
      parseDatabaseSpy.mockRestore();
      parseNoteSpy.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  }
  console.table(results.map(({ notes, rows, medianMs, p95Ms, firstRequestMs }) => ({ notes, rows, firstRequestMs, medianMs, p95Ms })));
  process.stdout.write(`${JSON.stringify({ environment, condition: 'Same process; OS filesystem cache uncontrolled; 1 separately instrumented request per size. Snapshot residual is inclusive snapshot time less nested parse and property projection timers; post-snapshot is total minus snapshot.', results })}\n`);
});

async function generate(root: string, count: number): Promise<number> {
  await mkdir(join(root, 'databases'), { recursive: true });
  await writeFile(join(root, 'databases', `${DB}.json`), serializeDatabase({ id: DB, name: 'Requested database', properties: [
    { id: TEXT, name: 'Summary', type: 'text' }, { id: NUMBER, name: 'Rating', type: 'number' },
    { id: RELATION, name: 'Related record', type: 'relation', relation: { databaseId: OTHER_DB, cardinality: 'one' } },
    { id: ROLLUP, name: 'Related rating', type: 'rollup', rollup: { relationPropertyId: RELATION, operation: 'sum', targetPropertyId: TASK_NUMBER } },
    { id: FORMULA, name: 'Double rating', type: 'formula', formula: { expression: `@{${NUMBER}} * 2` } },
  ] }));
  await writeFile(join(root, 'databases', `${OTHER_DB}.json`), serializeDatabase({ id: OTHER_DB, name: 'Related records', properties: [{ id: TASK_NUMBER, name: 'Task rating', type: 'number' }] }));
  await Promise.all(Array.from({ length: 20 }, (_, index) => mkdir(join(root, `group-${index}`), { recursive: true })));
  let bytes = 0;
  for (let index = 0; index < count; index++) {
    const group = `group-${index % 20}`;
    const path = `${group}/note-${index}.md`;
    const body = Array.from({ length: 1 + index % 6 }, (_, paragraph) => `Paragraph ${paragraph}: Café 日本語 🙂. Local Markdown research, planning and observations. Related: [[Note ${(index + 1) % count}]].`).join('\n\n') + '\n';
    const note = createNote({ id: noteId(index), path, title: `Note ${index}`, body, now: NOW });
    if (index % 10 < 5) {
      note.extraFrontmatter.nodus_data = { format: 'nodus-note-properties', version: 1, databases: index % 10 < 3
        ? { [DB]: { [TEXT]: `Value ${index}`, [NUMBER]: index % 5, [RELATION]: noteId(Math.floor(index / 10) * 10 + 3) } }
        : { [OTHER_DB]: { [TASK_NUMBER]: index } } };
    }
    const text = index % 10 >= 5 && index % 2 === 1 ? body : noteFormat.serializeNote(note);
    bytes += Buffer.byteLength(text);
    await writeFile(join(root, path), text);
  }
  return bytes;
}

function noteId(index: number): string { return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`; }
function percentile(values: number[], fraction: number): number { return [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1]!; }
async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Benchmark event did not occur within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function integer(raw: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Benchmark setting must be an integer from ${min} to ${max}`);
  return value;
}
