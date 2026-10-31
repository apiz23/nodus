import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB = '11111111-1111-4111-8111-111111111111';
const STATUS = '22222222-2222-4222-8222-222222222222';
const SUMMARY = '33333333-3333-4333-8333-333333333333';
const ROWS = Number(process.env.NODUS_BROWSER_ROWS ?? 5000);
if (!Number.isInteger(ROWS) || ROWS < 1 || ROWS > 10000) throw new Error('NODUS_BROWSER_ROWS must be 1–10000');
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24+ is required');

const temporary = await mkdtemp(join(tmpdir(), 'nodus-database-performance-'));
let child, browser, context;
try {
  const vault = join(temporary, 'vault');
  await mkdir(vault);
  const reservation = createServer();
  await new Promise((resolveListen, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolveListen); });
  const port = reservation.address().port;
  await new Promise((resolveClose) => reservation.close(resolveClose));
  const base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--config', 'ui/vite.config.ts', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root, env: { ...process.env, NODUS_VAULT: vault, NODUS_ALLOWED_ORIGINS: base }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  await new Promise((ready, reject) => {
    const timer = setTimeout(() => reject(new Error(`Dedicated Vite startup timed out: ${logs}`)), 30_000);
    const finish = (error) => { clearTimeout(timer); if (error) reject(error); else ready(); };
    child.stdout.on('data', (data) => {
      logs = `${logs}${data}`.slice(-6000);
      if (logs.replace(/\x1b\[[0-9;]*m/g, '').includes(`${base}/`)) finish();
    });
    child.stderr.on('data', (data) => { logs = `${logs}${data}`.slice(-6000); });
    child.once('error', finish);
    child.once('exit', (code) => finish(new Error(`Dedicated Vite exited: ${code}. ${logs}`)));
  });
  const create = await fetch(`${base}/api/databases`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ database: { id: DB, name: 'Performance sample', properties: [
      { id: STATUS, name: 'Status', type: 'select', options: Array.from({ length: 20 }, (_, index) => ({ id: `44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`, name: `Status ${index}` })) },
      { id: SUMMARY, name: 'Summary', type: 'text' },
    ] } }),
  });
  assert.equal(create.status, 201);
  const { database } = await create.json();
  let responseBytes = 0;
  const rowsResponse = () => ({
    databaseId: DB, schemaHash: database.contentHash, diagnostics: [], relationCandidates: {},
    rows: Array.from({ length: ROWS }, (_, index) => ({
      noteId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      databaseId: DB, title: `Record ${String(index + 1).padStart(5, '0')}`,
      path: `records/record-${index + 1}.md`, updatedAt: '2026-10-31T00:00:00Z', contentHash: '0'.repeat(64),
      values: { [STATUS]: `44444444-4444-4444-8444-${String(index % 20 + 1).padStart(12, '0')}`, [SUMMARY]: `Summary value for record ${index + 1}` }, issues: [],
    })),
  });

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(`**/api/databases/${DB}/rows*`, async (route) => {
    const response = rowsResponse();
    const body = JSON.stringify(response);
    responseBytes = Buffer.byteLength(body);
    await route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  await page.goto(`${base}/app`);
  const start = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: 'Databases', exact: true }).click();
  await page.getByRole('heading', { name: 'Performance sample', exact: true }).waitFor();
  await page.waitForFunction((count) => {
    const table = document.querySelector('table[aria-rowcount]');
    return table?.getAttribute('aria-rowcount') === String(count + 1) && table.querySelectorAll('tbody tr[data-index]').length > 0;
  }, ROWS);
  const desktopReady = await page.evaluate(() => performance.now());
  const initialRowCount = await page.locator('[data-slot="table-body"] tr[data-index]').count();
  const table = page.getByRole('table');
  assert.equal(await table.getAttribute('aria-rowcount'), String(ROWS + 1));
  const tableRegion = page.getByRole('region', { name: 'Database table records', exact: true });
  await tableRegion.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.waitForFunction((count) => [...document.querySelectorAll('tbody tr[data-index]')].some((row) => row.getAttribute('aria-rowindex') === String(count + 1)), ROWS);
  await tableRegion.evaluate((element) => { element.scrollTop = 0; });
  await page.getByRole('button', { name: 'Sort descending', exact: true }).click();
  await page.getByRole('button', { name: 'Record 05000', exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Group rows by', exact: true }).click();
  await page.getByRole('option', { name: 'Status', exact: true }).click();
  const statusTableGroup = page.getByRole('button', { name: 'Status 0', exact: true });
  await statusTableGroup.waitFor();
  assert.equal(await statusTableGroup.getAttribute('aria-expanded'), 'true');
  await statusTableGroup.press('Enter');
  assert.equal(await statusTableGroup.getAttribute('aria-expanded'), 'false');
  await statusTableGroup.press('Enter');
  assert.equal(await table.getAttribute('aria-rowcount'), String(ROWS + 21));

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.locator('[data-slot="table-container"]').evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  assert(mobile.scrollWidth > mobile.clientWidth, 'Mobile Table view should retain an accessible horizontal scroll area');
  await page.setViewportSize({ width: 1280, height: 900 });

  const controls = page.getByRole('region', { name: 'Saved database views', exact: true });
  await controls.getByRole('button', { name: 'New view', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create saved view', exact: true });
  await dialog.getByLabel('View name', { exact: true }).fill('Performance list');
  await dialog.getByRole('combobox', { name: 'View type', exact: true }).click();
  await page.getByRole('option', { name: 'List', exact: true }).click();
  const listCreated = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/databases/${DB}/views` && response.request().method() === 'POST');
  const listStart = await page.evaluate(() => performance.now());
  await dialog.getByRole('button', { name: 'Create view', exact: true }).click();
  assert.equal((await listCreated).status(), 201);
  await dialog.waitFor({ state: 'hidden' });
  const list = page.getByRole('region', { name: 'Database list view', exact: true });
  await list.getByRole('article', { name: 'Record 00001', exact: true }).waitFor();
  const listReady = await page.evaluate(() => performance.now());
  const listRowsRendered = await list.getByRole('article').count();
  assert(listRowsRendered > 0 && listRowsRendered < ROWS, `Expected a windowed List subset, got ${listRowsRendered} of ${ROWS}`);
  await page.getByRole('combobox', { name: 'Group rows by', exact: true }).click();
  await page.getByRole('option', { name: 'Status', exact: true }).click();
  const statusListGroup = page.getByRole('button', { name: 'Status 0', exact: true });
  await statusListGroup.waitFor();
  await statusListGroup.press('Enter');
  assert.equal(await statusListGroup.getAttribute('aria-expanded'), 'false');
  await statusListGroup.press('Enter');
  await list.getByRole('article', { name: 'Record 00001', exact: true }).waitFor();

  assert(initialRowCount > 0 && initialRowCount < ROWS, `Expected a windowed row subset, got ${initialRowCount} of ${ROWS}`);
  assert.deepEqual(errors, []);
  process.stdout.write(`${JSON.stringify({ node: process.version, browser: await browser.version(), platform: process.platform, viewport: { desktop: '1280x900', mobile: '390x844' }, records: ROWS, responseBytes, tableRowsRendered: initialRowCount, tableLoadAndRenderMs: desktopReady - start, listRowsRendered: listRowsRendered, listSwitchAndRenderMs: listReady - listStart, mobileTableScroll: mobile })}\n`);
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (child && child.exitCode === null) child.kill();
  if (child) await new Promise((resolveClose) => child.once('close', resolveClose));
  await rm(temporary, { recursive: true, force: true });
}
