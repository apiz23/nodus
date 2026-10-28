import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = await mkdtemp(join(tmpdir(), 'nodus-search-'));
const vault = join(root, 'first');
const secondVault = join(root, 'second');
await Promise.all([mkdir(vault), mkdir(secondVault)]);
process.env.NODUS_VAULT = vault;
process.env.NODUS_VAULT_ROOTS = root;
let server;
let browser;
try {
  server = await createServer({ configFile: 'ui/vite.config.ts', server: { port: 0, strictPort: false } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  process.env.NODUS_ALLOWED_ORIGINS = base;
  const request = async (path, method = 'GET', body) => {
    const result = await fetch(`${base}/api${path}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    assert(result.ok, `${method} ${path}: ${result.status}`);
    return result.json();
  };
  const create = async (title, body = '') => {
    const { note } = await request('/notes', 'POST', { title });
    if (body) return (await request(`/notes/${note.id}`, 'PUT', { title, body, baseHash: note.contentHash })).note;
    return note;
  };
  const exact = await create('Planning');
  const alias = await create('Alias destination');
  await create('Planning board');
  const content = await create('Content destination', `${'Context before. '.repeat(50)}Markdown **planning** and needle discovery. ${'After. '.repeat(50)}`);
  const aliasFile = join(vault, alias.path);
  const aliasText = await readFile(aliasFile, 'utf8');
  assert(aliasText.includes('\nnodus:'));
  await writeFile(aliasFile, aliasText.replace('\nnodus:', '\naliases:\n  - Planning\nnodus:'));

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  const search = page.getByRole('searchbox', { name: 'Search notes', exact: true });
  const rows = page.locator('[data-search-result="true"]');
  const waitRows = async (count) => page.waitForFunction((n) => document.querySelectorAll('[data-search-result="true"]').length === n, count);
  const waitTitle = async (title) => page.waitForFunction((value) => document.querySelector('#note-title')?.value === value, title);
  const checkRanking = async () => {
    await waitRows(4);
    assert.deepEqual(await rows.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label'))),
      ['Open Planning', 'Open Alias destination', 'Open Planning board', 'Open Content destination']);
  };
  await search.fill('planning');
  await checkRanking();
  assert.match(await rows.nth(1).innerText(), /Alias: Planning/);
  assert.equal(await rows.nth(1).locator('mark').innerText(), 'Planning');
  await search.press('Enter');
  await waitTitle(exact.title);
  await search.focus();
  await search.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await waitTitle(alias.title);
  await search.focus();
  await search.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await waitTitle(content.title);
  await search.fill('needle');
  await waitRows(1);
  assert.match(await rows.first().innerText(), /Content: ….*needle/);
  assert.equal(await rows.first().locator('mark').innerText(), 'needle');
  await search.fill('not-present-anywhere');
  await page.getByText('No matches', { exact: true }).waitFor();
  await search.press('Escape');
  assert.equal(await search.inputValue(), '');
  await page.getByRole('tree', { name: 'Pages', exact: true }).waitFor();

  // Errors are actionable and retry performs a fresh request for the same query.
  let failNext = true;
  const refreshedQueries = [];
  await page.route('**/api/search?**', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('q') === 'planning' && failNext) {
      failNext = false;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Search temporarily unavailable' } }) });
    } else {
      if (url.searchParams.get('refresh') === 'true') refreshedQueries.push(url.searchParams.get('q'));
      await route.continue();
    }
  });
  await search.fill('planning');
  await page.getByRole('alert').filter({ hasText: 'Search temporarily unavailable' }).waitFor();
  assert.equal(await rows.count(), 0);
  await page.getByRole('button', { name: 'Retry search' }).click();
  await checkRanking();
  await search.fill('needle');
  await waitRows(1);
  assert.deepEqual(refreshedQueries, ['planning'], 'Retry must refresh once without forcing disk scans on later queries');
  await page.unroute('**/api/search?**');

  const delayedSearch = async (query) => {
    let release;
    let started;
    let finished;
    const start = new Promise((resolve) => { started = resolve; });
    const done = new Promise((resolve) => { finished = resolve; });
    const handler = async (route) => {
      if (new URL(route.request().url()).searchParams.get('q') !== query) return route.continue();
      started();
      await new Promise((resolve) => { release = resolve; });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [{ ...exact, title: 'STALE RESULT', snippet: 'stale' }] }) }).catch(() => {});
      finished();
    };
    await page.route('**/api/search?**', handler);
    return { start, release: async () => { release(); await done; await page.unroute('**/api/search?**', handler); } };
  };
  const slow = await delayedSearch('slow-query');
  await search.fill('slow-query');
  await slow.start;
  await search.fill('planning');
  await checkRanking();
  await slow.release();
  assert.equal(await page.getByText('STALE RESULT', { exact: true }).count(), 0);

  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${modifier}+k`);
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  const paletteInput = palette.getByRole('combobox');
  await paletteInput.fill('planning');
  await palette.getByRole('option', { name: 'Open Alias destination', exact: true }).waitFor();
  assert.equal(await palette.locator('[cmdk-item][data-selected="true"]').getAttribute('aria-label'), 'Open Planning');
  await paletteInput.press('ArrowDown');
  await paletteInput.press('Enter');
  await waitTitle(alias.title);
  await palette.waitFor({ state: 'hidden' });

  // Old palette responses must also disappear when the vault changes.
  await page.keyboard.press(`${modifier}+k`);
  const oldVault = await delayedSearch('old-vault');
  await paletteInput.fill('old-vault');
  await oldVault.start;
  await paletteInput.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('textbox', { name: 'Vault folder' }).fill(secondVault);
  await page.getByRole('textbox', { name: 'Vault folder' }).press('Enter');
  await page.getByRole('button', { name: 'New page', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('#vault-path') === null);
  await oldVault.release();
  await search.fill('planning');
  await page.getByText('No matches', { exact: true }).waitFor();
  await page.keyboard.press(`${modifier}+k`);
  await paletteInput.fill('planning');
  await palette.getByText('No results.', { exact: true }).waitFor();
  assert.equal(await page.getByText('STALE RESULT', { exact: true }).count(), 0);
  await paletteInput.fill('');
  await palette.getByRole('option', { name: 'Knowledge discovery' }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Search browser smoke passed: ranking, alias/content context, Enter/arrows/Home/End navigation, no results, empty queries, error retry, delayed responses, palette selection, and vault isolation.');
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
