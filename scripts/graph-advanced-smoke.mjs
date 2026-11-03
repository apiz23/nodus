import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = await mkdtemp(join(tmpdir(), 'nodus-graph-advanced-'));
process.env.NODUS_VAULT = root;
let server, browser;
try {
  server = await createServer({ configFile: 'ui/vite.config.ts', server: { port: 0, strictPort: false } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  process.env.NODUS_ALLOWED_ORIGINS = base;
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`${base}/api${path}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const data = await response.json();
    assert(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
    return data;
  };
  const create = async (title, body = '') => {
    const { note } = await request('/notes', 'POST', { title });
    if (body !== '') await request(`/notes/${note.id}`, 'PUT', { title: note.title, body, baseHash: note.contentHash });
    return note;
  };
  await create('Graph alpha', '[[Graph beta]]');
  await create('Graph beta', '[[Graph gamma]]');
  await create('Graph gamma', '');
  await create('Lone note', '');

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${base}/app`);
  await page.getByRole('button', { name: 'Local graph', exact: true }).click();
  await page.getByRole('heading', { name: 'Local graph', exact: true }).waitFor();

  await page.getByRole('combobox', { name: 'Filter by knowledge cluster' }).click();
  await page.getByRole('option', { name: /3 notes/ }).click();
  await page.getByText('3 of 4 notes shown', { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Cluster insights', exact: true }).waitFor();
  await page.getByText('Internal links', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Select Graph alpha' }).click();
  await page.getByRole('button', { name: 'Choose path destination' }).click();
  await page.getByRole('option', { name: /Graph gamma/ }).click();
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  await page.getByText('2 links', { exact: true }).waitFor();
  await page.getByText(/Recent paths/).waitFor();
  await page.getByRole('button', { name: 'Select Graph beta' }).click();
  await page.getByRole('heading', { name: 'Incoming links (1)', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Explore neighbors', exact: true }).click();
  await page.getByRole('button', { name: 'Select Graph alpha' }).click();
  await page.getByRole('button', { name: 'Explore neighbors', exact: true }).click();
  await page.getByRole('button', { name: 'Previous focus', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Previous focus', exact: true }).click();

  await page.getByLabel('Filter notes by title or path').fill('Graph');
  await page.getByRole('button', { name: 'Save current graph view' }).click();
  await page.getByLabel('Name').fill('Smoke graph view');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.getByRole('combobox', { name: 'Saved graph view' }).click();
  await page.getByRole('option', { name: 'Smoke graph view' }).waitFor();
  await page.keyboard.press('Escape');
  assert((await page.evaluate(() => localStorage.getItem(Object.keys(localStorage).find((key) => key.includes('nodus.graph-views')) ?? ''))) !== null);

  await page.getByLabel('Filter notes by title or path').fill('Gamma');
  await page.getByRole('button', { name: 'Update selected graph view' }).click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Local graph', exact: true }).click();
  await page.getByRole('combobox', { name: 'Saved graph view' }).click();
  await page.getByRole('option', { name: 'Smoke graph view' }).click();
  await page.waitForFunction(() => document.querySelector('#graph-filter')?.value === 'Gamma');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export saved graph views' }).click(),
  ]);
  const exportedPath = await download.path();
  assert(exportedPath);
  await page.getByRole('button', { name: 'Saved view actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('alertdialog', { name: 'Delete this saved graph view?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('combobox', { name: 'Saved graph view' }).click();
  assert.equal(await page.getByRole('option', { name: 'Smoke graph view' }).count(), 0);
  await page.keyboard.press('Escape');
  await page.getByLabel('Choose graph views JSON file').setInputFiles(exportedPath);
  await page.getByRole('heading', { name: 'Import graph views', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Apply import', exact: true }).click();
  await page.getByRole('combobox', { name: 'Saved graph view' }).click();
  await page.getByRole('option', { name: 'Smoke graph view' }).waitFor();
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log('Advanced graph smoke passed: cluster filtering and insights, shortest path and history, neighbor focus history, saved view create/update/export/delete/import, vault-scoped localStorage, and console cleanliness.');
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
