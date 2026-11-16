import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = await mkdtemp(join(tmpdir(), 'nodus-graph-interaction-'));
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
  const titles = ['Interaction alpha', 'Interaction beta', 'Interaction gamma', 'Interaction delta', 'Interaction echo', 'Interaction fox'];
  for (let index = 0; index < titles.length; index += 1) {
    const { note } = await request('/notes', 'POST', { title: titles[index] });
    const outgoing = [
      `[[Interaction beta]]\n[[Interaction echo]]\n[[Missing target]]`,
      '[[Interaction alpha]]',
      '[[Interaction beta]]',
      '[[Interaction gamma]]',
      '[[Interaction delta]]',
      '[[Interaction echo]]',
    ][index];
    if (outgoing) await request(`/notes/${note.id}`, 'PUT', { title: note.title, body: outgoing, baseHash: note.contentHash });
  }
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${base}/app`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('button').length > 0);
  const guide = page.getByRole('button', { name: 'Got it' });
  if (await guide.count()) await guide.click();
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Local graph')?.click(); });
  await page.getByRole('heading', { name: 'Local graph', exact: true }).waitFor();
  const alpha = page.getByRole('button', { name: 'Select Interaction alpha' });
  await alpha.waitFor();
  await alpha.focus();
  const activeLabel = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  assert.equal(await activeLabel(), 'Select Interaction alpha');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(80);
  assert.notEqual(await activeLabel(), 'Select Interaction alpha', 'Arrow keys did not move graph focus');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: /^(Incoming links \(\d+\)|Referenced by \(\d+\))$/ }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByText('Select a node to inspect its tags, path, and connections.').waitFor();
  await page.getByRole('button', { name: 'Select Interaction alpha' }).click({ force: true });
  await page.getByRole('button', { name: 'Select Interaction alpha' }).click({ button: 'right', force: true });
  await page.getByRole('menu', { name: 'Actions for Interaction alpha' }).waitFor();
  await page.getByRole('menuitem', { name: 'Set as center' }).click();
  await page.getByRole('combobox', { name: 'Neighborhood depth' }).waitFor();
  await page.getByText('3 of 6 notes shown', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Center view' }).first().waitFor();
  await page.getByRole('combobox', { name: 'Neighborhood depth' }).click();
  await page.getByRole('option', { name: '2 hops' }).click();
  await page.getByText('6 of 6 notes shown', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Center view' }).first().click();
  await page.getByRole('button', { name: 'Show full graph' }).click();
  await page.getByText('6 of 6 notes shown', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Graph interaction smoke passed: roving keyboard focus, Enter selection, Escape clearing, context menu actions, Around-note scope, depth control, Back to center, Show full graph, and console cleanliness.');
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
