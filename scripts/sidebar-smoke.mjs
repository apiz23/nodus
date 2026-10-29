import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = await mkdtemp(join(tmpdir(), 'nodus-sidebar-'));
process.env.NODUS_VAULT = root;
let server, browser;
try {
  await mkdir(join(root, 'Projects/Research/Deep'), { recursive: true });
  await mkdir(join(root, 'Empty'));
  await Promise.all([
    writeFile(join(root, 'root-file.md'), '# Root document\n\nRoot body.\n'),
    writeFile(join(root, 'Projects/project-file.md'), '# Project document\n\nProject body.\n'),
    writeFile(join(root, 'Projects/Research/research-file.md'), '# Research document\n'),
    writeFile(join(root, 'Projects/Research/Deep/deep-file.md'), '# Deep document\n'),
    writeFile(join(root, 'Projects/image.png'), 'unsupported attachment'),
  ]);
  server = await createServer({ configFile: 'ui/vite.config.ts', server: { port: 0, strictPort: false } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  process.env.NODUS_ALLOWED_ORIGINS = base;
  const request = async (path, method = 'GET', body) => {
    const result = await fetch(`${base}/api${path}`, { method, ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }) });
    assert(result.ok, `${method} ${path}: HTTP ${result.status}`);
    return result.json();
  };
  const response = await fetch(`${base}/api/notes`);
  assert.equal(response.status, 200);
  const { notes } = await response.json();
  const titleFor = (path) => notes.find((note) => note.path === path).title;
  const rootTitle = titleFor('root-file.md');
  const deepTitle = titleFor('Projects/Research/Deep/deep-file.md');
  const rootLabel = `${rootTitle} (root-file.md)`;
  const deepLabel = `${deepTitle} (deep-file.md)`;
  assert.deepEqual(notes.map((note) => note.path).sort(), [
    'Projects/Research/Deep/deep-file.md', 'Projects/Research/research-file.md', 'Projects/project-file.md', 'root-file.md',
  ]);
  const folders = await (await fetch(`${base}/api/folders`)).json();
  assert.deepEqual(folders.folders, ['Empty', 'Projects', 'Projects/Research', 'Projects/Research/Deep']);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  let expectedApiFailure = false;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !(expectedApiFailure && /500/.test(message.text()))) errors.push(message.text());
  });
  page.on('response', (result) => {
    if (new URL(result.url()).pathname.startsWith('/api/') && result.status() >= 400 && !expectedApiFailure) errors.push(`${result.status()} ${result.url()}`);
  });
  await page.goto(`${base}/app`);
  const tree = page.getByRole('tree', { name: 'Pages', exact: true });
  await tree.getByRole('treeitem', { name: deepLabel, exact: true }).waitFor({ state: 'attached' });
  const geometry = await tree.evaluate((element) => {
    const parent = element.querySelector('[aria-label="Projects, 3 pages"]');
    const group = parent.closest('[role="none"]').querySelector('[role="group"]');
    const row = parent.getBoundingClientRect();
    const children = group.getBoundingClientRect();
    return { parent: { x: row.x, y: row.y, bottom: row.bottom }, children: { x: children.x, y: children.y }, width: element.clientWidth, scrollWidth: element.scrollWidth };
  });
  console.log('Sidebar geometry:', JSON.stringify(geometry));
  if (process.env.NODUS_SMOKE_ARTIFACTS) {
    await mkdir(process.env.NODUS_SMOKE_ARTIFACTS, { recursive: true });
    await page.screenshot({ path: join(process.env.NODUS_SMOKE_ARTIFACTS, 'sidebar-desktop.png') });
  }
  assert(geometry.children.y >= geometry.parent.bottom - 1, 'Expanded children must render below the folder row');
  assert(geometry.scrollWidth <= geometry.width + 1, 'Tree must not overflow horizontally');
  for (const [path, depth] of [['root-file.md', 1], ['Projects/project-file.md', 2], ['Projects/Research/research-file.md', 3], ['Projects/Research/Deep/deep-file.md', 4]]) {
    const item = tree.getByRole('treeitem', { name: `${titleFor(path)} (${path.split('/').at(-1)})`, exact: true });
    assert.equal(await item.getAttribute('aria-level'), String(depth));
    assert.equal(await item.locator('span').last().innerText(), path.split('/').at(-1));
  }
  await tree.getByRole('treeitem', { name: rootLabel, exact: true }).click();
  await page.waitForFunction((title) => document.querySelector('#note-title')?.value === title, rootTitle);
  const sidebar = page.getByLabel('Workspace navigation', { exact: true });
  const handle = page.getByRole('separator', { name: 'Resize sidebar', exact: true });
  const initialWidth = (await sidebar.boundingBox()).width;
  const divider = await handle.boundingBox();
  await page.mouse.move(divider.x + divider.width / 2, divider.y + 100);
  await page.mouse.down();
  await page.mouse.move(divider.x + 110, divider.y + 100, { steps: 8 });
  await page.mouse.up();
  assert((await sidebar.boundingBox()).width > initialWidth + 80, 'Dragging the divider must widen the sidebar');
  const draggedWidth = (await sidebar.boundingBox()).width;
  await handle.focus();
  await handle.press('ArrowRight');
  const resizedWidth = (await sidebar.boundingBox()).width;
  assert(resizedWidth > draggedWidth, 'Keyboard resizing must widen the sidebar');
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await page.waitForFunction(() => Math.abs(document.querySelector('aside').getBoundingClientRect().width - 64) < 1);
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
  await page.waitForFunction((width) => Math.abs(document.querySelector('aside').getBoundingClientRect().width - width) < 2, resizedWidth);
  assert.equal(await tree.getByText('image.png', { exact: true }).count(), 0);
  await tree.getByRole('treeitem', { name: 'Projects, 3 pages' }).click();
  assert.equal(await tree.getByRole('treeitem', { name: deepLabel, exact: true }).count(), 0);
  await tree.getByRole('treeitem', { name: 'Projects, 3 pages' }).press('ArrowRight');
  await tree.getByRole('treeitem', { name: deepLabel, exact: true }).click();
  await page.waitForFunction((title) => document.querySelector('#note-title')?.value === title, deepTitle);
  await tree.getByRole('treeitem', { name: deepLabel, exact: true }).press('ArrowLeft');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Deep, 1 page');
  await page.reload();
  await tree.getByRole('treeitem', { name: deepLabel, exact: true }).waitFor();
  assert(Math.abs((await sidebar.boundingBox()).width - resizedWidth) < 2, 'Sidebar width must survive reload');
  await tree.getByRole('treeitem', { name: 'Empty, 0 pages' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await tree.getByRole('treeitem', { name: deepLabel, exact: true }).waitFor();
  if (process.env.NODUS_SMOKE_ARTIFACTS) await page.screenshot({ path: join(process.env.NODUS_SMOKE_ARTIFACTS, 'sidebar-mobile.png') });

  // Run mutations through the actual UI and assert each refresh without reloading.
  await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Create folder' });
  await dialog.getByRole('textbox', { name: 'Folder name' }).fill('Scratch');
  await dialog.getByRole('button', { name: 'Create folder', exact: true }).click();
  await tree.getByRole('treeitem', { name: 'Scratch, 0 pages' }).waitFor();
  const folderAction = async (folder, action) => {
    await page.getByRole('button', { name: `Actions for ${folder}`, exact: true }).click();
    await page.getByRole('menuitem', { name: action, exact: true }).click();
  };
  await folderAction('Scratch', 'Rename folder');
  dialog = page.getByRole('dialog', { name: 'Rename folder' });
  await dialog.getByRole('textbox', { name: 'Folder name' }).fill('Renamed');
  await dialog.getByRole('button', { name: 'Rename folder', exact: true }).click();
  await tree.getByRole('treeitem', { name: 'Renamed, 0 pages' }).waitFor();
  assert.equal(await tree.getByRole('treeitem', { name: 'Scratch, 0 pages' }).count(), 0);
  await folderAction('Renamed', 'Move folder');
  dialog = page.getByRole('dialog', { name: 'Move folder' });
  await dialog.getByRole('combobox', { name: 'Parent folder' }).click();
  await page.getByRole('option', { name: 'Projects', exact: true }).click();
  await dialog.getByRole('button', { name: 'Move folder', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Renamed, 0 pages"]')?.getAttribute('aria-level') === '2');
  await folderAction('Renamed', 'New note here');
  await tree.getByText('untitled-note.md', { exact: true }).waitFor();
  const created = (await request('/notes')).notes.find((note) => note.path === 'Projects/Renamed/untitled-note.md');
  assert(created, 'New note was not created in the selected folder');
  for (const destination of ['Projects/Renamed/changed.md', 'root-moved.md']) {
    await folderAction(created.title, 'Rename path');
    dialog = page.getByRole('dialog', { name: 'Rename note path' });
    await dialog.getByRole('textbox', { name: 'Workspace-relative path' }).fill(destination);
    await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
    await tree.getByText(destination.split('/').at(-1), { exact: true }).waitFor();
    assert.equal((await request(`/notes/${created.id}`)).note.path, destination);
  }
  const movedNote = tree.getByRole('treeitem', { name: `${created.title} (root-moved.md)`, exact: true });
  assert.equal(await movedNote.getAttribute('aria-level'), '1');
  await folderAction(created.title, 'Delete note');
  await page.getByRole('alertdialog', { name: 'Delete this note?' }).getByRole('button', { name: 'Delete note', exact: true }).click();
  await movedNote.waitFor({ state: 'detached' });
  await folderAction('Renamed', 'Delete folder');
  dialog = page.getByRole('alertdialog', { name: 'Delete this folder and its contents?' });
  await dialog.getByText(/Contains 0 notes/).waitFor();
  await dialog.getByRole('button', { name: 'Delete folder', exact: true }).click();
  await tree.getByRole('treeitem', { name: 'Renamed, 0 pages' }).waitFor({ state: 'detached' });

  // Initial load errors must remain actionable and must not discard valid data.
  for (const endpoint of ['folders', 'notes']) {
    let failing = true;
    expectedApiFailure = true;
    await page.route(`**/api/${endpoint}`, async (route) => {
      if (!failing) return route.continue();
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'STORAGE_FAILURE', message: `Injected ${endpoint} read failure` } }) });
    });
    await page.reload();
    const alert = page.getByRole('alert').filter({ hasText: `Injected ${endpoint} read failure` });
    await alert.waitFor();
    if (endpoint === 'folders') await tree.getByText('root-file.md', { exact: true }).waitFor();
    failing = false;
    await alert.getByRole('button', { name: 'Retry', exact: true }).click();
    await alert.waitFor({ state: 'detached' });
    await tree.getByRole('treeitem', { name: 'Empty, 0 pages' }).waitFor();
    await tree.getByText('root-file.md', { exact: true }).waitFor();
    await page.unroute(`**/api/${endpoint}`);
    expectedApiFailure = false;
  }

  for (const folder of ['Projects', 'Empty']) {
    const { impact } = await request(`/folders/impact?path=${folder}`);
    await request('/folders', 'DELETE', { path: folder, token: impact.token });
  }
  const rootNote = notes.find((note) => note.path === 'root-file.md');
  await request(`/notes/${rootNote.id}`, 'DELETE', { baseHash: (await request(`/notes/${rootNote.id}`)).note.contentHash });
  // Creating/deleting the default note leaves notes/, which is hidden in this tree.
  const { note: last } = await request('/notes', 'POST', { title: 'Last note' });
  await request(`/notes/${last.id}`, 'DELETE', { baseHash: last.contentHash });
  await page.reload();
  await page.getByText('No pages yet', { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log('Sidebar browser smoke passed: filesystem data, nested layout, filenames, collapse/expand, stable-ID opening, create/rename/move/delete refresh, reload, empty folders/vault, API retry, and mobile navigation.');
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
