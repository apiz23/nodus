import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = await mkdtemp(join(tmpdir(), 'nodus-organization-'));
process.env.NODUS_VAULT = root;
let server;
let browser;
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
  await request('/folders', 'POST', { path: 'Research' });
  const prose = 'Canopy water cycles sustain forest soil, plant diversity, and ecosystem resilience through seasonal rainfall and healthy roots.';
  const { note: target } = await request('/notes', 'POST', { title: 'Forest overview', folder: '', body: `${prose}\n\nRelated [[Research/canopy-study-a]] and [[Research/canopy-study-b]].` });
  const { note: a } = await request('/notes', 'POST', { title: 'Canopy study A', folder: 'Research', body: `${prose}\n\n[[forest-overview]]`, tags: ['ecology'] });
  const { note: b } = await request('/notes', 'POST', { title: 'Canopy study B', folder: 'Research', body: `${prose}\n\n[[forest-overview]]`, tags: ['ecology'] });

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let failuresRemaining = 2; // React StrictMode may issue an initial discarded request.
  await page.route('**/api/organization**', async (route) => {
    if (failuresRemaining > 0 && route.request().method() === 'GET') {
      failuresRemaining--;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INJECTED', message: 'Injected organization analysis error' } }) });
      return;
    }
    await route.continue();
  });
  await page.goto(`${base}/app`);
  await page.getByRole('button', { name: 'Smart organization', exact: true }).click();
  await page.getByRole('heading', { name: 'Smart organization', exact: true }).waitFor();
  await page.getByRole('alert').filter({ hasText: 'Injected organization analysis error' }).waitFor();
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByRole('heading', { name: 'Smart organization', exact: true }).waitFor();
  await page.getByText('Forest overview', { exact: true }).first().waitFor();

  const tagCard = page.locator('li').filter({ hasText: 'Add the existing “ecology” tag to “Forest overview”.' }).first();
  await tagCard.getByRole('button', { name: 'Preview tag change' }).click();
  await page.getByRole('dialog').getByText('tag will be added').waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Add existing tag' }).click();
  await page.getByText('You’re all caught up').waitFor({ timeout: 10_000 }).catch(() => {});
  const updated = await request(`/notes/${target.id}`);
  assert.deepEqual(updated.note.tags, ['ecology']);

  const folderCard = page.locator('li').filter({ hasText: 'may fit better in “Research”' }).first();
  await folderCard.getByRole('button', { name: 'Preview folder move' }).click();
  await page.getByRole('dialog').getByText(/move-safe link maintenance needed to execute a move is not integrated yet/i).waitFor();
  await page.getByRole('dialog').getByText('Proposed path').waitFor();
  await page.getByRole('dialog').getByText(/2 path-based link occurrences in 2 source notes/).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Dismiss', exact: true }).first().click();
  const stored = await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('nodus:organization-status:v1:')));
  assert.equal(stored, true, 'dismissal state was not saved in browser-local storage');
  await page.locator('li').filter({ hasText: 'Canopy study A' }).getByRole('button', { name: /Canopy study A/ }).first().click();
  await page.waitForFunction((title) => document.querySelector('#note-title')?.value === title, a.title);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'organization view overflows a narrow viewport');
  assert.deepEqual(errors, []);
  console.log('Smart organization smoke passed: analysis error/retry, suggestion navigation, tag preview/application, folder preview/cancel, dismissal persistence, and narrow layout.');
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
