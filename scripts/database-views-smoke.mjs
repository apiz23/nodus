import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, realpath, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB = '33333333-3333-4333-8333-333333333333';
const STATUS = '44444444-4444-4444-8444-444444444444';
const DATE = '55555555-5555-4555-8555-555555555555';
const NUMBER = '77777777-7777-4777-8777-777777777777';
const READY = '66666666-6666-4666-8666-666666666666';
const DONE = '88888888-8888-4888-8888-888888888888';
const SECOND_DB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24+ is required');

const temporary = await mkdtemp(join(tmpdir(), 'nodus-database-views-'));
let child, browser, context;
let closed;
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
  closed = new Promise((resolveClose) => child.once('close', resolveClose));
  let logs = '';
  await new Promise((ready, reject) => {
    const timer = setTimeout(() => reject(new Error(`Dedicated Vite startup timed out: ${logs}`)), 30_000);
    const finish = (error) => { clearTimeout(timer); if (error) reject(error); else ready(); };
    child.stdout.on('data', (data) => {
      logs = `${logs}${data}`.slice(-6000);
      // Vite colorizes its ready URL even when stdout is piped.
      if (logs.replace(/\x1b\[[0-9;]*m/g, '').includes(`${base}/`)) finish();
    });
    child.stderr.on('data', (data) => { logs = `${logs}${data}`.slice(-6000); });
    child.once('error', finish);
    child.once('exit', (code) => finish(new Error(`Dedicated Vite exited: ${code}. ${logs}`)));
  });
  async function request(path, method = 'GET', body) {
    const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    assert(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
    return data;
  }
  const status = await request('/api/status');
  assert.equal(status.vault.path, await realpath(vault), 'Dedicated child is using the wrong vault');
  assert.equal(status.counts.notes, 0);
  await request('/api/databases', 'POST', { database: { id: DB, name: 'View tests', properties: [
    { id: STATUS, name: 'Status', type: 'select', options: [{ id: READY, name: 'Ready' }, { id: DONE, name: 'Done' }] },
    { id: DATE, name: 'Due', type: 'date' }, { id: NUMBER, name: 'Estimate', type: 'number' },
  ] } });
  await request('/api/databases', 'POST', { database: { id: SECOND_DB, name: 'Z other database', properties: [] } });
  async function fixture(title, values) {
    let { note } = await request('/api/notes', 'POST', { title });
    for (const [propertyId, value] of values) {
      const result = await request(`/api/notes/${note.id}/properties`, 'PUT', { databaseId: DB, propertyId, value, baseHash: note.contentHash, confirmCreate: true });
      note = { ...note, contentHash: result.contentHash };
    }
    return note;
  }
  const alpha = await fixture('Alpha card', [[STATUS, READY], [DATE, '2026-10-28']]);
  const beta = await fixture('Beta card', [[NUMBER, 2]]);
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext();
  const page = await context.newPage();
  const errors = [], failures = [], expectedFailures = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/(409 \(Conflict\)|500 \(Internal Server Error\))/.test(message.text())) errors.push(message.text()); });
  page.on('response', (response) => { if (new URL(response.url()).pathname.startsWith('/api/') && response.status() >= 400) failures.push([response.request().method(), new URL(response.url()).pathname, response.status()]); });
  await page.goto(`${base}/app`);
  await page.getByRole('button', { name: 'Databases', exact: true }).click();
  await page.getByRole('heading', { name: 'View tests', exact: true }).waitFor();
  const controls = page.getByRole('region', { name: 'Saved database views' });
  const selector = controls.getByLabel('View', { exact: true });
  async function createView(name, type) {
    await controls.getByRole('button', { name: 'New view', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create saved view' });
    await dialog.getByLabel('View name', { exact: true }).fill(name);
    await dialog.getByRole('combobox', { name: 'View type', exact: true }).click();
    await page.getByRole('option', { name: type === 'table' ? 'Table' : type === 'list' ? 'List' : type === 'kanban' ? 'Kanban (Select property)' : 'Calendar (Date property)', exact: true }).click();
    const saved = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/databases/${DB}/views` && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'Create view', exact: true }).click();
    const response = await saved;
    assert.equal(response.status(), 201);
    await dialog.waitFor({ state: 'hidden' });
    return (await response.json()).view.view.id;
  }
  const tableId = await createView('My table', 'table');
  await page.getByRole('button', { name: 'Sort descending', exact: true }).click();
  await page.getByRole('button', { name: /^Columns,/ }).click();
  await page.getByRole('group', { name: 'Visible columns' }).getByRole('checkbox', { name: /Estimate/ }).uncheck();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Filter rows/ }).click();
  await page.getByRole('button', { name: 'Add filter', exact: true }).click();
  await page.getByRole('combobox', { name: 'Filter 1 property', exact: true }).click();
  await page.getByRole('option', { name: 'Status', exact: true }).click();
  await page.getByRole('combobox', { name: 'Filter 1 operator', exact: true }).click();
  await page.getByRole('option', { name: 'is', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: 'Group rows by', exact: true }).click();
  await page.getByRole('option', { name: 'Status', exact: true }).click();
  const readyTableGroup = page.getByRole('button', { name: 'Ready', exact: true });
  await readyTableGroup.waitFor();
  assert.equal(await readyTableGroup.getAttribute('aria-expanded'), 'true');
  await readyTableGroup.press('Enter');
  assert.equal(await readyTableGroup.getAttribute('aria-expanded'), 'false');
  await readyTableGroup.press('Enter');
  await controls.getByRole('button', { name: 'Save view', exact: true }).click();
  await controls.getByText('View saved to this vault.', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Databases', exact: true }).click();
  await page.getByRole('button', { name: 'Sort ascending', exact: true }).waitFor();
  assert.match(await selector.innerText(), /My table/);
  assert.equal(await page.getByRole('table').getByRole('button', { name: beta.title, exact: true }).count(), 0);
  assert.equal(await page.getByRole('columnheader', { name: 'Estimate', exact: true }).count(), 0);
  const tableFile = JSON.parse(await readFile(join(vault, 'database-views', DB, `${tableId}.json`), 'utf8'));
  assert.equal(tableFile.sort.direction, 'desc');
  assert.equal(tableFile.filters[0].value, READY);
  assert.equal(tableFile.settings.groupPropertyId, STATUS);
  assert.equal(await page.getByRole('button', { name: 'Ready', exact: true }).getAttribute('aria-expanded'), 'true');

  const listId = await createView('My list', 'list');
  const list = page.getByRole('region', { name: 'Database list view' });
  await list.getByRole('article', { name: alpha.title }).waitFor();
  await list.getByRole('button', { name: alpha.title, exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Group rows by', exact: true }).click();
  await page.getByRole('option', { name: 'Status', exact: true }).click();
  const readyListGroup = list.getByRole('button', { name: 'Ready', exact: true });
  await readyListGroup.waitFor();
  assert.equal(await readyListGroup.getAttribute('aria-expanded'), 'true');
  await readyListGroup.press('Enter');
  await list.getByRole('article', { name: alpha.title }).waitFor({ state: 'detached' });
  await readyListGroup.press('Enter');
  await list.getByRole('article', { name: alpha.title }).waitFor();
  await page.getByRole('button', { name: /^Columns,/ }).click();
  await page.getByRole('group', { name: 'Visible columns' }).getByRole('checkbox', { name: /Estimate/ }).uncheck();
  await page.keyboard.press('Escape');
  await controls.getByRole('button', { name: 'Save view', exact: true }).click();
  await controls.getByText('View saved to this vault.', { exact: true }).waitFor();
  const listFile = JSON.parse(await readFile(join(vault, 'database-views', DB, `${listId}.json`), 'utf8'));
  assert.equal(listFile.version, 3);
  assert.equal(listFile.type, 'list');
  assert.equal(listFile.settings.groupPropertyId, STATUS);
  assert.equal(listFile.visiblePropertyIds.includes(NUMBER), false);
  await page.getByRole('button', { name: alpha.title, exact: true }).click();
  await page.getByRole('textbox', { name: 'Note title', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Databases', exact: true }).click();
  await page.getByRole('heading', { name: 'View tests', exact: true }).waitFor();
  await page.getByRole('button', { name: /View tests/ }).click();
  await controls.getByRole('combobox', { name: 'View', exact: true }).waitFor();

  const boardId = await createView('My board', 'kanban');
  const board = page.getByRole('region', { name: 'Kanban grouped by Status' });
  await board.getByRole('region', { name: 'Ready column' }).getByRole('article', { name: alpha.title }).waitFor();
  await board.getByRole('region', { name: 'Unassigned column' }).getByRole('article', { name: beta.title }).waitFor();
  await board.getByRole('button', { name: `Move ${alpha.title}`, exact: true }).press('Enter');
  const editor = page.getByRole('region', { name: 'Edit card property' });
  assert.equal(await editor.evaluate((element) => element === document.activeElement), true, 'Move card did not focus the editor');
  await editor.getByRole('button', { name: 'Edit card Status', exact: true }).press('Enter');
  await page.getByRole('menuitemradio', { name: 'Done', exact: true }).press('Enter');
  await editor.getByRole('button', { name: 'Save card', exact: true }).press('Enter');
  await board.getByRole('region', { name: 'Done column' }).getByRole('article', { name: alpha.title }).waitFor();
  await board.getByRole('button', { name: `Move ${alpha.title}`, exact: true }).click();
  await editor.getByRole('button', { name: 'Clear value', exact: true }).click();
  await editor.getByRole('button', { name: 'Save card', exact: true }).click();
  await board.getByRole('region', { name: 'Unassigned column' }).getByRole('article', { name: alpha.title }).waitFor();
  const cleared = await request(`/api/notes/${alpha.id}/properties`);
  assert.equal(Object.hasOwn(cleared.rows[0].values, STATUS), false);

  await controls.getByRole('button', { name: 'Duplicate view', exact: true }).click();
  await page.getByRole('dialog', { name: 'Duplicate saved view' }).getByRole('button', { name: 'Create duplicate', exact: true }).click();
  await controls.getByText('View saved to this vault.', { exact: true }).waitFor();
  assert.match(await selector.innerText(), /My board copy/);
  await controls.getByRole('button', { name: 'Rename view', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Rename saved view' });
  await rename.getByLabel('View name', { exact: true }).fill('Board duplicate');
  await rename.getByRole('button', { name: 'Rename and save', exact: true }).click();
  await rename.waitFor({ state: 'hidden' });
  await controls.getByRole('button', { name: 'Delete view', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete view', exact: true }).click();
  await controls.getByText('View deleted. Notes were kept.', { exact: true }).waitFor();

  const calendarId = await createView('My calendar', 'calendar');
  await page.getByLabel('Month', { exact: true }).fill('2026-10');
  const calendar = page.getByRole('region', { name: 'Calendar by Due' });
  await calendar.getByRole('table').getByRole('article', { name: alpha.title }).waitFor();
  await calendar.getByRole('region', { name: 'Undated notes' }).getByRole('article', { name: beta.title }).waitFor();
  await calendar.getByRole('button', { name: `Change date for ${beta.title}`, exact: true }).click();
  await editor.getByLabel('Edit card Due', { exact: true }).fill('2026-10-29');
  await editor.getByRole('button', { name: 'Save card', exact: true }).click();
  await calendar.getByRole('table').getByRole('article', { name: beta.title }).waitFor();
  assert.equal((await request(`/api/notes/${beta.id}/properties`)).rows[0].values[DATE], '2026-10-29');
  await page.getByRole('button', { name: 'Create note on 2026-10-30', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create a dated note' });
  await create.getByLabel('Title', { exact: true }).fill('Created from calendar');
  await create.getByRole('button', { name: 'Create note and add date', exact: true }).click();
  await create.waitFor({ state: 'hidden' });
  await calendar.getByRole('article', { name: 'Created from calendar' }).waitFor();
  const created = (await request('/api/notes')).notes.find((note) => note.title === 'Created from calendar');
  assert(created);
  assert.equal((await request(`/api/notes/${created.id}/properties`)).rows[0].values[DATE], '2026-10-30');

  // A real external note edit must reject the stale card hash and keep its draft.
  await calendar.getByRole('button', { name: `Change date for ${beta.title}`, exact: true }).click();
  await editor.getByLabel('Edit card Due', { exact: true }).fill('2026-11-01');
  const latestBeta = (await request(`/api/notes/${beta.id}`)).note;
  await request(`/api/notes/${beta.id}`, 'PUT', { title: latestBeta.title, body: 'External body edit is preserved.', baseHash: latestBeta.contentHash });
  expectedFailures.push(['PUT', `/api/notes/${beta.id}/properties`, 409]);
  await editor.getByRole('button', { name: 'Save card', exact: true }).click();
  await page.getByRole('button', { name: 'Reload latest note, keep draft', exact: true }).click();
  await page.getByText('Latest stored values loaded. Your draft is still here; review it and save again.', { exact: true }).waitFor();
  assert.equal(await editor.getByLabel('Edit card Due', { exact: true }).inputValue(), '2026-11-01');
  await editor.getByRole('button', { name: 'Save card', exact: true }).click();
  await editor.waitFor({ state: 'hidden' });
  assert.equal((await request(`/api/notes/${beta.id}`)).note.body, 'External body edit is preserved.');
  assert.equal((await request(`/api/notes/${beta.id}/properties`)).rows[0].values[DATE], '2026-11-01');

  // A failed second API operation keeps the created note and retries its ID.
  let injected = false;
  const propertyRoute = '**/api/notes/*/properties';
  await page.route(propertyRoute, async (route) => {
    const request = route.request();
    if (request.method() === 'PUT' && request.postDataJSON().value === '2026-10-31' && !injected) {
      injected = true;
      expectedFailures.push(['PUT', new URL(request.url()).pathname, 500]);
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INJECTED_FAILURE', message: 'Injected date-assignment failure.' } }) });
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Create note on 2026-10-31', exact: true }).click();
  await create.getByLabel('Title', { exact: true }).fill('Retained calendar note');
  await create.getByRole('button', { name: 'Create note and add date', exact: true }).click();
  await create.getByRole('alert').filter({ hasText: 'The note was created and kept' }).waitFor();
  const kept = (await request('/api/notes')).notes.filter((note) => note.title === 'Retained calendar note');
  assert.equal(kept.length, 1);
  await create.getByRole('button', { name: 'Retry date assignment', exact: true }).click();
  await create.waitFor({ state: 'hidden' });
  await page.unroute(propertyRoute);
  assert.equal((await request('/api/notes')).notes.filter((note) => note.title === 'Retained calendar note').length, 1);
  assert.equal((await request(`/api/notes/${kept[0].id}/properties`)).rows[0].values[DATE], '2026-10-31');

  const stored = (await request(`/api/databases/${DB}/views/${calendarId}`)).view;
  await request(`/api/databases/${DB}/views/${calendarId}`, 'PUT', { view: { ...stored.view, name: 'Externally renamed' }, baseHash: stored.contentHash });
  await page.getByRole('button', { name: 'Sort descending', exact: true }).click();
  expectedFailures.push(['PUT', `/api/databases/${DB}/views/${calendarId}`, 409]);
  const staleResponse = page.waitForResponse((response) => response.status() === 409 && new URL(response.url()).pathname.endsWith(calendarId));
  await controls.getByRole('button', { name: 'Save view', exact: true }).click();
  await staleResponse;
  await controls.getByRole('alert').filter({ hasText: 'Your settings are still here' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Sort ascending', exact: true }).count(), 1, 'Stale failure lost the draft sort');
  await controls.getByRole('button', { name: 'Reload saved view', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Sort descending', exact: true }).waitFor();
  // A delayed view write can complete in storage after switching databases,
  // but must not apply its configuration or feedback to the new selection.
  let releaseSave, enteredSave;
  const barrier = new Promise((resolveBarrier) => { releaseSave = resolveBarrier; });
  const entered = new Promise((resolveEntered) => { enteredSave = resolveEntered; });
  const viewRoute = `**/api/databases/${DB}/views/${calendarId}`;
  await page.route(viewRoute, async (route) => {
    if (route.request().method() === 'PUT') { enteredSave(); await barrier; }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Sort descending', exact: true }).click();
  await controls.getByRole('button', { name: 'Save view', exact: true }).click();
  await entered;
  const completion = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname.endsWith(calendarId));
  await page.getByRole('button', { name: /Z other database —/ }).click();
  await page.getByRole('heading', { name: 'Z other database', exact: true }).waitFor();
  releaseSave();
  assert.equal((await completion).status(), 200);
  await page.waitForFunction(() => document.querySelector('[aria-label="Saved database views"] [data-slot="select-trigger"]')?.hasAttribute('disabled') === false);
  assert.equal((await selector.innerText()).trim(), 'Unsaved table');
  assert.equal(await controls.getByText('View saved to this vault.', { exact: true }).count(), 0);
  assert.equal((await request(`/api/databases/${DB}/views/${calendarId}`)).view.view.sort.direction, 'desc');
  assert.equal((await request(`/api/databases/${SECOND_DB}/views`)).views.length, 0);
  await page.unroute(viewRoute);
  assert.deepEqual(failures, expectedFailures);
  assert.deepEqual(errors, []);
  console.log('Database views smoke passed: saved table reload/filter/columns/sort, table/list grouping and collapse, board moves and clearing, duplicate/rename/delete, calendar assignment/creation, stale note/view drafts, failed creation recovery, deferred save selection isolation.');
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    await closed;
    clearTimeout(timer);
  }
  await rm(temporary, { recursive: true, force: true });
}
