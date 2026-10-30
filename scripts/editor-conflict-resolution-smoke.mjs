import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer as createViteServer } from 'vite';
import { chromium } from 'playwright';

const vault = await mkdtemp(`${tmpdir()}/nodus-conflict-smoke-`);
process.env.NODUS_VAULT = vault;
let vite;
let browser;
let context;
try {
  vite = await createViteServer({ configFile: 'ui/vite.config.ts', server: { host: '127.0.0.1', port: 0 } });
  await vite.listen();
  const address = vite.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not bind a local port');
  const base = `http://127.0.0.1:${address.port}`;
  process.env.NODUS_ALLOWED_ORIGINS = base;
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`${base}/api${path}`, { method, ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }) });
    const text = await response.text();
    assert(response.ok, `${method} ${path}: ${response.status} ${text}`);
    return JSON.parse(text);
  };
  const first = (await request('/notes', 'POST', { title: 'Conflict smoke', body: 'Original body' })).note;
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/app`);
  await page.getByRole('treeitem', { name: 'Conflict smoke (conflict-smoke.md)', exact: true }).click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();

  const local = 'Local version with ![map](assets/map.png)';
  await page.evaluate(async (body) => {
    const moduleUrl = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('@codemirror_view.js'));
    if (!moduleUrl) throw new Error('CodeMirror module URL not found');
    const { EditorView } = await import(moduleUrl);
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor'));
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: body } });
  }, local);
  await request(`/notes/${first.id}`, 'PUT', { title: first.title, body: 'External version', baseHash: first.contentHash });
  const dialog = page.getByRole('dialog', { name: 'This note changed outside Nodus' });
  await dialog.waitFor({ timeout: 10000 });
  await dialog.getByText('External version', { exact: true }).waitFor();
  await dialog.getByText(local, { exact: true }).waitFor();
  assert.equal((await request(`/notes/${first.id}`)).note.body, 'External version', 'conflict detection must not overwrite disk');

  const keepButton = dialog.getByRole('button', { name: 'Keep my draft', exact: true });
  await keepButton.focus();
  await page.keyboard.press('Enter');
  const confirmOverwrite = dialog.getByRole('checkbox');
  await confirmOverwrite.focus();
  await page.keyboard.press('Space');
  const saveOver = dialog.getByRole('button', { name: 'Save over current disk version', exact: true });
  await saveOver.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(async ({ id, expected }) => (await (await fetch(`/api/notes/${id}`)).json()).note?.body === expected, { id: first.id, expected: local });
  await page.waitForFunction(() => document.activeElement?.id === 'note-title');
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log('Conflict resolution smoke passed: latest disk and local draft comparison, no implicit overwrite, explicit confirmation, and conditional save against the reviewed hash.');
} finally {
  await context?.close();
  await browser?.close();
  await vite?.close();
  await rm(vault, { recursive: true, force: true });
}
