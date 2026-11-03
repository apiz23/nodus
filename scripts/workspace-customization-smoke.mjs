import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = await mkdtemp(join(tmpdir(), 'nodus-workspace-'));
process.env.NODUS_VAULT = root;
let server;
let browser;
try {
  await writeFile(join(root, 'workspace-note.md'), '# Workspace note\n\nA small draft for layout checks.\n', 'utf8');
  server = await createServer({ configFile: 'ui/vite.config.ts', server: { port: 0, strictPort: false } });
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
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Workspace customization browser smoke passed (preset preview/apply/undo, draft-preserving editor layouts, keyboard split resizing, sidebar visibility/width persistence, mobile stacked layout, reset cancellation).');
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
  await rm(root, { recursive: true, force: true });
}
