import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Isolated vault and ephemeral server; never opens the user's vault.
const vault = await mkdtemp(join(tmpdir(), 'nodus-discovery-'));
process.env.NODUS_VAULT = vault;
let server;
let browser;
try {
  server = await createServer({ configFile: 'ui/vite.config.ts', server: { port: 0, strictPort: false } });
  await server.listen();
  const address = server.httpServer.address();
  const base = `http://127.0.0.1:${address.port}`;
  process.env.NODUS_ALLOWED_ORIGINS = base;
  const request = async (path, method = 'GET', body) => {
    const result = await fetch(`${base}/api${path}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    assert(result.ok, `${method} ${path}: ${result.status}`);
    return result.json();
  };
  const { note: source } = await request('/notes', 'POST', { title: 'Discovery source' });
  await request(`/notes/${source.id}`, 'PUT', { title: source.title, body: 'Follow [[Future|the idea]].', baseHash: source.contentHash });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByRole('button', { name: 'Discovery', exact: true }).click();
  await page.getByRole('heading', { name: 'Unresolved links (1)' }).waitFor();
  assert(await page.getByText('[[Future|the idea]]', { exact: true }).isVisible());
  await page.getByRole('button', { name: 'Create target Future' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Note title' }).waitFor();
  await page.waitForFunction(() => document.querySelector('#note-title')?.value === 'Future');
  await page.getByRole('button', { name: 'Open Discovery source', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#note-title')?.value === 'Discovery source');
  await page.getByRole('button', { name: 'Discovery', exact: true }).click();
  await page.getByRole('heading', { name: 'Unresolved links (0)' }).waitFor();
  await page.getByRole('heading', { name: 'Orphan notes (1)' }).waitFor();
  const orphans = page.getByRole('region', { name: 'Orphan notes (1)' });
  await orphans.getByRole('button', { name: 'Discovery source' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Note title' }).waitFor();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await page.getByRole('option', { name: 'Knowledge discovery' }).click();
  await page.getByRole('heading', { name: 'Knowledge discovery', exact: true }).waitFor();

  // The live editor must replace its cached resolver when note summaries change.
  const target = (await request('/notes')).notes.find((note) => note.title === 'Future');
  assert(target);
  await page.getByRole('region', { name: 'Orphan notes (1)' }).getByRole('button', { name: 'Discovery source' }).click();
  const body = page.getByRole('textbox', { name: 'Markdown body' });
  const sourceBody = `Follow [[Future|the idea]] and [[${target.id}|pinned]].`;
  const saveSource = async (value) => {
    await body.fill(value);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Saved', { exact: true }).waitFor();
  };
  await saveSource(sourceBody);
  await page.getByRole('link', { name: 'Open pinned', exact: true }).waitFor();
  const originalTarget = (await request(`/notes/${target.id}`)).note;
  const renamed = (await request(`/notes/${target.id}`, 'PUT', { title: 'Renamed future', body: originalTarget.body, baseHash: originalTarget.contentHash })).note;
  await saveSource(`${sourceBody}\n`);
  await page.locator('.cm-wikilink-unresolved').filter({ hasText: 'the idea' }).waitFor();
  const pinned = page.getByRole('link', { name: 'Open pinned', exact: true });
  await pinned.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#note-title')?.value === 'Renamed future');
  await request(`/notes/${target.id}`, 'DELETE', { baseHash: renamed.contentHash });
  await page.getByRole('treeitem', { name: 'Discovery source', exact: true }).click();
  await saveSource(`${sourceBody}\n\n`);
  await page.locator('.cm-wikilink-unresolved').filter({ hasText: 'pinned' }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Open pinned', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('Discovery browser smoke passed: keyboard creation, backlinks, orphan navigation, command palette, and editor resolver refresh after rename/delete.');
} finally {
  await browser?.close();
  await server?.close();
  await rm(vault, { recursive: true, force: true });
}
