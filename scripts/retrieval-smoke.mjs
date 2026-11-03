import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const root = await mkdtemp(join(tmpdir(), 'nodus-retrieval-'));
process.env.NODUS_VAULT = root;
let server, browser;
try {
  server = await createServer({ configFile: 'ui/vite.config.ts', server: { port: 0, strictPort: false } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  process.env.NODUS_ALLOWED_ORIGINS = base;
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`${base}/api${path}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const data = await response.json(); assert(response.ok, `${response.status} ${JSON.stringify(data)}`); return data;
  };
  await request('/folders', 'POST', { path: 'Research' });
  const { note: garden } = await request('/notes', 'POST', { title: 'Garden log', folder: '', body: '# Soil ecology\nCompost restores soil nutrients and biodiversity.', tags: ['Nature'] });
  const { note: field } = await request('/notes', 'POST', { title: 'Field research', folder: 'Research', body: '# Soil ecology\nBiodiversity benefits from compost and soil nutrients.', tags: ['Nature'] });
  await request('/notes', 'POST', { title: 'Travel tickets', body: 'Train stations and city museums.' });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/app`);
  const search = page.getByRole('searchbox', { name: 'Search notes', exact: true });
  const open = async (title) => {
    await search.fill(`title:"${title}"`);
    await page.getByRole('button', { name: `Open ${title}`, exact: true }).waitFor();
    await search.press('Enter');
    await page.waitForFunction((value) => document.querySelector('#note-title')?.value === value, title);
  };
  await open(garden.title);
  const panel = page.getByRole('region', { name: 'Related notes', exact: true });
  const related = panel.getByRole('button', { name: /Open related note Field research/ });
  await related.waitFor();
  assert.match(await related.innerText(), /Similar text:/);
  assert.match(await related.innerText(), /Shared tags: nature/);
  await related.focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#note-title')?.value === 'Field research');

  // A pending response from the previous note cannot replace this note's recommendations.
  let release, started;
  const ready = new Promise((resolve) => { started = resolve; });
  await page.route(`**/api/notes/${field.id}/related?**`, async (route) => {
    started(); await new Promise((resolve) => { release = resolve; });
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ noteId: field.id, related: [{ note: { id: garden.id, title: 'STALE RECOMMENDATION', path: garden.path, aliases: [] }, score: 10, reasons: [] }] }) }).catch(() => {});
  });
  await page.getByRole('button', { name: 'Refresh related notes' }).click(); await ready;
  await open('Travel tickets');
  await panel.getByText(/No strong text, tag, or link connections/).waitFor();
  release();
  await page.unroute(`**/api/notes/${field.id}/related?**`);
  assert.equal(await page.getByText('STALE RECOMMENDATION').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  console.log('Retrieval smoke passed: unlinked cross-folder text/tag explanations, keyboard note opening, stale-response isolation, empty state and narrow layout.');
} finally { await browser?.close(); await server?.close(); await rm(root, { recursive: true, force: true }); }
