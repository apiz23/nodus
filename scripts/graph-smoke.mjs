import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = await mkdtemp(join(tmpdir(), 'nodus-graph-'));
process.env.NODUS_VAULT = root;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let server, browser;
try {
  server = await createServer({ configFile: 'ui/vite.config.ts', server: { port: 0, strictPort: false } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  process.env.NODUS_ALLOWED_ORIGINS = base;
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`${base}/api${path}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const data = await response.json(); assert(response.ok, `${method} ${path}: ${response.status}`); return data;
  };
  const first = (await request('/notes', 'POST', { title: 'Graph Source' })).note;
  const target = (await request('/notes', 'POST', { title: 'Graph Target' })).note;
  await request(`/notes/${first.id}`, 'PUT', { title: first.title, body: '[[Graph Target]] [[Graph Target]] [[Missing]]', baseHash: first.contentHash });
  await request(`/notes/${target.id}`, 'PUT', { title: target.title, body: '[[Graph Source]]', baseHash: target.contentHash });
  const lone = (await request('/notes', 'POST', { title: 'Lone Node' })).note;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByRole('button', { name: 'Local graph', exact: true }).click();
  await page.getByRole('heading', { name: 'Local graph', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Select Graph Source' }).waitFor();
  const sourceNode = page.getByRole('button', { name: 'Select Graph Source' });
  await sourceNode.focus();
  assert.equal(await sourceNode.locator('circle').getAttribute('stroke-width'), '4', 'Keyboard focus should be visible on graph nodes');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Incoming links (1)', exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Outgoing links (1)', exact: true }).waitFor();
  await page.getByText('1 unresolved excluded', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Explore neighbors', exact: true }).click();
  await page.getByText('2 of 3 notes shown', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Show full graph', exact: true }).click();
  const canvas = page.getByRole('group', { name: 'Directed wiki-link graph' });
  await page.getByRole('button', { name: 'Zoom in' }).click();
  assert.match(await canvas.locator('g').first().getAttribute('transform'), /scale\(1\.2\)/);
  await page.getByRole('button', { name: 'Reset viewport' }).click();
  assert.match(await canvas.locator('g').first().getAttribute('transform'), /scale\(1\)/);
  await page.getByLabel('Filter notes by title or path').fill('no such note');
  await page.getByRole('heading', { name: 'No matching notes', exact: true }).waitFor();
  await page.getByLabel('Filter notes by title or path').fill('');
  await page.getByRole('button', { name: 'Select Graph Target' }).click();
  await page.getByRole('button', { name: 'Open note', exact: true }).click();
  await page.waitForFunction((title) => document.querySelector('#note-title')?.value === title, 'Graph Target');
  await page.keyboard.press('Control+k');
  await page.getByRole('option', { name: /Local graph/ }).click();
  await page.getByRole('heading', { name: 'Local graph', exact: true }).waitFor();
  for (const id of [first.id, target.id, lone.id]) {
    const { note } = await request(`/notes/${id}`);
    await request(`/notes/${id}`, 'DELETE', { baseHash: note.contentHash });
  }
  await page.getByRole('button', { name: 'Refresh from disk', exact: true }).click();
  await page.getByRole('heading', { name: 'No notes to map yet', exact: true }).waitFor();
  assert(first.id && lone.id && errors.length === 0, errors.join('\n'));
  console.log('Graph browser smoke passed: navigation, keyboard selection, connections, neighbor focus, viewport controls, search and empty states, and stable-ID note opening.');
} finally { await browser?.close(); await server?.close(); await rm(root, { recursive: true, force: true }); }
