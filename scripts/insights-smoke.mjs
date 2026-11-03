import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = await mkdtemp(join(tmpdir(), 'nodus-insights-'));
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
  const a = await create('Graph alpha', '[[Graph beta]] [[Graph gamma]]');
  await create('Graph beta', '[[Graph gamma]]');
  await create('Graph gamma', '');
  await create('Lone note', '');

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  let expectInjectedFailure = false;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (expectInjectedFailure && /status of 500/i.test(message.text())) return;
    errors.push(message.text());
  });
  await page.goto(`${base}/app`);
  await page.getByRole('button', { name: 'Knowledge health', exact: true }).click();
  await page.getByRole('heading', { name: 'Knowledge health', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Vault overview', exact: true }).waitFor();
  await page.getByText('4', { exact: true }).first().waitFor();
  await page.getByText('2 connected components', { exact: true }).waitFor();
  await page.getByRole('heading', { name: /Knowledge clusters/ }).waitFor();
  await page.getByRole('button', { name: /Graph alpha/ }).first().waitFor();
  const betaButtons = page.getByRole('button').filter({ hasText: 'Graph beta' });
  await betaButtons.last().click();
  await page.waitForFunction(() => document.querySelector('#note-title')?.value === 'Graph beta');
  const related = page.getByRole('button', { name: /Open related note Graph alpha/ });
  await related.waitFor();
  await related.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#note-title')?.value === 'Graph alpha');

  await page.getByRole('button', { name: 'Knowledge health', exact: true }).click();
  await page.getByRole('heading', { name: 'Vault overview', exact: true }).waitFor();
  let fail = true;
  expectInjectedFailure = true;
  await page.route('**/api/insights**', async (route) => {
    if (fail) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INJECTED', message: 'Injected insights failure' } }) });
    } else {
      await route.continue();
    }
  });
  await page.getByRole('button', { name: 'Refresh from disk' }).click();
  await page.getByRole('alert').filter({ hasText: 'Injected insights failure' }).waitFor();
  fail = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('heading', { name: 'Vault overview', exact: true }).waitFor();
  expectInjectedFailure = false;
  await page.unroute('**/api/insights**');

  const notes = (await request('/notes')).notes;
  for (const summary of notes) {
    const { note } = await request(`/notes/${summary.id}`);
    await request(`/notes/${summary.id}`, 'DELETE', { baseHash: note.contentHash });
  }
  await page.getByRole('button', { name: 'Refresh from disk' }).click();
  await page.getByRole('heading', { name: 'No notes to analyze yet', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  assert.deepEqual(errors, []);
  console.log('Insights browser smoke passed: dashboard metrics, clusters, related-note navigation, error/retry, empty state, responsive overflow, and console cleanliness.');
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
