import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer as createViteServer } from 'vite';
import { chromium } from 'playwright';

const vault = await mkdtemp(`${tmpdir()}/nodus-external-touch-`);
process.env.NODUS_VAULT = vault;
let vite;
let browser;
const contexts = [];
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
  const target = (await request('/notes', 'POST', { title: 'Tap target', body: 'Target body' })).note;
  const source = (await request('/notes', 'POST', { title: 'Wiki source', body: `Before [[Tap target]] after [[Missing target]].` })).note;
  const clean = (await request('/notes', 'POST', { title: 'External clean', body: 'Clean original' })).note;
  const dirty = (await request('/notes', 'POST', { title: 'External dirty', body: 'Dirty original' })).note;
  const ime = (await request('/notes', 'POST', { title: 'IME input', body: 'IME original' })).note;

  browser = await chromium.launch({ headless: true });
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  contexts.push(desktop);
  const page = await desktop.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/app`);
  const noteItem = (title, path) => page.getByRole('treeitem', { name: `${title} (${path.split('/').at(-1)})`, exact: true });
  const bodyText = async () => page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('@codemirror_view.js'));
    const { EditorView } = await import(url);
    return EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.toString();
  });
  const replaceBody = async (value) => page.evaluate(async (value) => {
    const url = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('@codemirror_view.js'));
    const { EditorView } = await import(url);
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor'));
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, value);
  const makeVisible = () => page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });

  // Mouse clicks remain editing gestures. Modified click and keyboard activation navigate once.
  await noteItem('Wiki source', source.path).click();
  const resolved = page.locator('.cm-wikilink-resolved');
  const unresolved = page.locator('.cm-wikilink-unresolved');
  await resolved.waitFor();
  assert((await page.locator('.cm-content').innerText()).includes('Before') && (await page.locator('.cm-content').innerText()).includes('after'));
  const selected = await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('@codemirror_view.js'));
    const { EditorView } = await import(url);
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor'));
    view.dispatch({ selection: { anchor: 0, head: 6 } });
    return view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
  });
  assert.equal(selected, 'Before', 'desktop text selection must remain available around inline wiki links');
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('@codemirror_view.js'));
    const { EditorView } = await import(url);
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor'));
    view.dispatch({ selection: { anchor: 0 } });
  });
  await unresolved.click();
  await resolved.click();
  assert.equal(await page.locator('#note-title').inputValue(), 'Wiki source', 'ordinary mouse interaction must not navigate');
  await resolved.click({ modifiers: ['Control'] });
  await page.getByRole('textbox', { name: 'Note title' }).waitFor();
  assert.equal(await page.locator('#note-title').inputValue(), 'Tap target', 'Ctrl-click should navigate');
  await noteItem('Wiki source', source.path).click();
  const keyboardLink = page.locator('.cm-wikilink-resolved');
  await keyboardLink.focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#note-title').inputValue(), 'Tap target', 'Enter should activate a resolved link');
  await noteItem('Wiki source', source.path).click();
  await page.locator('.cm-wikilink-resolved').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#note-title').inputValue(), 'Tap target', 'Space should activate a resolved link');

  // A clean external edit produces a non-destructive notice, comparison, then explicit reload.
  await noteItem('External clean', clean.path).click();
  await request(`/notes/${clean.id}`, 'PUT', { title: clean.title, body: 'Clean changed externally', baseHash: clean.contentHash });
  await makeVisible();
  await page.getByText('changed on disk outside Nodus').waitFor();
  assert.equal(await bodyText(), 'Clean original', 'change detection must not replace a clean editor automatically');
  const compareButton = page.getByRole('button', { name: 'Compare versions' });
  await compareButton.focus();
  await page.keyboard.press('Enter');
  const compare = page.getByRole('dialog', { name: 'Compare the external change' });
  await compare.getByText('Clean changed externally', { exact: true }).waitFor();
  const keepCurrent = compare.getByRole('button', { name: 'Keep current editor content' });
  await keepCurrent.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.activeElement?.id === 'note-title');
  await page.getByRole('button', { name: 'Reload note', exact: true }).first().click();
  await page.waitForFunction(async (id) => (await (await fetch(`/api/notes/${id}`)).json()).note?.body === 'Clean changed externally', clean.id);
  await page.waitForFunction(() => document.activeElement?.id === 'note-title');
  assert.equal(await bodyText(), 'Clean changed externally');

  // A dirty external edit uses the existing conflict workflow and stays journaled.
  await noteItem('External dirty', dirty.path).click();
  const localDraft = 'Local dirty draft';
  await replaceBody(localDraft);
  await request(`/notes/${dirty.id}`, 'PUT', { title: dirty.title, body: 'Dirty changed externally', baseHash: dirty.contentHash });
  await makeVisible();
  const conflict = page.getByRole('dialog', { name: 'This note changed outside Nodus' });
  await conflict.waitFor();
  await conflict.getByText('Dirty changed externally', { exact: true }).waitFor();
  await conflict.getByText(localDraft, { exact: true }).waitFor();
  assert.equal((await request(`/notes/${dirty.id}`)).note.body, 'Dirty changed externally', 'dirty detection must not overwrite disk');
  assert.equal(await bodyText(), localDraft, 'dirty detection must preserve the editor draft');

  // IME-composing Ctrl+S is ignored; the same shortcut saves after composition ends.
  await conflict.getByRole('button', { name: 'Use disk version' }).focus();
  await page.keyboard.press('Enter');
  await noteItem('IME input', ime.path).click();
  const composed = '日本語入力と中文输入';
  await replaceBody(composed);
  const prevented = await page.locator('.cm-content').evaluate((element) => {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'に' }));
    const shortcut = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true, isComposing: true });
    element.dispatchEvent(shortcut);
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本語' }));
    return shortcut.defaultPrevented;
  });
  assert.equal(prevented, false, 'global shortcuts must not intercept an active composition');
  assert.equal((await request(`/notes/${ime.id}`)).note.body, 'IME original');
  await page.keyboard.press('Control+s');
  await page.waitForFunction(async ({ id, body }) => (await (await fetch(`/api/notes/${id}`)).json()).note?.body === body, { id: ime.id, body: composed });
  assert.deepEqual(errors, [], `desktop browser errors: ${errors.join('; ')}`);

  // Touch tap activates resolved links. Unresolved links remain non-navigating.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  contexts.push(mobile);
  const touchPage = await mobile.newPage();
  touchPage.on('pageerror', (error) => errors.push(error.message));
  await touchPage.goto(`${base}/app`);
  const touchItem = (title, path) => touchPage.getByRole('treeitem', { name: `${title} (${path.split('/').at(-1)})`, exact: true });
  await touchPage.getByRole('button', { name: 'Open navigation' }).click();
  const mobileNavigation = touchPage.getByRole('dialog', { name: 'Workspace navigation' });
  await mobileNavigation.waitFor();
  await touchItem('Wiki source', source.path).click();
  const touchUnresolved = touchPage.locator('.cm-wikilink-unresolved');
  await touchUnresolved.tap();
  assert.equal(await touchPage.locator('#note-title').inputValue(), 'Wiki source', 'unresolved tap must not navigate');
  await touchPage.locator('.cm-wikilink-resolved').tap();
  assert.equal(await touchPage.locator('#note-title').inputValue(), 'Tap target', 'resolved wiki-link tap should open the note');
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log('External and touch smoke passed: visibility/focus checks, clean compare and reload, dirty draft conflict preservation, IME-safe save, and touch/desktop/keyboard wiki-link behavior.');
} finally {
  for (const context of contexts) await context.close();
  await browser?.close();
  await vite?.close();
  await rm(vault, { recursive: true, force: true });
}
