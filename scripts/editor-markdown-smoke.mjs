import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = await mkdtemp(join(tmpdir(), 'nodus-markdown-'));
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
    assert(response.ok, `${method} ${path}: ${response.status}`);
    return response.json();
  };
  const { note: target } = await request('/notes', 'POST', { title: 'Target' });
  const { note } = await request('/notes', 'POST', { title: 'Markdown commands' });
  const original = 'hello\n\n[[Target|label]]\n\n- [x] task\n';
  await request(`/notes/${note.id}`, 'PUT', { title: note.title, body: original, baseHash: note.contentHash });
  const path = join(root, note.path);
  await writeFile(path, (await readFile(path, 'utf8')).replace('\nnodus:', '\naliases:\n  - Portable alias\ncustom: preserved\nnodus:'));
  const { note: previewNote } = await request('/notes', 'POST', { title: 'Preview page' });
  await mkdir(join(root, 'notes', 'assets'), { recursive: true });
  await writeFile(join(root, 'notes', 'assets', 'tiny.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S5sAAAAASUVORK5CYII=', 'base64'));
  const previewMarkdown = `# Preview title\n\n## Duplicate\n\n## Duplicate\n\nA paragraph with **bold**, *italic*, ~~strike~~, and \`inline\`.\nSoft break\nHard break  \nnext.\n\n- [x] task\n  - nested\n\n> quote\n\n| Name | Count |\n| --- | ---: |\n| Nodus | 2 |\n\n\`\`\`typescript\nconst greeting = "hello";\n\`\`\`\n\n[external](https://example.test) [unsafe](javascript:alert(1)) [[${target.id}|Stable target]] [[missing]]\n\n![local](assets/tiny.png) ![missing](assets/missing.png) ![remote](https://images.example/a.png)\n\n<script>alert(1)</script>`;
  await request(`/notes/${previewNote.id}`, 'PUT', { title: previewNote.title, body: previewMarkdown, baseHash: previewNote.contentHash });

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => { window.__nodusCopiedText = text; } },
    });
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://images.example/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S5sAAAAASUVORK5CYII=', 'base64'),
  }));
  await page.goto(`${base}/app`);
  const mod = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control');
  await page.getByRole('treeitem', { name: 'Markdown commands (markdown-commands.md)', exact: true }).click();
  const body = page.getByRole('textbox', { name: 'Markdown body', exact: true });
  await body.waitFor();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  // Use CodeMirror's public selection API; edits still travel through real
  // toolbar/key events, React drafts, and the normal conditional-save API.
  const editor = async (selection) => page.evaluate(async (selection) => {
    const url = performance.getEntriesByType('resource').map((entry) => entry.name).find((url) => url.includes('@codemirror_view.js'));
    const { EditorView } = await import(url);
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor'));
    if (selection) { view.dispatch({ selection }); view.focus(); }
    const range = view.state.selection.main;
    return { text: view.state.sliceDoc(), selected: view.state.sliceDoc(range.from, range.to), head: range.head };
  }, selection);
  const format = async (label) => {
    await page.getByRole('button', { name: 'Format Markdown', exact: true }).click();
    await page.getByRole('dialog', { name: 'Markdown formatting', exact: true }).getByRole('button', { name: label, exact: true }).click();
    await page.waitForFunction(() => document.activeElement === document.querySelector('.cm-content'));
  };
  await editor({ anchor: 0, head: 5 });
  await format('Bold');
  assert.equal((await editor()).text, '**hello**' + original.slice(5));
  assert.equal((await editor()).selected, 'hello');
  assert(await body.evaluate((element) => document.activeElement === element), 'Formatting must return focus to the editor');
  await page.keyboard.press(`${mod}+z`);
  assert.equal((await editor()).text, original);
  await page.keyboard.press(`${mod}+Shift+z`);
  assert.equal((await editor()).text, '**hello**' + original.slice(5));
  await editor({ anchor: 2, head: 7 });
  await page.keyboard.press(`${mod}+b`);
  assert.equal((await editor()).text, original);
  await page.keyboard.press(`${mod}+Shift+x`);
  assert.equal((await editor()).text, '~~hello~~' + original.slice(5));
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.locator('.cm-strikethrough').waitFor();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Saved', { exact: true }).waitFor();
  const saved = (await request(`/notes/${note.id}`)).note;
  assert.equal(saved.id, note.id);
  assert.deepEqual(saved.aliases, ['Portable alias']);
  assert(saved.body.includes('[[Target|label]]\n\n- [x] task'));
  assert((await readFile(path, 'utf8')).includes('custom: preserved'));

  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await body.fill('  first\n  second');
  await editor({ anchor: 0, head: 16 });
  await page.getByRole('button', { name: 'Format Markdown', exact: true }).click();
  let controls = page.getByRole('dialog', { name: 'Markdown formatting', exact: true });
  await controls.getByLabel('Code language (optional)', { exact: true }).fill('typescript');
  await controls.getByRole('button', { name: 'Code block', exact: true }).click();
  await page.waitForFunction(() => document.activeElement === document.querySelector('.cm-content'));
  assert.equal((await editor()).text, '```typescript\n  first\n  second\n```');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.type('third');
  assert.equal((await editor()).text, '```typescript\n  first\n  second\n  third\n```');

  await body.fill('1. one\n2. two');
  await editor({ anchor: 6 });
  await page.keyboard.press('Enter');
  assert.equal((await editor()).text, '1. one\n2. \n3. two');
  await page.keyboard.press('Enter');
  assert.equal((await editor()).text, '1. one\n\n2. two');
  await body.fill('- parent\n- [x] child');
  await editor({ anchor: 20 });
  await page.keyboard.press('Tab');
  assert.equal((await editor()).text, '- parent\n    - [x] child');
  await page.keyboard.press('Shift+Tab');
  assert.equal((await editor()).text, '- parent\n- [x] child');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  assert(await body.evaluate((element) => document.activeElement !== element), 'Escape then Tab must leave the indentation context');
  await editor({ anchor: 20 });
  await page.keyboard.press('Enter');
  assert.equal((await editor()).text, '- parent\n- [x] child\n- [ ] ');
  await page.keyboard.type('next');
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await page.locator('.cm-task-checkbox input').first().waitFor();
  assert.equal(await page.locator('.cm-task-checkbox input').count(), 2);

  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await body.fill('');
  await format('Insert or edit link');
  assert.equal((await editor()).selected, 'link text');
  await page.keyboard.type('Example');
  await editor({ anchor: 3 });
  await page.getByRole('button', { name: 'Format Markdown', exact: true }).click();
  controls = page.getByRole('dialog', { name: 'Markdown formatting', exact: true });
  await controls.getByLabel('Link destination (optional)', { exact: true }).fill('docs/a b.md');
  await controls.getByRole('button', { name: 'Insert or edit link', exact: true }).click();
  await page.waitForFunction(() => document.activeElement === document.querySelector('.cm-content'));
  assert.equal((await editor()).text, '[Example](docs/a%20b.md)');
  await body.fill('[[Target|label]]');
  await editor({ anchor: 4 });
  await page.keyboard.press(`${mod}+Shift+k`);
  assert.equal((await editor()).text, '[[Target|label]]');
  assert.equal(await page.getByRole('dialog', { name: 'Command palette' }).count(), 0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Format Markdown', exact: true }).click();
  controls = page.getByRole('dialog', { name: 'Markdown formatting', exact: true });
  const bounds = await controls.boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 391, 'Formatting controls overflow the mobile viewport');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 1280, height: 900 });
  // The last edit may already be saving or saved by autosave. Waiting for the
  // persisted state avoids racing a click against the save button disabling.
  await page.getByText('Saved', { exact: true }).waitFor();
  await page.getByRole('treeitem', { name: 'Preview page (preview-page.md)', exact: true }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('article', { name: 'Markdown preview', exact: true }).waitFor();
  const preview = page.getByRole('article', { name: 'Markdown preview', exact: true });
  await preview.getByRole('heading', { name: 'Preview title', level: 1 }).waitFor();
  assert.equal(await preview.locator('h2[id="duplicate-2"]').count(), 1, 'Duplicate heading anchors are unique');
  assert.equal(await preview.locator('table tbody tr').count(), 1);
  assert.equal(await preview.getByRole('checkbox').count(), 1);
  assert.equal(await preview.getByRole('link', { name: 'external' }).getAttribute('rel'), 'noopener noreferrer');
  assert.equal(await preview.locator('a[href^="javascript:"]').count(), 0);
  assert.equal(await preview.locator('button[aria-label="Open Stable target"]').count(), 1);
  assert.equal(await preview.locator('[title="Unresolved wiki link"]').count(), 1);
  assert.equal(await preview.locator('img[src^="/api/assets/image"]').count(), 1);
  assert.equal(await preview.locator('img[src^="https://images.example"]').getAttribute('referrerpolicy'), 'no-referrer');
  assert.equal(await preview.locator('script').count(), 0, 'Raw HTML must remain escaped text');
  await preview.getByRole('img', { name: 'missing' }).waitFor();
  await preview.getByRole('button', { name: 'Copy code block', exact: true }).click();
  await page.waitForFunction(() => window.__nodusCopiedText === 'const greeting = "hello";');
  await preview.locator('button[aria-label="Open Stable target"]').click();
  await page.getByRole('textbox', { name: 'Note title', exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Note title', exact: true }).inputValue(), 'Target');
  const persistedPreview = (await request(`/notes/${previewNote.id}`)).note;
  assert.equal(persistedPreview.body, previewMarkdown, 'Preview must not rewrite the Markdown source');
  assert.deepEqual(errors, []);
  console.log('Markdown browser smoke passed: formatting/shortcuts, undo/redo, source persistence, lists/code/links, wiki navigation, preview rendering/security/local images, and mobile controls.');
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
