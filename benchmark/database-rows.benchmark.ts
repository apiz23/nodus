import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { cpus, platform, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import type { UiDatabaseRowsResponse } from '../src/ui-server/dto.js';
import { createNote } from '../src/domain/note.js';
import { serializeDatabase } from '../src/database/schema.js';
import * as noteFormat from '../src/format/note-format.js';
import * as properties from '../src/database/note-properties.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';

const NOW = '2026-10-28T12:00:00Z';
const DB = '11111111-1111-4111-8111-111111111111';
const OTHER_DB = '22222222-2222-4222-8222-222222222222';
const TEXT = '33333333-3333-4333-8333-333333333333';
const NUMBER = '44444444-4444-4444-8444-444444444444';
const sizes = (process.env.NODUS_ROWS_BENCH_SIZES ?? '1000,10000').split(',').map((value) => integer(value, 1, 100_000));
const iterations = integer(process.env.NODUS_ROWS_BENCH_ITERATIONS ?? '5', 1, 100);
const warmups = integer(process.env.NODUS_ROWS_BENCH_WARMUPS ?? '1', 0, 100);

it('measures the production database rows endpoint with deterministic temporary vaults', async () => {
  const environment = { node: process.version, platform: `${platform()} ${release()}`, arch: process.arch, cpu: cpus()[0]?.model, cpus: cpus().length };
  const results = [];
  for (const count of sizes) {
    const root = await mkdtemp(join(tmpdir(), 'nodus-database-benchmark-'));
    const vaultPath = join(root, 'vault');
    const api = createLocalApiMiddleware({ vaultPath, now: () => NOW });
    const server = createServer((request, response) => api(request, response, () => {
      response.writeHead(404).end();
    }));
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
        const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
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
        }
        return { elapsed, rows: body.rows.length, responseBytes: Buffer.byteLength(JSON.stringify(body)) };
      };
      // Files have just been generated. This is a first API request, NOT a cold-cache run.
      const first = await request();
      for (let index = 0; index < warmups; index++) await request();
      const samples = [];
      for (let index = 0; index < iterations; index++) samples.push((await request()).elapsed);

      // Separate instrumented request. Spy/timer overhead is not included in primary latency samples.
      const profile = { databaseSnapshotMs: 0, noteParseMs: 0, projectionMs: 0, noteParseCalls: 0, projectionCalls: 0 };
      const originalSnapshot = FileSystemVault.prototype.databaseRowsSnapshot;
      const originalParse = noteFormat.parseNote;
      const originalProjection = properties.projectNoteProperties;
      const snapshot = vi.spyOn(FileSystemVault.prototype, 'databaseRowsSnapshot').mockImplementation(async function (this: FileSystemVault) {
        const start = performance.now();
        try { return await originalSnapshot.call(this); }
        finally { profile.databaseSnapshotMs += performance.now() - start; }
      });
      const parse = vi.spyOn(noteFormat, 'parseNote').mockImplementation((...args) => {
        const start = performance.now();
        try { return originalParse(...args); }
        finally {
          profile.noteParseCalls++;
          profile.noteParseMs += performance.now() - start;
        }
      });
      const project = vi.spyOn(properties, 'projectNoteProperties').mockImplementation((...args) => {
        const start = performance.now();
        try { return originalProjection(...args); }
        finally { profile.projectionCalls++; profile.projectionMs += performance.now() - start; }
      });
      try {
        await request();
        expect(profile.noteParseCalls).toBe(count);
        expect(profile.projectionCalls).toBe(count);
      } finally { project.mockRestore(); parse.mockRestore(); snapshot.mockRestore(); }
      const result = { notes: count, markdownBytes: bytes, rows: first.rows, responseBytes: first.responseBytes, firstRequestMs: first.elapsed, warmups, iterations, medianMs: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95), minMs: Math.min(...samples), maxMs: Math.max(...samples), samplesMs: samples, profile };
      results.push(result);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } finally {
      server.closeAllConnections();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  }
  console.table(results.map(({ notes, rows, medianMs, p95Ms, firstRequestMs }) => ({ notes, rows, firstRequestMs, medianMs, p95Ms })));
  process.stdout.write(`${JSON.stringify({ environment, condition: 'Same process; OS filesystem cache uncontrolled; 1 separately instrumented request per size', results })}\n`);
});

async function generate(root: string, count: number): Promise<number> {
  await mkdir(join(root, 'databases'), { recursive: true });
  for (const id of [DB, OTHER_DB]) {
    await writeFile(join(root, 'databases', `${id}.json`), serializeDatabase({ id, name: id === DB ? 'Requested database' : 'Other database', properties: [{ id: TEXT, name: 'Summary', type: 'text' }, { id: NUMBER, name: 'Rating', type: 'number' }] }));
  }
  let bytes = 0;
  for (let index = 0; index < count; index++) {
    const group = `group-${index % 20}`;
    await mkdir(join(root, group), { recursive: true });
    const path = `${group}/note-${index}.md`;
    const body = Array.from({ length: 1 + index % 6 }, (_, paragraph) => `Paragraph ${paragraph}: Café 日本語 🙂. Local Markdown research, planning and observations. Related: [[Note ${(index + 1) % count}]].`).join('\n\n') + '\n';
    const note = createNote({ id: noteId(index), path, title: `Note ${index}`, body, now: NOW });
    if (index % 10 < 5) {
      note.extraFrontmatter.nodus_data = { format: 'nodus-note-properties', version: 1, databases: { [index % 10 < 3 ? DB : OTHER_DB]: { [TEXT]: `Value ${index}`, [NUMBER]: index % 5 } } };
    }
    const text = index % 10 >= 5 && index % 2 === 1 ? body : noteFormat.serializeNote(note);
    bytes += Buffer.byteLength(text);
    await writeFile(join(root, path), text);
  }
  return bytes;
}

function noteId(index: number): string { return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`; }
function percentile(values: number[], fraction: number): number { return [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1]!; }
function integer(raw: string, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Benchmark setting must be an integer from ${min} to ${max}`);
  return value;
}
