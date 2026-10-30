import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { chromium } from 'playwright';

const vault = await mkdtemp(join(tmpdir(), 'nodus-draft-recovery-'));
process.env.NODUS_VAULT = vault;
let vite;
let browser;
try {
  vite = await createViteServer({ configFile: 'ui/vite.config.ts', server: { host: '127.0.0.1', port: 0 } });
  await vite.listen();
  const address = vite.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not bind a local port');
  const base = `http://127.0.0.1:${address.port}`;
  process.env.NODUS_ALLOWED_ORIGINS = base;
  const request = async (path, init) => {
    const response = await fetch(`${base}/api${path}`, init);
    const text = await response.text();
    assert(response.ok, `${init?.method ?? 'GET'} ${path}: ${response.status} ${text}`);
    return JSON.parse(text);
  };
  const { note } = await request('/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Recovery smoke' }) });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/app`);
  await page.getByRole('treeitem', { name: `Recovery smoke (recovery-smoke.md)`, exact: true }).click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();

  const draft = 'Unsaved recovery draft\n\n![saved attachment](../attachments/portable.png)';
  await page.evaluate(async (body) => {
    const moduleUrl = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('@codemirror_view.js'));
    if (!moduleUrl) throw new Error('CodeMirror module URL not found');
    const { EditorView } = await import(moduleUrl);
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor'));
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: body } });
  }, draft);
  await page.waitForFunction(async ({ noteId, expectedBody }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('nodus-draft-recovery');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows.some((row) => row.noteId === noteId && row.body === expectedBody);
  }, { noteId: note.id, expectedBody: draft }, { timeout: 5000 });
  assert.equal((await request(`/notes/${note.id}`)).note.body, '', 'draft journaling must not modify Markdown');

  await page.close(); // Simulate a process exit: do not run beforeunload.
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/app`);
  await page.getByRole('dialog').getByRole('heading', { name: 'Recover an unsaved draft?' }).waitFor();
  assert.equal((await request(`/notes/${note.id}`)).note.body, '', 'recovery prompt must not write to disk');
  const recover = page.getByRole('button', { name: 'Recover draft', exact: true });
  await recover.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(async (expectedBody) => {
    const moduleUrl = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('@codemirror_view.js'));
    if (!moduleUrl) return false;
    const { EditorView } = await import(moduleUrl);
    return EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.toString() === expectedBody;
  }, draft);
  await page.waitForFunction(() => document.activeElement?.id === 'note-title', null, { timeout: 5000 });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForFunction(async ({ noteId, expectedBody }) => {
    const response = await fetch(`/api/notes/${noteId}`);
    const result = await response.json();
    return result.note?.body === expectedBody;
  }, { noteId: note.id, expectedBody: draft });
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log('Draft recovery smoke passed: IndexedDB persistence across app exit, explicit recovery, Markdown remains unchanged until save, and saved journal cleanup.');
  await context.close();
} finally {
  await browser?.close();
  await vite?.close();
  await rm(vault, { recursive: true, force: true });
}
