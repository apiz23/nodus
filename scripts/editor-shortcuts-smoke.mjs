import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = await mkdtemp(join(tmpdir(), 'nodus-editor-shortcuts-'));
process.env.NODUS_VAULT = root;
let server, browser;
try {
  server = await createServer({ configFile: 'ui/vite.config.ts', server: { port: 0, strictPort: false } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  process.env.NODUS_ALLOWED_ORIGINS = base;
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`${base}/api${path}`, { method, ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }) });
    assert(response.ok, `${method} ${path}: HTTP ${response.status}`);
    return response.json();
  };
  const first = (await request('/notes', 'POST', { title: 'Shortcut first' })).note;
  const second = (await request('/notes', 'POST', { title: 'Shortcut second' })).note;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  const saves = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (req) => {
    if (req.method() === 'PUT' && /\/api\/notes\/[^/]+$/.test(new URL(req.url()).pathname)) {
      saves.push({ path: new URL(req.url()).pathname, body: req.postDataJSON() });
    }
  });
  await page.clock.install();
  await page.goto(`${base}/app`);
  const body = page.getByRole('textbox', { name: 'Markdown body', exact: true });
  const title = page.getByRole('textbox', { name: 'Note title', exact: true });
  await body.waitFor();
  // Freeze timers before editing: a successful save below cannot be autosave.
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  for (const [modifier, note] of [['Control', first], ['Meta', second]]) {
    await page.getByRole('treeitem', { name: `${note.title} (${note.path.split('/').at(-1)})`, exact: true }).click();
    await page.waitForFunction((value) => document.querySelector('#note-title')?.value === value, note.title);
    await title.fill(`${modifier} current title`);
    await body.fill(`${modifier} current body`);
    await page.clock.runFor(20);
    await page.getByText('Unsaved', { exact: true }).waitFor();
    const previous = saves.length;
    const saved = page.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname === `/api/notes/${note.id}`, { timeout: 3000 });
    await page.keyboard.press(`${modifier}+s`);
    assert.equal((await saved).status(), 200);
    await page.getByText('Saved', { exact: true }).waitFor();
    assert.equal(saves.length, previous + 1);
    assert.deepEqual(saves.at(-1), {
      path: `/api/notes/${note.id}`,
      body: { title: `${modifier} current title`, body: `${modifier} current body`, baseHash: note.contentHash },
    });
    assert.equal((await request(`/notes/${note.id}`)).note.body, `${modifier} current body`);
    await page.keyboard.press(`${modifier}+s`);
    assert.equal(saves.length, previous + 1, 'Saving a clean draft must not issue another write');
  }

  for (const modifier of ['Control', 'Meta']) {
    await title.fill(`${modifier} retained title`);
    await body.fill(`${modifier} retained body`);
    await page.clock.runFor(20);
    await page.getByText('Unsaved', { exact: true }).waitFor();
    const before = (await request('/notes')).notes.length;
    const dialogs = [];
    let confirm = false;
    const handleDialog = async (dialog) => {
      dialogs.push(dialog.message());
      await (confirm ? dialog.accept() : dialog.dismiss());
    };
    page.on('dialog', handleDialog);
    // Typing targets keep their own New shortcut behavior.
    await page.keyboard.press(`${modifier}+n`);
    assert.equal(dialogs.length, 0);
    await page.locator('#main-content').focus();
    await page.keyboard.press(`${modifier}+n`);
    assert.deepEqual(dialogs, ['Discard unsaved changes and create a new note?']);
    assert.equal(await title.inputValue(), `${modifier} retained title`);
    assert.equal((await body.textContent()).trim(), `${modifier} retained body`);
    assert.equal((await request('/notes')).notes.length, before);
    await page.getByText('Unsaved', { exact: true }).waitFor();
    confirm = true;
    await page.keyboard.press(`${modifier}+n`);
    await page.waitForFunction(() => document.querySelector('#note-title')?.value === 'Untitled note');
    assert.equal(dialogs.length, 2);
    assert.equal((await request('/notes')).notes.length, before + 1);
    page.off('dialog', handleDialog);
  }
  assert.deepEqual(errors, []);
  console.log('Editor shortcuts browser smoke passed: Ctrl/Cmd immediate saves with autosave frozen, current notes/title/body/hash, clean saves, dirty-draft cancellation/confirmation, and CodeMirror typing guards.');
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
