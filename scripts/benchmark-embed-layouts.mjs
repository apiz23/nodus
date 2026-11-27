#!/usr/bin/env node
/**
 * Browser benchmark for embedded saved views at scale.
 *
 * Seeds a disposable vault with one 1,000-row database, a board view, a gallery
 * view and a table view, then opens notes that embed them and records render
 * time, mounted cards, DOM size, responsiveness and payload.
 *
 *   node scripts/benchmark-embed-layouts.mjs
 *   NODUS_BENCH_ROWS=1000 node scripts/benchmark-embed-layouts.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROWS = Number(process.env.NODUS_BENCH_ROWS ?? 1_000);
if (!Number.isInteger(ROWS) || ROWS < 1 || ROWS > 5_000) throw new Error('NODUS_BENCH_ROWS must be 1–5000');
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24+ is required');

const DATABASE = '11111111-1111-4111-8111-111111111111';
const STATUS = '22222222-2222-4222-8222-222222222222';
const SUMMARY = '33333333-3333-4333-8333-333333333333';
const VIEWS = {
  board: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  gallery: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  table: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
};
const OPTIONS = ['To do', 'In progress', 'Blocked', 'Review', 'Done'];
const OPTION_IDS = OPTIONS.map((_, index) => `44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`);

const properties = [
  { id: STATUS, name: 'Status', type: 'select', options: OPTIONS.map((name, index) => ({ id: OPTION_IDS[index], name })) },
  { id: SUMMARY, name: 'Summary', type: 'text' },
];
const database = { format: 'nodus-database', version: 1, id: DATABASE, name: 'Benchmark items', properties };
function savedView(id, name, type, settings) {
  return {
    format: 'nodus-database-view', version: 4, id, databaseId: DATABASE, name, type, settings,
    sort: { propertyId: 'title', direction: 'asc' }, sorts: [{ propertyId: 'title', direction: 'asc' }],
    filters: [], visiblePropertyIds: [STATUS, SUMMARY],
  };
}
const views = [
  savedView(VIEWS.board, 'Status board', 'kanban', { groupPropertyId: STATUS }),
  savedView(VIEWS.gallery, 'Gallery', 'gallery', {}),
  savedView(VIEWS.table, 'All items', 'table', {}),
];

function fence(viewId, height = 420) {
  return `\`\`\`nodus-view\ndatabase: ${DATABASE}\nview: ${viewId}\nheight: ${height}\n\`\`\``;
}

let noteCounter = 0;
function note(title, body) {
  const id = `f0000000-0000-4000-8000-${String(++noteCounter).padStart(12, '0')}`;
  return `---\ntitle: ${title}\nnodus:\n  version: 1\n  id: ${id}\n  createdAt: 2026-11-27T00:00:00Z\n  updatedAt: 2026-11-27T00:00:00Z\n---\n\n# ${title}\n\n${body}\n`;
}

const scenarios = [
  { name: 'board-1', title: 'Bench board 1', embeds: 1, body: fence(VIEWS.board) },
  { name: 'board-20', title: 'Bench board 20', embeds: 20, body: Array.from({ length: 20 }, () => fence(VIEWS.board)).join('\n\n') },
  { name: 'gallery-1', title: 'Bench gallery 1', embeds: 1, body: fence(VIEWS.gallery) },
  { name: 'gallery-20', title: 'Bench gallery 20', embeds: 20, body: Array.from({ length: 20 }, () => fence(VIEWS.gallery)).join('\n\n') },
  { name: 'mixed', title: 'Bench mixed', embeds: 3, body: [fence(VIEWS.table), fence(VIEWS.board), fence(VIEWS.gallery)].join('\n\n') },
];

const temporary = await mkdtemp(join(tmpdir(), 'nodus-embed-benchmark-'));
let child;
let browser;
let context;
try {
  const vault = join(temporary, 'vault');
  await mkdir(join(vault, 'notes'), { recursive: true });
  await mkdir(join(vault, 'databases'), { recursive: true });
  await mkdir(join(vault, 'database-views', DATABASE), { recursive: true });
  await writeFile(join(vault, 'databases', `${DATABASE}.json`), `${JSON.stringify(database, null, 2)}\n`);
  for (const view of views) {
    await writeFile(join(vault, 'database-views', DATABASE, `${view.id}.json`), `${JSON.stringify(view, null, 2)}\n`);
  }
  for (const scenario of scenarios) {
    await writeFile(join(vault, 'notes', `${scenario.title}.md`), note(scenario.title, scenario.body));
  }

  const reservation = createServer();
  await new Promise((resolveListen, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolveListen); });
  const port = reservation.address().port;
  await new Promise((resolveClose) => reservation.close(resolveClose));
  const base = `http://127.0.0.1:${port}`;

  child = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--config', 'ui/vite.config.ts', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root,
    env: {
      ...process.env,
      NODUS_VAULT: vault,
      NODUS_ALLOWED_ORIGINS: base,
      NODUS_PREFERENCES_PATH: join(temporary, 'preferences.json'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  await new Promise((ready, reject) => {
    const timer = setTimeout(() => reject(new Error(`Dedicated Vite startup timed out: ${logs}`)), 60_000);
    const finish = (error) => { clearTimeout(timer); if (error) reject(error); else ready(); };
    child.stdout.on('data', (data) => {
      logs = `${logs}${data}`.slice(-8_000);
      if (logs.replace(/\x1b\[[0-9;]*m/g, '').includes(`${base}/`)) finish();
    });
    child.stderr.on('data', (data) => { logs = `${logs}${data}`.slice(-8_000); });
    child.once('error', finish);
    child.once('exit', (code) => finish(new Error(`Dedicated Vite exited: ${code}. ${logs}`)));
  });

  const listed = await fetch(`${base}/api/databases`);
  assert.equal(listed.status, 200);
  const { databases } = await listed.json();
  const schemaHash = databases.find((entry) => entry.id === DATABASE)?.contentHash;
  assert.equal(typeof schemaHash, 'string', 'Benchmark database was not indexed');

  const rowsPayload = {
    databaseId: DATABASE,
    schemaHash,
    diagnostics: [],
    relationCandidates: {},
    rows: Array.from({ length: ROWS }, (_, index) => ({
      noteId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      databaseId: DATABASE,
      title: `Record ${String(index + 1).padStart(5, '0')}`,
      path: `records/record-${index + 1}.md`,
      updatedAt: '2026-10-31T00:00:00Z',
      contentHash: '0'.repeat(64),
      values: { [STATUS]: OPTION_IDS[index % OPTION_IDS.length], [SUMMARY]: `Summary value for record ${index + 1}` },
      issues: [],
    })),
  };
  const rowsBody = JSON.stringify(rowsPayload);

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1320, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let rowRequests = 0;
  let rowBytes = 0;
  await page.route(`**/api/databases/${DATABASE}/rows*`, async (route) => {
    rowRequests += 1;
    rowBytes = Buffer.byteLength(rowsBody);
    await route.fulfill({ status: 200, contentType: 'application/json', body: rowsBody });
  });

  const results = [];
  for (const scenario of scenarios) {
    rowRequests = 0;
    rowBytes = 0;
    await page.goto(`${base}/app`, { waitUntil: 'domcontentloaded' });
    const noteButton = page.getByTitle(scenario.title).first();
    await noteButton.waitFor({ state: 'visible', timeout: 30_000 });
    const started = await page.evaluate(() => performance.now());
    await noteButton.click();
    await page.getByRole('group', { name: 'Markdown rendering mode' }).getByRole('button', { name: 'Preview', exact: true }).click();
    try {
      await page.waitForFunction(
        ({ embeds }) => document.querySelectorAll('[data-testid="nodus-view-embed"]').length === embeds,
        { embeds: scenario.embeds },
        { timeout: 30_000 },
      );
    } catch (error) {
      const mounted = await page.evaluate(() => document.querySelectorAll('[data-testid="nodus-view-embed"]').length);
      throw new Error(`${scenario.name}: only ${mounted}/${scenario.embeds} embeds mounted within 30 s (${String(error)})`);
    }
    const readyAt = await page.evaluate(() => performance.now());

    // Responsiveness: two animation frames and a synchronous style read.
    const frames = await page.evaluate(() => new Promise((resolveFrames) => {
      const first = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => resolveFrames(performance.now() - first)));
    }));
    const interaction = await page.evaluate(() => {
      const start = performance.now();
      document.body.getBoundingClientRect();
      document.querySelectorAll('[data-testid="nodus-view-embed"] article').forEach((node) => node.getBoundingClientRect());
      return performance.now() - start;
    });

    const metrics = await page.evaluate(() => ({
      nodes: document.querySelectorAll('*').length,
      cards: document.querySelectorAll('[data-testid="nodus-view-embed"] article').length,
      limitedNotices: document.querySelectorAll('[data-testid="embed-layout-limited"]').length,
      heapBytes: performance.memory?.usedJSHeapSize ?? null,
    }));

    assert(metrics.cards > 0, `${scenario.name}: no cards rendered`);
    assert(metrics.nodes < 60_000, `${scenario.name}: ${metrics.nodes} DOM nodes`);
    assert(frames < 1_000, `${scenario.name}: two animation frames took ${frames} ms`);
    assert(interaction < 1_000, `${scenario.name}: card measurement took ${interaction} ms`);

    results.push({
      scenario: scenario.name,
      embeds: scenario.embeds,
      records: ROWS,
      initialRenderMs: Math.round(readyAt - started),
      rowRequests,
      payloadBytes: rowBytes,
      mountedCards: metrics.cards,
      cardsPerEmbed: Math.round((metrics.cards / scenario.embeds) * 10) / 10,
      domNodes: metrics.nodes,
      limitedNotices: metrics.limitedNotices,
      twoFramesMs: Math.round(frames),
      cardMeasureMs: Math.round(interaction * 10) / 10,
      heapBytes: metrics.heapBytes,
    });
    process.stdout.write(`${JSON.stringify(results.at(-1))}\n`);
  }

  assert.deepEqual(errors, []);
  const worst = results.reduce((slowest, entry) => entry.initialRenderMs > slowest.initialRenderMs ? entry : slowest, results[0]);
  process.stdout.write(`${JSON.stringify({
    node: process.version,
    browser: await browser.version(),
    platform: process.platform,
    viewport: '1320x900',
    records: ROWS,
    scenarios: results,
    worstInitialRenderMs: worst.initialRenderMs,
    worstScenario: worst.scenario,
  })}\n`);
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (child && child.exitCode === null) child.kill();
  if (child) await new Promise((resolveClose) => child.once('close', resolveClose));
  await rm(temporary, { recursive: true, force: true });
}
