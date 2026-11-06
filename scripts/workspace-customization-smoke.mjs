import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = await mkdtemp(join(tmpdir(), 'nodus-workspace-'));
const exportParent = await mkdtemp(join(tmpdir(), 'nodus-portable-export-'));
const importParent = await mkdtemp(join(tmpdir(), 'nodus-import-source-'));
const exportTarget = join(exportParent, 'package');
const legacyImportSource = join(importParent, 'legacy-package');
process.env.NODUS_VAULT = root;
let server;
let browser;
try {
  await writeFile(join(root, 'workspace-note.md'), '# Workspace note\n\nA small draft for layout checks.\n', 'utf8');
  await mkdir(join(legacyImportSource, 'notes'), { recursive: true });
  const importedMarkdown = '# Browser imported note\n\nThis note was written through the reviewed import workflow.\n';
  await writeFile(join(legacyImportSource, 'notes', 'browser-import.md'), importedMarkdown, 'utf8');
  server = await createServer({ configFile: 'ui/vite.config.ts', cacheDir: join(root, '.vite-cache'), server: { port: 0, strictPort: false } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  process.env.NODUS_ALLOWED_ORIGINS = base;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/app`);

  const note = page.getByRole('treeitem', { name: /workspace-note/ });
  await note.click();
  const editor = page.getByRole('textbox', { name: 'Markdown body', exact: true });
  await editor.waitFor();
  const source = page.locator('.cm-content');
  await editor.fill('# Workspace note\n\nA changed draft that survives layout changes.');

  const recoveryOperationId = '33333333-3333-4333-8333-333333333333';
  await page.route('**/api/import/operations', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ operations: [{ operationId: recoveryOperationId, state: 'recovery-required', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), resources: [{ kind: 'note', id: 'recovery-note', path: 'notes/recovery.md', decision: 'add', publication: 'published' }] }] }) }));
  await page.route(`**/api/import/operations/${recoveryOperationId}/retry`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ operationId: recoveryOperationId, state: 'completed', startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), counts: { notes: 1, databases: 0, databaseViews: 0 }, resources: [{ kind: 'note', id: 'recovery-note', path: 'notes/recovery.md', decision: 'add', status: 'published', sha256: 'd'.repeat(64) }] }) }));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'Workspace', exact: true });
  const preset = workspace.getByRole('combobox', { name: 'Workspace preset', exact: true });
  await preset.click();
  await page.getByRole('option', { name: 'Research', exact: true }).click();
  await workspace.getByRole('button', { name: 'Preview preset', exact: true }).click();
  const previewDialog = page.getByRole('dialog', { name: 'Preview Research layout', exact: true });
  await previewDialog.getByText('Split the Markdown editor and preview').waitFor();
  await previewDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'All notes', exact: true }).waitFor();

  await preset.click();
  await page.getByRole('option', { name: 'Research', exact: true }).click();
  await workspace.getByRole('button', { name: 'Preview preset', exact: true }).click();
  await page.getByRole('dialog', { name: 'Preview Research layout', exact: true }).getByRole('button', { name: 'Apply preset', exact: true }).click();
  await page.getByRole('button', { name: 'Undo Research', exact: true }).waitFor();
  await page.getByRole('button', { name: 'All notes', exact: true }).click();
  await note.click();
  await page.getByRole('button', { name: 'Split', exact: true }).waitFor();
  const previewPanel = page.getByRole('article', { name: 'Markdown preview', exact: true });
  const previewXBeforeResize = (await previewPanel.boundingBox()).x;
  const splitHandle = page.getByRole('separator', { name: 'Resize editor and preview', exact: true });
  await splitHandle.focus();
  await splitHandle.press('ArrowRight');
  await page.waitForFunction((previous) => document.querySelector('article[aria-label="Markdown preview"]')?.getBoundingClientRect().x > previous, previewXBeforeResize);
  assert((await source.innerText()).includes('A changed draft that survives layout changes'), 'The editor draft remains mounted in split layout');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.waitForTimeout(700);
  assert((await page.locator('article[aria-label="Markdown preview"]').innerText()).includes('A changed draft that survives layout changes'), 'Preview renders the current draft');
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  assert((await source.innerText()).includes('A changed draft that survives layout changes'), 'Preview/source switching preserves the same draft');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const visibility = workspace.getByRole('checkbox', { name: 'Local graph', exact: true });
  await visibility.uncheck();
  const graphNav = page.getByRole('button', { name: 'Local graph', exact: true });
  assert.equal(await graphNav.count(), 0, 'Optional graph navigation can be hidden');
  await workspace.getByRole('combobox', { name: 'Sidebar width', exact: true }).click();
  await page.getByRole('option', { name: 'Wide · 320 px', exact: true }).click();
  await page.waitForFunction(() => Math.abs(document.querySelector('[aria-label="Workspace navigation"]')?.getBoundingClientRect().width - 320) < 2);

  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('region', { name: 'Workspace', exact: true }).getByRole('checkbox', { name: 'Local graph', exact: true }).uncheck().catch(() => {});
  const sidebar = page.locator('[aria-label="Workspace navigation"]');
  assert(Math.abs((await sidebar.boundingBox()).width - 320) < 2, 'Workspace sidebar width survives reload');

  await page.getByRole('button', { name: 'Reset workspace', exact: true }).click();
  const resetDialog = page.getByRole('alertdialog', { name: 'Reset this workspace?', exact: true });
  await resetDialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  const settingsScroll = page.locator('main');
  const dimensions = await settingsScroll.evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  assert(dimensions.scroll <= dimensions.client + 1, 'Workspace settings do not overflow on mobile');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await note.click();
  const mobileMode = page.getByRole('combobox', { name: 'Markdown rendering mode', exact: true });
  await mobileMode.click();
  await page.getByRole('option', { name: 'Split', exact: true }).click();
  const mobileSeparator = page.getByRole('separator', { name: 'Resize editor and preview', exact: true });
  await mobileSeparator.waitFor();
  const splitPanels = await page.evaluate(() => {
    const editorPanel = document.querySelector('#note-editor-panel')?.getBoundingClientRect();
    const previewPanel = document.querySelector('#note-preview-panel')?.getBoundingClientRect();
    return editorPanel && previewPanel ? { editor: editorPanel.toJSON(), preview: previewPanel.toJSON() } : null;
  });
  assert(splitPanels && splitPanels.preview.y >= splitPanels.editor.bottom - 1, 'Mobile split layout stacks preview below editor');
  assert((await mobileSeparator.getAttribute('aria-orientation')) === 'horizontal', 'Mobile split separator follows the stacked panel orientation');

  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  const backupRegion = page.getByRole('region', { name: 'Backup and restore', exact: true });
  const recoveryAlert = backupRegion.getByRole('alert').filter({ hasText: recoveryOperationId });
  await recoveryAlert.getByRole('button', { name: 'Retry safely', exact: true }).click();
  await backupRegion.getByText(/Import completed · operation/).first().waitFor();
  await page.unroute(`**/api/import/operations/${recoveryOperationId}/retry`);
  await page.unroute('**/api/import/operations');
  const exportPath = backupRegion.getByRole('textbox', { name: 'Export folder', exact: true });
  await exportPath.fill(exportTarget);
  await page.route('**/api/export', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'STORAGE_FAILURE', message: 'Injected portable export failure.' } }) }));
  await backupRegion.getByRole('button', { name: 'Export workspace', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Injected portable export failure.' }).waitFor();
  await page.unroute('**/api/export');

  let releaseExport;
  let exportReached;
  const exportPending = new Promise((resolve) => { exportReached = resolve; });
  const release = new Promise((resolve) => { releaseExport = resolve; });
  await page.route('**/api/export', async (route) => {
    const response = await route.fetch();
    exportReached();
    await release;
    await route.fulfill({ response });
  });
  const exportButton = backupRegion.getByRole('button', { name: 'Export workspace', exact: true });
  await exportButton.click();
  await exportPending;
  await backupRegion.getByRole('button', { name: 'Exporting…', exact: true }).waitFor();
  releaseExport();
  await backupRegion.getByText(`Portable export completed at ${exportTarget}.`, { exact: false }).waitFor();
  const portableManifest = JSON.parse(await readFile(join(exportTarget, 'nodus-export.json'), 'utf8'));
  assert(portableManifest.format === 'nodus-portable-export' && portableManifest.version === 1, 'Settings export creates a versioned portable manifest');
  assert(portableManifest.resources.some((resource) => resource.path === 'workspace-note.md'), 'Settings export includes the source note');
  await page.unroute('**/api/export');
  const importPath = backupRegion.getByRole('textbox', { name: 'Source folder', exact: true });
  await importPath.fill(join(exportParent, 'missing-source'));
  await backupRegion.getByRole('button', { name: 'Preview import', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /not found|does not exist/i }).waitFor();
  await importPath.fill(exportTarget);
  await backupRegion.getByRole('button', { name: 'Preview import', exact: true }).click();
  await backupRegion.getByRole('status').filter({ hasText: 'Portable export v1 manifest and inventory validated' }).waitFor();
  let releasePreview;
  let previewReached;
  const previewPending = new Promise((resolve) => { previewReached = resolve; });
  const previewGate = new Promise((resolve) => { releasePreview = resolve; });
  await page.route('**/api/import/preview', async (route) => {
    previewReached();
    await previewGate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      source: exportTarget, format: 'nodus-portable-export', completeness: 'manifest-validated', manifestVersion: 1,
      previewId: 'P'.repeat(43), expiresAt: new Date(Date.now() + 60_000).toISOString(),
      counts: { notes: 3, databases: 1, databaseViews: 1, attachments: 0, otherResources: 0 },
      resources: [
        { kind: 'note', id: 'new-id', path: 'new.md', status: 'new', safeChoices: ['add', 'skip'] },
        { kind: 'note', id: 'same-id', path: 'same.md', status: 'identical', safeChoices: ['skip'] },
        { kind: 'database', id: 'conflict-id', path: 'databases/conflict.json', status: 'conflict', reason: 'ID already exists with different content', safeChoices: ['skip', 'replace'] },
      ],
      warnings: ['Database db-id property prop-id targets a missing database.'], errors: [],
      conflicts: [{ kind: 'database', id: 'conflict-id', path: 'databases/conflict.json', status: 'conflict', reason: 'ID already exists with different content', safeChoices: ['skip', 'replace'] }],
    }) });
  });
  await importPath.fill(exportTarget);
  await backupRegion.getByRole('button', { name: 'Preview import', exact: true }).click();
  await previewPending;
  await backupRegion.getByRole('button', { name: 'Previewing…', exact: true }).waitFor();
  releasePreview();
  const previewStatus = backupRegion.getByRole('status');
  await previewStatus.getByText('1 new · 1 identical · 1 conflicts', { exact: true }).waitFor();
  await backupRegion.getByText(/ID already exists with different content/).waitFor();
  await backupRegion.getByText('Database db-id property prop-id targets a missing database.').waitFor();
  const newResource = backupRegion.getByRole('listitem').filter({ hasText: 'new.md' });
  assert.equal(await newResource.getByRole('button', { name: 'Add', exact: true }).getAttribute('aria-pressed'), 'true', 'New resources default to explicit Add decision');
  const conflictResource = backupRegion.getByRole('listitem').filter({ hasText: 'databases/conflict.json' });
  await conflictResource.getByRole('button', { name: 'Replace', exact: true }).click();
  const replaceConsent = backupRegion.getByRole('checkbox', { name: /explicitly approve replacing those exact resources/i });
  await replaceConsent.check();
  let executeRequest;
  let releaseExecute;
  let executeReached;
  const executePending = new Promise((resolve) => { executeReached = resolve; });
  const executeGate = new Promise((resolve) => { releaseExecute = resolve; });
  await page.route('**/api/import/execute', async (route) => {
    executeRequest = route.request().postDataJSON();
    executeReached();
    await executeGate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      operationId: '11111111-1111-4111-8111-111111111111', state: 'completed', startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      counts: { notes: 1, databases: 0, databaseViews: 0 },
      resources: [
        { kind: 'note', id: 'new-id', path: 'new.md', decision: 'add', status: 'published', sha256: 'a'.repeat(64) },
        { kind: 'note', id: 'same-id', path: 'same.md', decision: 'skip', status: 'skipped' },
        { kind: 'database', id: 'conflict-id', path: 'databases/conflict.json', decision: 'replace', status: 'published', sha256: 'b'.repeat(64) },
      ],
    }) });
  });
  const confirmImport = backupRegion.getByRole('button', { name: 'Confirm and import', exact: true });
  await confirmImport.click();
  await executePending;
  await backupRegion.getByRole('button', { name: 'Importing…', exact: true }).waitFor();
  assert.equal(executeRequest.confirm, true, 'Execution requires explicit confirmation');
  assert.equal(executeRequest.previewId, 'P'.repeat(43), 'Execution is bound to the opaque preview handle');
  assert(executeRequest.decisions.some((decision) => decision.choice === 'replace' && decision.id === 'conflict-id'), 'Replace choice is sent with stable resource identity');
  releaseExecute();
  await backupRegion.getByText(/Import completed · operation/).waitFor();
  await page.unroute('**/api/import/execute');
  await page.unroute('**/api/import/preview');
  const retryPreview = {
    source: exportTarget, format: 'nodus-portable-export', completeness: 'manifest-validated', manifestVersion: 1,
    previewId: 'R'.repeat(43), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    counts: { notes: 1, databases: 0, databaseViews: 0, attachments: 0, otherResources: 0 },
    resources: [{ kind: 'note', id: 'retry-id', path: 'retry.md', status: 'new', safeChoices: ['add', 'skip'] }],
    warnings: [], errors: [], conflicts: [],
  };
  await page.route('**/api/import/preview', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(retryPreview) }));
  await page.route('**/api/import/execute', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'STALE_PREVIEW', message: 'The destination changed after preview. Create a fresh preview.' } }) }));
  await backupRegion.getByRole('button', { name: 'Preview import', exact: true }).click();
  await backupRegion.getByText(/Portable export v1 manifest and inventory validated/).waitFor();
  await backupRegion.getByRole('button', { name: 'Confirm and import', exact: true }).click();
  await backupRegion.getByRole('alert').filter({ hasText: 'destination changed after preview' }).waitFor();
  assert.equal(await backupRegion.getByRole('button', { name: 'Confirm and import', exact: true }).count(), 0, 'A stale preview cannot be submitted again');
  await page.unroute('**/api/import/execute');
  await backupRegion.getByRole('button', { name: 'Create a fresh preview', exact: true }).click();
  await backupRegion.getByText(/Portable export v1 manifest and inventory validated/).waitFor();
  await page.route('**/api/import/execute', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    operationId: '22222222-2222-4222-8222-222222222222', state: 'completed', startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    counts: { notes: 1, databases: 0, databaseViews: 0 }, resources: [{ kind: 'note', id: 'retry-id', path: 'retry.md', decision: 'add', status: 'published', sha256: 'c'.repeat(64) }],
  }) }));
  await backupRegion.getByRole('button', { name: 'Confirm and import', exact: true }).click();
  await backupRegion.getByText(/Import completed · operation/).waitFor();
  await page.unroute('**/api/import/execute');
  await page.unroute('**/api/import/preview');
  await page.route('**/api/import/preview', (route) => route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INVALID_CONTENT', message: 'Portable package failed validation.', paths: ['databases/broken.json'], issues: ['Invalid database schema.'] } }) }));
  await backupRegion.getByRole('button', { name: 'Preview import', exact: true }).click();
  const importError = page.getByRole('alert').filter({ hasText: 'Portable package failed validation.' });
  await importError.getByText('databases/broken.json').waitFor();
  await page.unroute('**/api/import/preview');
  await importPath.fill(exportTarget);
  await backupRegion.getByRole('button', { name: 'Preview import', exact: true }).click();
  await backupRegion.getByRole('status').filter({ hasText: 'Portable export v1 manifest and inventory validated' }).waitFor();
  await page.route('**/api/import/preview', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: exportTarget, format: 'legacy-directory', completeness: 'unverified-legacy', counts: { notes: 1, databases: 0, databaseViews: 0, attachments: 0, otherResources: 0 }, previewId: 'L'.repeat(43), expiresAt: new Date(Date.now() + 60_000).toISOString(), resources: [], warnings: ['No portable manifest is present. Recognized resources were validated, but directory completeness cannot be established; this may be an interrupted export.'], errors: [], conflicts: [] }) }));
  await backupRegion.getByRole('button', { name: 'Preview import', exact: true }).click();
  await backupRegion.getByRole('status').filter({ hasText: 'Legacy directory preview; recognized resources validated, completeness unverified' }).waitFor();
  await backupRegion.getByRole('note').filter({ hasText: 'directory completeness cannot be established' }).waitFor();
  await page.unroute('**/api/import/preview');
  assert.equal(await page.getByRole('button', { name: 'Confirm and import', exact: true }).count(), 0, 'Execution action is absent without an active preview');
  await importPath.fill(legacyImportSource);
  await backupRegion.getByRole('button', { name: 'Preview import', exact: true }).click();
  await backupRegion.getByRole('status').filter({ hasText: 'Legacy directory preview; recognized resources validated, completeness unverified' }).waitFor();
  await backupRegion.getByRole('note').filter({ hasText: 'directory completeness cannot be established' }).waitFor();
  await backupRegion.getByRole('button', { name: 'Confirm and import', exact: true }).click();
  await backupRegion.getByText(/Import completed · operation/).waitFor();
  assert.equal(await readFile(join(root, 'notes', 'browser-import.md'), 'utf8'), importedMarkdown, 'The real preview-to-execution flow publishes the exact source note bytes');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Workspace customization browser smoke passed (real legacy import publication plus preview, explicit conflict choices, replacement consent, loading/completion, stale-preview rejection, refreshed retry, API error, legacy/empty states, and no unintended apply action).');
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
  await rm(root, { recursive: true, force: true });
  await rm(exportParent, { recursive: true, force: true });
  await rm(importParent, { recursive: true, force: true });
}
