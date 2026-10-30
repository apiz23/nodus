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
  const { note } = await request('/notes', 'POST', { title: 'Markdown commands', tags: ['planning'] });
  const original = 'hello\n\n[[Target|label]]\n\n- [x] task\n';
  await request(`/notes/${note.id}`, 'PUT', { title: note.title, body: original, baseHash: note.contentHash });
  const path = join(root, note.path);
  await writeFile(path, (await readFile(path, 'utf8')).replace('\nnodus:', '\naliases:\n  - Portable alias\ncustom: preserved\nscore: not-a-number\nnodus:'));
  const propertyIds = {
    summary: 'a1111111-1111-4111-8111-111111111111',
    score: 'a2222222-2222-4222-8222-222222222222',
    reviewed: 'a3333333-3333-4333-8333-333333333333',
    due: 'a4444444-4444-4444-8444-444444444444',
    status: 'a5555555-5555-4555-8555-555555555555',
    topics: 'a6666666-6666-4666-8666-666666666666',
    website: 'a7777777-7777-4777-8777-777777777777',
    obsolete: 'a8888888-8888-4888-8888-888888888888',
  };
  const statusOptionId = 'b5555555-5555-4555-8555-555555555555';
  let catalogHash = (await request('/properties')).contentHash;
  const definitions = [
    { id: propertyIds.summary, key: 'summary', name: 'Summary', type: 'text' },
    { id: propertyIds.score, key: 'score', name: 'Score', type: 'number' },
    { id: propertyIds.reviewed, key: 'reviewed', name: 'Reviewed', type: 'checkbox' },
    { id: propertyIds.due, key: 'due', name: 'Due date', type: 'date' },
    { id: propertyIds.status, key: 'status', name: 'Status', type: 'select', options: [{ id: statusOptionId, label: 'In progress' }, { id: 'b5555555-5555-4555-8555-555555555556', label: 'Done' }] },
    { id: propertyIds.topics, key: 'topics', name: 'Topics', type: 'multi-select', options: [{ id: 'b6666666-6666-4666-8666-666666666666', label: 'Research' }] },
    { id: propertyIds.website, key: 'website', name: 'Website', type: 'url' },
    { id: propertyIds.obsolete, key: 'obsolete', name: 'Obsolete', type: 'text' },
  ];
  for (const property of definitions) {
    catalogHash = (await request('/properties', 'POST', { baseHash: catalogHash, mutation: { type: 'create-property', property } })).contentHash;
  }
  let propertyNote = (await request(`/notes/${note.id}`)).note;
  for (const [key, value] of [['summary', 'Notebook'], ['reviewed', false], ['due', '2026-10-30'], ['status', 'In progress'], ['topics', []], ['obsolete', 'keep']]) {
    const propertyId = propertyIds[key];
    propertyNote = (await request(`/notes/${note.id}/properties/${propertyId}`, 'PUT', { baseHash: propertyNote.contentHash, value })).note;
  }
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
  const propertySection = page.getByRole('region', { name: 'Note properties', exact: true });
  await propertySection.getByRole('button', { name: /Properties/ }).waitFor();
  await propertySection.getByRole('textbox', { name: 'Summary value', exact: true }).waitFor();
  assert.equal(await propertySection.getByRole('textbox', { name: 'Summary value', exact: true }).inputValue(), 'Notebook');
  assert.equal(await propertySection.getByRole('spinbutton', { name: 'Score value', exact: true }).inputValue(), '');
  assert.equal(await propertySection.getByRole('checkbox', { name: 'Reviewed', exact: true }).isChecked(), false, 'Explicit false remains a set checkbox value');
  assert.equal(await propertySection.getByRole('textbox', { name: 'Due date value', exact: true }).inputValue(), '2026-10-30');
  await propertySection.getByText('Empty list', { exact: true }).waitFor();
  const scoreRow = propertySection.getByRole('group', { name: 'Score property', exact: true });
  await scoreRow.getByRole('alert').filter({ hasText: 'must be a number' }).waitFor();
  await scoreRow.getByRole('spinbutton', { name: 'Score value' }).fill('4.25');
  const scoreWrite = page.waitForResponse((response) => response.url().includes(`/notes/${note.id}/properties/${propertyIds.score}`) && response.request().method() === 'PUT');
  await scoreRow.getByRole('button', { name: 'Save', exact: true }).click();
  await scoreWrite;
  assert.equal((await vaultRead()).score, 4.25);
  const dueRow = propertySection.getByRole('group', { name: 'Due date property', exact: true });
  await dueRow.getByRole('textbox', { name: 'Due date value' }).fill('2026-11-01');
  const dueWrite = page.waitForResponse((response) => response.url().includes(`/notes/${note.id}/properties/${propertyIds.due}`) && response.request().method() === 'PUT');
  await dueRow.getByRole('button', { name: 'Save', exact: true }).click();
  await dueWrite;
  const checkboxRow = propertySection.getByRole('group', { name: 'Reviewed property', exact: true });
  const reviewed = checkboxRow.getByRole('checkbox', { name: 'Reviewed' });
  let reviewedWrite = page.waitForResponse((response) => response.url().includes(`/notes/${note.id}/properties/${propertyIds.reviewed}`) && response.request().method() === 'PUT');
  await reviewed.click();
  await reviewedWrite;
  reviewedWrite = page.waitForResponse((response) => response.url().includes(`/notes/${note.id}/properties/${propertyIds.reviewed}`) && response.request().method() === 'PUT');
  await reviewed.click();
  await reviewedWrite;
  assert.equal((await vaultRead()).reviewed, false);
  const statusRow = propertySection.getByRole('group', { name: 'Status property', exact: true });
  await statusRow.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'Done', exact: true }).click();
  await page.waitForResponse((response) => response.url().includes(`/notes/${note.id}/properties/${propertyIds.status}`) && response.request().method() === 'PUT');
  await statusRow.getByRole('combobox', { name: 'Status' }).click();
  await page.getByRole('option', { name: 'In progress', exact: true }).click();
  await page.waitForResponse((response) => response.url().includes(`/notes/${note.id}/properties/${propertyIds.status}`) && response.request().method() === 'PUT');
  const topicsRow = propertySection.getByRole('group', { name: 'Topics property', exact: true });
  await topicsRow.getByRole('checkbox', { name: 'Topics: Research' }).check();
  await topicsRow.getByRole('button', { name: 'Save selection', exact: true }).click();
  await page.waitForResponse((response) => response.url().includes(`/notes/${note.id}/properties/${propertyIds.topics}`) && response.request().method() === 'PUT');
  await topicsRow.getByRole('checkbox', { name: 'Topics: Research' }).uncheck();
  await topicsRow.getByRole('button', { name: 'Save selection', exact: true }).click();
  await page.waitForResponse((response) => response.url().includes(`/notes/${note.id}/properties/${propertyIds.topics}`) && response.request().method() === 'PUT');
  assert.deepEqual((await vaultRead()).topics, []);
  const summaryRow = propertySection.getByRole('group', { name: 'Summary property', exact: true });
  await summaryRow.getByRole('textbox', { name: 'Summary value' }).fill('');
  await summaryRow.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForResponse((response) => response.url().includes(`/notes/${note.id}/properties/${propertyIds.summary}`) && response.request().method() === 'PUT');
  assert.equal((await vaultRead()).summary, '', 'Empty text is a set value distinct from unset');
  await summaryRow.getByRole('button', { name: 'Unset', exact: true }).click();
  await page.waitForResponse((response) => response.url().includes(`/notes/${note.id}/properties/${propertyIds.summary}`) && response.request().method() === 'PUT');
  assert.equal(Object.hasOwn(await vaultRead(), 'summary'), false);
  await propertySection.getByRole('combobox', { name: 'Add property', exact: true }).click();
  await page.getByRole('option', { name: 'Website' }).click();
  const website = propertySection.getByRole('textbox', { name: 'Website value', exact: true });
  await website.fill('javascript:alert(1)');
  await propertySection.getByRole('button', { name: 'Save', exact: true }).last().click();
  await propertySection.getByRole('alert').filter({ hasText: 'HTTP or HTTPS' }).waitFor();
  await website.fill('https://example.test/path');
  await propertySection.getByRole('button', { name: 'Save', exact: true }).last().click();
  await propertySection.getByRole('link', { name: 'Open Website URL', exact: true }).waitFor();

  await propertySection.getByRole('button', { name: 'Manage', exact: true }).click();
  const propertyDialog = page.getByRole('dialog', { name: 'Manage note properties', exact: true });
  const summaryDefinition = propertyDialog.locator('article').filter({ hasText: 'summary' });
  await summaryDefinition.getByLabel('Name for summary').fill('Abstract');
  let rejectCatalogWriteOnce = true;
  await page.route('**/api/properties', async (route) => {
    if (route.request().method() === 'POST' && rejectCatalogWriteOnce) {
      rejectCatalogWriteOnce = false;
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'STALE_WRITE', message: 'The property catalog changed elsewhere.' } }) });
    } else await route.continue();
  });
  await summaryDefinition.getByRole('button', { name: 'Rename', exact: true }).click();
  await propertyDialog.getByRole('alert').filter({ hasText: 'changed elsewhere' }).waitFor();
  await propertyDialog.getByRole('button', { name: 'Reload catalog', exact: true }).click();
  await summaryDefinition.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.unroute('**/api/properties');
  const statusDefinition = propertyDialog.locator('article').filter({ hasText: 'status' });
  const optionName = statusDefinition.getByRole('textbox', { name: 'Option In progress', exact: true });
  await optionName.waitFor({ state: 'visible' });
  await optionName.fill('Doing');
  await statusDefinition.getByRole('button', { name: 'Rename option', exact: true }).first().click();
  await propertyDialog.getByLabel('Display name', { exact: true }).fill('Priority');
  await propertyDialog.getByLabel('Stable YAML key', { exact: true }).fill('priority');
  await propertyDialog.getByLabel('Property type').click();
  await page.getByRole('option', { name: 'number', exact: true }).click();
  await propertyDialog.getByRole('button', { name: 'Create property', exact: true }).click();
  const obsoleteDefinition = propertyDialog.locator('article').filter({ hasText: 'obsolete' });
  await obsoleteDefinition.getByRole('button', { name: 'Delete definition', exact: true }).click();
  await obsoleteDefinition.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await propertyDialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expectText(statusRow.getByRole('combobox', { name: 'Status' }), 'Doing');
  const catalogAfterManage = await request('/properties');
  assert(catalogAfterManage.catalog.properties.some((property) => property.name === 'Abstract' && property.key === 'summary'));
  assert(catalogAfterManage.catalog.properties.find((property) => property.key === 'status').options[0].aliases.includes('In progress'));
  assert(!catalogAfterManage.catalog.properties.some((property) => property.key === 'obsolete'));
  assert((await readFile(path, 'utf8')).includes('obsolete: keep'), 'Deleting a property definition leaves its Markdown YAML value intact');
  async function vaultRead() { return (await import('yaml')).parse((await readFile(path, 'utf8')).split('---\n')[1].split('\n---')[0]); }
  async function expectText(locator, text) { assert.equal((await locator.textContent()).trim(), text); }
  const tags = page.getByRole('textbox', { name: 'Add tag', exact: true });
  await page.getByRole('button', { name: 'Remove tag planning', exact: true }).waitFor();
  let rejectTagOnce = true;
  await page.route('**/api/notes/*/tags', async (route) => {
    if (rejectTagOnce) {
      rejectTagOnce = false;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEMPORARY', message: 'Temporary tag write failure.' } }) });
    } else await route.continue();
  });
  await tags.fill('Research');
  await tags.press('Enter');
  await page.getByRole('alert').filter({ hasText: 'Temporary tag write failure.' }).waitFor();
  assert.equal(await tags.inputValue(), 'Research', 'A failed write keeps the intended tag for retry');
  await tags.press('Enter');
  await page.getByRole('button', { name: 'Remove tag Research', exact: true }).waitFor();
  await page.unroute('**/api/notes/*/tags');
  await tags.fill(' research ');
  await tags.press('Enter');
  await page.getByRole('alert').filter({ hasText: 'already exists' }).waitFor();
  assert.equal(await tags.inputValue(), ' research ', "Duplicate feedback keeps the user's input");
  await tags.fill('linking');
  await tags.press(',');
  await page.getByRole('button', { name: 'Remove tag linking', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Remove tag Research', exact: true }).click();
  await page.getByRole('button', { name: 'Remove tag Research', exact: true }).waitFor({ state: 'detached' });
  await tags.focus();
  await page.keyboard.press('Backspace');
  await page.getByRole('button', { name: 'Remove tag linking', exact: true }).waitFor({ state: 'detached' });
  await page.route('**/api/notes/*/tags', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  await tags.fill('Persistent');
  const delayedTagResponse = page.waitForResponse((response) => response.url().includes(`/api/notes/${note.id}/tags`) && response.request().method() === 'PUT');
  await tags.press('Enter');
  await page.getByText('Saving tag changes…', { exact: true }).waitFor();
  assert.equal(await tags.isDisabled(), true, 'Repeated tag actions are blocked while a write is pending');
  await page.getByRole('treeitem', { name: 'Preview page (preview-page.md)', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note title', exact: true }).waitFor();
  await delayedTagResponse;
  assert.equal(await page.getByRole('textbox', { name: 'Note title', exact: true }).inputValue(), 'Preview page', 'A late tag response must not replace a newly selected note');
  await page.getByRole('treeitem', { name: 'Markdown commands (markdown-commands.md)', exact: true }).click();
  await page.getByRole('button', { name: 'Remove tag Persistent', exact: true }).waitFor();
  await tags.fill('Concurrent');
  const concurrentTagResponse = page.waitForResponse((response) => response.url().includes(`/api/notes/${note.id}/tags`) && response.request().method() === 'PUT');
  await tags.press('Enter');
  const concurrentDraft = `${original}Concurrent tag-save draft.\n`;
  const concurrentAutosave = page.waitForResponse((response) => response.url().includes(`/api/notes/${note.id}`) && !response.url().includes('/tags') && response.request().method() === 'PUT');
  await body.fill(concurrentDraft);
  await concurrentAutosave;
  await concurrentTagResponse;
  await page.getByText('Saved', { exact: true }).waitFor();
  assert.equal((await request(`/notes/${note.id}`)).note.body, concurrentDraft, 'Autosave preserves a draft typed while a tag write is pending');
  assert.deepEqual((await request(`/notes/${note.id}`)).note.tags, ['planning', 'Persistent', 'Concurrent']);
  await body.fill(original);
  await page.waitForResponse((response) => response.url().includes(`/api/notes/${note.id}`) && !response.url().includes('/tags') && response.request().method() === 'PUT');
  await page.getByText('Saved', { exact: true }).waitFor();
  await page.unroute('**/api/notes/*/tags');
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
  await page.getByTitle('Save note (Ctrl/Cmd+S)').click();
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
  assert.equal(await tags.isDisabled(), true, 'Tag edits are blocked while the Markdown draft is unsaved');

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
  assert.deepEqual((await request(`/notes/${note.id}`)).note.tags, ['planning', 'Persistent', 'Concurrent']);
  assert.deepEqual(errors, []);
  console.log('Markdown browser smoke passed: tags keyboard/pointer/retry/loading/draft safety, formatting/shortcuts, undo/redo, source persistence, lists/code/links, wiki navigation, preview rendering/security/local images, and mobile controls.');
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
