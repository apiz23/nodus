import { createServer, type Server } from 'node:http';
import { cpus, freemem, platform, release, totalmem } from 'node:os';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import { createNote } from '../src/domain/note.js';
import { serializeNote } from '../src/format/note-format.js';
import * as noteFormat from '../src/format/note-format.js';
import * as scanner from '../src/storage/fs/scan.js';
import * as safePath from '../src/storage/fs/safe-path.js';
import * as search from '../src/search/search-index.js';
import * as links from '../src/links/link-index.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';

const NOW = '2026-10-25T12:00:00Z';
const RESULT_LIMIT = 50;
const DEFAULT_SIZES = [100, 1_000, 10_000];
const sizes = readPositiveIntegers(process.env.NODUS_SEARCH_BENCH_SIZES, DEFAULT_SIZES);
const iterations = readPositiveInteger(process.env.NODUS_SEARCH_BENCH_ITERATIONS, 5);
const warmups = readNonNegativeInteger(process.env.NODUS_SEARCH_BENCH_WARMUPS, 1);
const timeoutMs = readPositiveInteger(process.env.NODUS_SEARCH_BENCH_TIMEOUT_MS, 120_000);
const jsonOutput = process.env.NODUS_SEARCH_BENCH_JSON === '1';
const profileEnabled = process.env.NODUS_SEARCH_BENCH_PROFILE === '1';
const profiles: Array<{ size: number; phases: Awaited<ReturnType<typeof profileLifecycle>> }> = [];

interface Scenario {
  name: string;
  query: string;
  matches: (index: number, count: number) => boolean;
}

interface Measurement {
  size: number;
  scenario: string;
  query: string;
  returned: number;
  totalMatches: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  iterations: number;
}

const SCENARIOS: Scenario[] = [
  { name: 'common term', query: 'knowledge', matches: () => true },
  { name: 'rare term', query: 'needle_quasar', matches: (index) => index % 997 === 0 },
  { name: 'no result', query: 'never_present_token', matches: () => false },
  { name: 'multiple terms', query: 'fieldwork reflection', matches: (index) => index % 13 === 0 },
  { name: 'many matches', query: 'frequent marker', matches: (index) => index % 3 !== 0 },
];

const root = await mkdtemp(join(tmpdir(), 'nodus-search-benchmark-'));
const startedServers: Server[] = [];
const measurements: Measurement[] = [];
const firstRequests: Array<{ size: number; query: string; returned: number; elapsedMs: number }> = [];
const errors: Array<{ size: number; scenario: string; message: string }> = [];

afterAll(async () => {
  for (const server of startedServers) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await rm(root, { recursive: true, force: true });
});

describe('production search performance', () => {
  it('measures deterministic temporary vaults through the local search API', async () => {
    const environment = {
      node: process.version,
      platform: `${platform()} ${release()}`,
      architecture: process.arch,
      cpus: cpus().length,
      cpu: cpus()[0]?.model ?? 'unknown',
      totalMemoryMiB: Math.round(totalmem() / 1024 / 1024),
      freeMemoryBeforeMiB: Math.round(freemem() / 1024 / 1024),
      processRssBeforeMiB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };

    for (const size of sizes) {
      const vaultPath = join(root, `vault-${size}`);
      await generateVault(vaultPath, size);
      const base = await startApi(vaultPath);

      // First request is reported separately. Generation has already touched
      // files, so this is not described as a cold filesystem-cache measurement.
      const first = await timedSearch(base, 'knowledge');
      expect(first.ids).toEqual(expectedIds(SCENARIOS[0]!, size));
      firstRequests.push({ size, query: 'knowledge', returned: first.ids.length, elapsedMs: first.elapsedMs });
      process.stdout.write(`\nFirst request: ${size} notes, knowledge, ${first.elapsedMs.toFixed(2)} ms (process retained; OS cache uncontrolled)\n`);

      for (const scenario of SCENARIOS) {
        try {
          const expected = expectedIds(scenario, size);
          for (let index = 0; index < warmups; index += 1) {
            const result = await timedSearch(base, scenario.query);
            expect(result.ids).toEqual(expected);
          }

          const samples: number[] = [];
          let returned = 0;
          for (let index = 0; index < iterations; index += 1) {
            const result = await timedSearch(base, scenario.query);
            expect(result.ids).toEqual(expected);
            samples.push(result.elapsedMs);
            returned = result.ids.length;
          }

          measurements.push({
            size,
            scenario: scenario.name,
            query: scenario.query,
            returned,
            totalMatches: matchingCount(scenario, size),
            medianMs: percentile(samples, 0.5),
            p95Ms: percentile(samples, 0.95),
            minMs: Math.min(...samples),
            maxMs: Math.max(...samples),
            iterations,
          });
        } catch (error) {
          errors.push({ size, scenario: scenario.name, message: errorMessage(error) });
        }
      }

      // Repeated identical queries stay adjacent and use same warm process.
      const repeatScenario = SCENARIOS[0]!;
      try {
        const expected = expectedIds(repeatScenario, size);
        const samples: number[] = [];
        for (let index = 0; index < iterations; index += 1) {
          const result = await timedSearch(base, repeatScenario.query);
          expect(result.ids).toEqual(expected);
          samples.push(result.elapsedMs);
        }
        measurements.push({
          size,
          scenario: 'repeated identical query',
          query: repeatScenario.query,
          returned: expected.length,
          totalMatches: matchingCount(repeatScenario, size),
          medianMs: percentile(samples, 0.5),
          p95Ms: percentile(samples, 0.95),
          minMs: Math.min(...samples),
          maxMs: Math.max(...samples),
          iterations,
        });
      } catch (error) {
        errors.push({ size, scenario: 'repeated identical query', message: errorMessage(error) });
      }
      // Separate instrumented API instance: spies never affect the primary samples.
      if (profileEnabled) profiles.push({ size, phases: await profileLifecycle(vaultPath, size) });
    }

    const finalMemory = {
      freeMemoryAfterMiB: Math.round(freemem() / 1024 / 1024),
      processRssAfterMiB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };
    if (jsonOutput) {
      process.stdout.write(`${JSON.stringify({ environment, finalMemory, configuration: { sizes, warmups, iterations, timeoutMs }, firstRequests, measurements, profiles, errors }, null, 2)}\n`);
    } else {
      process.stdout.write('\nSearch benchmark results (latency includes local HTTP request + production scan/parse/search):\n');
      process.stdout.write('notes | scenario                    | returned/total | median ms | p95 ms | min ms | max ms\n');
      process.stdout.write('------+-----------------------------+----------------+-----------+--------+--------+--------\n');
      for (const result of measurements) {
        process.stdout.write(
          `${String(result.size).padStart(5)} | ${result.scenario.padEnd(27)} | ` +
          `${String(result.returned).padStart(3)}/${String(result.totalMatches).padEnd(10)} | ` +
          `${result.medianMs.toFixed(2).padStart(9)} | ${result.p95Ms.toFixed(2).padStart(6)} | ` +
          `${result.minMs.toFixed(2).padStart(6)} | ${result.maxMs.toFixed(2).padStart(6)}\n`,
        );
      }
      process.stdout.write(`\nEnvironment: ${JSON.stringify(environment)}\n`);
      process.stdout.write(`Process memory after benchmark (approximate): ${JSON.stringify(finalMemory)}\n`);
      process.stdout.write(`Warmups: ${warmups}; measured iterations: ${iterations}; timeout: ${timeoutMs} ms\n`);
      if (errors.length > 0) process.stdout.write(`Errors: ${JSON.stringify(errors)}\n`);
      if (profileEnabled) process.stdout.write(`Lifecycle profiles: ${JSON.stringify(profiles)}\n`);
    }

    expect(errors, `Search benchmark failures: ${JSON.stringify(errors)}`).toEqual([]);
  }, 15 * 60 * 1000);
});

async function generateVault(vaultPath: string, count: number): Promise<void> {
  await mkdir(vaultPath, { recursive: true });
  for (let index = 0; index < count; index += 1) {
    const group = index % 20;
    const set = Math.floor(index / 20) % 10;
    const path = `group-${String(group).padStart(2, '0')}/set-${set}/note-${String(index).padStart(5, '0')}.md`;
    const notePath = join(vaultPath, ...path.split('/'));
    await mkdir(join(notePath, '..'), { recursive: true });

    const paragraphs = Array.from({ length: 1 + index % 6 }, (_, paragraph) => {
      const phrases = ['local research', 'field notes', 'knowledge base', 'project planning'];
      const phrase = phrases[(index + paragraph) % phrases.length];
      return `Paragraph ${paragraph + 1}: ${phrase}; note ${index}; deterministic context about portable Markdown and linked ideas.`;
    });
    const body = [
      `The shared knowledge base contains note ${index}.`,
      index % 997 === 0 ? 'Rare token: needle_quasar.' : '',
      index % 13 === 0 ? 'Fieldwork reflection records one observation.' : '',
      index % 3 !== 0 ? 'Frequent marker appears in this note.' : '',
      `Related note: [[Note ${String((index + 1) % count).padStart(5, '0')}]].`,
      ...paragraphs,
    ].filter(Boolean).join('\n\n');

    const note = createNote({
      id: noteId(index),
      title: `Note ${String(index).padStart(5, '0')}`,
      path,
      body,
      now: NOW,
      tags: index % 4 === 0 ? ['benchmark', 'research'] : ['benchmark'],
      aliases: index % 17 === 0 ? [`Reference ${index}`] : [],
    });
    await writeFile(notePath, serializeNote(note), 'utf8');
  }
}

async function startApi(vaultPath: string): Promise<string> {
  const middleware = createLocalApiMiddleware({ vaultPath, now: () => NOW });
  const server = createServer((request, response) => {
    middleware(request, response, () => {
      response.statusCode = 404;
      response.end('not found');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  startedServers.push(server);
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('No benchmark API port');
  return `http://127.0.0.1:${address.port}`;
}

async function timedSearch(base: string, query: string, refresh = false): Promise<{ ids: string[]; elapsedMs: number }> {
  const start = process.hrtime.bigint();
  const response = await fetch(`${base}/api/search?q=${encodeURIComponent(query)}${refresh ? '&refresh=true' : ''}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Search API returned HTTP ${response.status}`);
  const body = await response.json() as { results?: Array<{ id?: string }> };
  if (!Array.isArray(body.results) || body.results.some((result) => typeof result.id !== 'string')) {
    throw new Error('Search API returned an invalid result body');
  }
  return {
    ids: body.results.map((result) => result.id!),
    elapsedMs: Number(process.hrtime.bigint() - start) / 1_000_000,
  };
}

async function profileLifecycle(vaultPath: string, size: number) {
  const base = await startApi(vaultPath);
  const empty = () => ({ snapshotMs: 0, scanMs: 0, guardedReadMs: 0, guardMs: 0,
    parseMs: 0, linkIndexMs: 0, searchIndexMs: 0, readCalls: 0, parseCalls: 0 });
  let totals = empty();
  const originalSnapshot = FileSystemVault.prototype.snapshotNotes;
  // Instrument the existing guarded read without changing storage behavior.
  const reads = FileSystemVault.prototype as unknown as { readBytesAt(absolute: string, path: string): Promise<Buffer> };
  const originalRead = reads.readBytesAt;
  const originalScan = scanner.walkVault;
  const originalGuard = safePath.assertNotSymlink;
  const originalParse = noteFormat.parseNote;
  const originalLinks = links.buildLinkIndex;
  const originalSearch = search.buildSearchIndex;
  const spies = [
    vi.spyOn(FileSystemVault.prototype, 'snapshotNotes').mockImplementation(async function (this: FileSystemVault) {
      const start = performance.now();
      try { return await originalSnapshot.call(this); } finally { totals.snapshotMs += performance.now() - start; }
    }),
    vi.spyOn(reads, 'readBytesAt').mockImplementation(async function (this: typeof reads, ...args) {
      const start = performance.now(); totals.readCalls++;
      try { return await originalRead.apply(this, args); } finally { totals.guardedReadMs += performance.now() - start; }
    }),
    vi.spyOn(scanner, 'walkVault').mockImplementation(async (...args) => {
      const start = performance.now();
      try { return await originalScan(...args); } finally { totals.scanMs += performance.now() - start; }
    }),
    vi.spyOn(safePath, 'assertNotSymlink').mockImplementation(async (...args) => {
      const start = performance.now();
      try { return await originalGuard(...args); } finally { totals.guardMs += performance.now() - start; }
    }),
    vi.spyOn(noteFormat, 'parseNote').mockImplementation((...args) => {
      const start = performance.now(); totals.parseCalls++;
      try { return originalParse(...args); } finally { totals.parseMs += performance.now() - start; }
    }),
    vi.spyOn(links, 'buildLinkIndex').mockImplementation((...args) => {
      const start = performance.now();
      try { return originalLinks(...args); } finally { totals.linkIndexMs += performance.now() - start; }
    }),
    vi.spyOn(search, 'buildSearchIndex').mockImplementation((...args) => {
      const start = performance.now();
      try { return originalSearch(...args); } finally { totals.searchIndexMs += performance.now() - start; }
    }),
  ];
  const phases: Array<ReturnType<typeof empty> & { phase: string; elapsedMs: number }> = [];
  const measure = async (phase: string, refresh = false, expectedReads = size) => {
    totals = empty();
    const result = await timedSearch(base, 'knowledge', refresh);
    expect(result.ids).toEqual(expectedIds(SCENARIOS[0]!, size));
    expect(totals.readCalls).toBe(expectedReads);
    phases.push({ phase, elapsedMs: result.elapsedMs, ...totals });
  };
  try {
    await measure('first snapshot (OS cache uncontrolled)');
    await measure('warm query', false, 0);
    await measure('explicit rebuild', true);
    const start = performance.now();
    const created = await fetch(`${base}/api/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Mutation benchmark' }) });
    expect(created.status).toBe(201);
    const mutationMs = performance.now() - start;
    await measure('after create invalidation', false, size + 1);
    return { phases, mutationMs };
  } finally { for (const spy of spies.reverse()) spy.mockRestore(); }
}

function expectedIds(scenario: Scenario, count: number): string[] {
  return Array.from({ length: count }, (_, index) => index)
    .filter((index) => scenario.matches(index, count))
    .slice(0, RESULT_LIMIT)
    .map(noteId);
}

function matchingCount(scenario: Scenario, count: number): number {
  let matches = 0;
  for (let index = 0; index < count; index += 1) {
    if (scenario.matches(index, count)) matches += 1;
  }
  return matches;
}

function noteId(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function readPositiveIntegers(raw: string | undefined, fallback: number[]): number[] {
  if (raw === undefined) return fallback;
  const values = raw.split(',').map((value) => readPositiveInteger(value, NaN));
  if (values.some((value) => !Number.isInteger(value) || value > 100_000)) {
    throw new Error('NODUS_SEARCH_BENCH_SIZES must be comma-separated integers from 1 to 100000');
  }
  return [...new Set(values)];
}

function readPositiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error('Benchmark value must be a positive integer');
  return value;
}

function readNonNegativeInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error('Warmup count must be a non-negative integer');
  return value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
