import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 24) {
  throw new Error(`Nodus browser smoke tests require Node 24 or newer; found ${process.versions.node}`);
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert(address && typeof address === 'object', 'Could not reserve a loopback port');
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return address.port;
}

function startVite(vaultPath, port, preferencesPath) {
  const viteEntry = join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [viteEntry, '--config', 'ui/vite.config.ts', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODUS_VAULT: vaultPath,
      NODUS_PREFERENCES_PATH: preferencesPath,
      NODUS_ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { logs = `${logs}${chunk}`.slice(-12_000); });
  child.stderr.on('data', (chunk) => { logs = `${logs}${chunk}`.slice(-12_000); });
  const closed = new Promise((resolveClose) => {
    child.once('close', (code, signal) => resolveClose({ code, signal }));
  });
  return { child, closed, logs: () => logs };
}

async function waitForVite(started, port, timeoutMs = 20_000) {
  const { child, closed, logs } = started;
  let output = '';
  const ready = new Promise((resolveReady, rejectReady) => {
    const onData = (chunk) => {
      output = `${output}${chunk}`.slice(-12_000);
      // Vite colorizes its ready URL even when stdout is piped, so match the
      // plain text rather than requiring an uncolored literal.
      const plain = output.replace(/\x1b\[[0-9;]*m/g, '');
      if (plain.includes(`http://127.0.0.1:${port}/`)) finish(resolveReady);
    };
    const onExit = (code, signal) => finish(rejectReady, new Error(
      `Dedicated Vite process exited before listening (${code ?? signal ?? 'unknown'}). ${logs()}`,
    ));
    const finish = (settle, value) => {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
      settle(value);
    };
    const onError = (error) => finish(rejectReady, error);
    const timer = setTimeout(() => finish(rejectReady, new Error(
      `Timed out waiting for dedicated Vite process. ${logs()}`,
    )), timeoutMs);
    child.stdout.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
  await ready;
}

async function stopVite(started) {
  if (started.child.exitCode !== null || started.child.signalCode !== null) return;
  const exited = started.closed;
  started.child.kill('SIGTERM');
  const result = await Promise.race([exited, delay(5_000).then(() => null)]);
  if (result !== null) return;
  started.child.kill('SIGKILL');
  await exited;
}

const tempRoot = await mkdtemp(join(tmpdir(), 'nodus-breadcrumb-tree-'));
let started;
let browser;
try {
  const vault = join(tempRoot, 'vault');
  const folder = join(vault, 'notes', 'ZZ Projects', 'Nested');
  await mkdir(folder, { recursive: true });
  const timestamp = '2026-10-28T10:00:00Z';
  for (const [name, id] of [
    ['Target', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    ['Sibling', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
  ]) {
    await writeFile(join(folder, `${name.toLowerCase()}.md`), [
      '---', `title: ${name}`, 'nodus:', '  version: 1', `  id: ${id}`,
      `  createdAt: ${timestamp}`, `  updatedAt: ${timestamp}`, '---', `${name} body`,
    ].join('\n'));
  }
  const port = await reserveLoopbackPort();
  started = startVite(vault, port, join(tempRoot, 'preferences.json'));
  await waitForVite(started, port);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(12_000);
  let responseAt;
  let refreshed = false;
  const releaseNotes = Promise.withResolvers();
  const releaseFolders = Promise.withResolvers();
  await page.route('**/api/folders', async (route) => {
    if (!refreshed) {
      await route.fulfill({ status: 503, json: { error: 'Fixture folder refresh unavailable' } });
      return;
    }
    await releaseFolders.promise;
    await route.fulfill({ json: { folders: ['notes/ZZ Projects'] } });
  });
  await page.route('**/api/notes', async (route) => {
    const response = await route.fetch();
    const { notes } = await response.json();
    assert.equal(notes.length, 2);
    const synthetic = Array.from({ length: 5048 }, (_, index) => ({
      ...notes[0], id: `fixture-${index}`, title: `Page ${String(index).padStart(5, '0')}`,
      path: `notes/AA Fixture/page-${index}.md`,
    }));
    if (refreshed) {
      await releaseNotes.promise;
      await route.fulfill({ response, json: { notes: synthetic } });
      return;
    }
    responseAt = performance.now();
    await route.fulfill({ response, json: { notes: [...synthetic, ...notes] } });
  });
  await page.goto(`http://127.0.0.1:${port}/app`);
  const tree = page.getByRole('tree', { name: 'Pages' });
  const rows = tree.getByRole('treeitem');
  await rows.first().waitFor();
  const initialMs = performance.now() - responseAt;
  const mounted = await rows.count();
  assert(mounted < 64, `Mounted ${mounted} rows`);
  const guide = page.getByRole('button', { name: 'Got it' });
  if (await guide.isVisible()) await guide.click();
  const start = performance.now();
  await rows.first().press('End');
  const target = tree.getByRole('treeitem', { name: 'Target (target.md)', exact: true });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Target (target.md)');
  const endMs = performance.now() - start;
  await target.press('Enter');
  const breadcrumb = page.getByRole('button', { name: 'Open folder ZZ Projects/Nested', exact: true });
  const search = page.locator('input[aria-label="Search notes"]');
  await search.fill('Target');
  await tree.waitFor({ state: 'hidden' });
  await breadcrumb.click();
  assert.equal(await search.inputValue(), '');
  await page.waitForFunction(() => {
    const element = document.querySelector('[role="treeitem"][aria-label="Nested, 2 pages"][aria-current="location"]');
    if (!element) return false;
    const row = element.getBoundingClientRect();
    const viewport = element.closest('.overflow-y-auto').getBoundingClientRect();
    return row.top >= viewport.top && row.bottom <= viewport.bottom;
  });
  const projects = tree.getByRole('treeitem', { name: 'ZZ Projects, 2 pages', exact: true });
  const nested = tree.getByRole('treeitem', { name: 'Nested, 2 pages', exact: true });
  const sibling = tree.getByRole('treeitem', { name: 'Sibling (sibling.md)', exact: true });
  const projectsBreadcrumb = page.getByRole('button', { name: 'Open folder ZZ Projects', exact: true });
  await projectsBreadcrumb.click();
  await projects.and(tree.locator('[aria-current="location"]')).waitFor();
  await sibling.click();
  await nested.and(tree.locator('[aria-current="location"]')).waitFor();
  assert.equal(await sibling.getAttribute('aria-selected'), 'true');

  await sibling.press('Home');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'AA Fixture, 5048 pages');
  await breadcrumb.press('Enter');
  await nested.and(tree.locator('[tabindex="0"][aria-current="location"]')).waitFor();
  assert.equal(await breadcrumb.evaluate((button) => button === document.activeElement), true);
  const retryFolders = page.getByRole('alert').filter({ hasText: 'Folders could not be refreshed' })
    .getByRole('button', { name: 'Retry' });
  await retryFolders.focus();
  await page.keyboard.press('Tab');
  assert.equal(await nested.evaluate((row) => row === document.activeElement), true);
  await page.keyboard.press('ArrowDown');
  assert.equal(await sibling.evaluate((row) => row === document.activeElement), true);
  assert((await rows.count()) < 64, 'Keyboard navigation exceeded the mounted row bound');

  await page.getByRole('button', { name: 'Open all notes', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="treeitem"][aria-current="location"]'));
  // Retry with independently delayed note and folder inventories.
  refreshed = true;
  await Promise.all([
    page.waitForRequest('**/api/notes'),
    page.waitForRequest('**/api/folders'),
    retryFolders.click(),
  ]);
  await page.getByLabel('Loading pages').waitFor();
  await breadcrumb.press('Enter');
  await projectsBreadcrumb.press('Enter');
  releaseNotes.resolve();
  await tree.getByRole('treeitem', { name: 'AA Fixture, 5048 pages', exact: true }).waitFor();
  assert.equal(await page.getByText('Could not reveal folder ZZ Projects.', { exact: true }).count(), 0);
  releaseFolders.resolve();
  const refreshedFolder = tree.getByRole('treeitem', { name: 'ZZ Projects, 0 pages', exact: true });
  await refreshedFolder.and(tree.locator('[tabindex="0"][aria-current="location"]')).waitFor();
  await page.waitForFunction(() => {
    const row = document.querySelector('[role="treeitem"][aria-label="ZZ Projects, 0 pages"][aria-current="location"]');
    const viewport = row?.closest('.overflow-y-auto');
    if (!row || !viewport) return false;
    const bounds = row.getBoundingClientRect();
    const visible = viewport.getBoundingClientRect();
    return bounds.top >= visible.top && bounds.bottom <= visible.bottom;
  });
  assert.equal(await projectsBreadcrumb.evaluate((button) => button === document.activeElement), true);
  assert.equal(await page.getByText('Could not reveal folder ZZ Projects/Nested.', { exact: true }).count(), 0);

  await breadcrumb.press('Enter');
  await page.getByText('Could not reveal folder ZZ Projects/Nested.', { exact: true }).waitFor({ state: 'attached' });
  assert.equal(await tree.locator('[aria-current="location"]').count(), 0);
  assert.equal(await breadcrumb.evaluate((button) => button === document.activeElement), true);

  // Mobile: the same single breadcrumb stays visible and drives the sidebar drawer.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => window.matchMedia('(min-width: 768px)').matches === false);
  await page.waitForTimeout(150);
  const breadcrumbNav = page.getByRole('navigation', { name: 'Breadcrumb' });
  assert.equal(await breadcrumbNav.count(), 1, 'Expected exactly one breadcrumb navigation');
  assert.equal(await breadcrumbNav.isVisible(), true, 'Compact breadcrumb should be visible below sm');
  const currentPage = breadcrumbNav.locator('[aria-current="page"]');
  await currentPage.waitFor();
  assert.equal(await currentPage.isVisible(), true);
  assert.equal((await currentPage.textContent()).trim(), 'Sibling');
  const titleField = page.getByRole('textbox', { name: 'Note title', exact: true });
  const titleBeforeDrawer = await titleField.inputValue();

  await projectsBreadcrumb.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Workspace navigation' });
  await drawer.waitFor();
  assert.equal(await drawer.isVisible(), true, 'Ancestor navigation should open the mobile sidebar drawer');
  await drawer.getByRole('treeitem', { name: 'ZZ Projects, 0 pages', exact: true })
    .and(drawer.locator('[aria-current="location"]')).waitFor();
  assert.equal(await titleField.inputValue(), titleBeforeDrawer, 'Opening the drawer must not change the open note');
  assert.equal(await breadcrumbNav.isVisible(), true);

  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'hidden' });
  assert.equal(await breadcrumbNav.isVisible(), true, 'Breadcrumb remains visible after the drawer closes');

  await page.getByRole('button', { name: 'Open all notes', exact: true }).click();
  assert.equal(await page.getByRole('dialog', { name: 'Workspace navigation' }).count(), 0);
  assert.equal(await search.inputValue(), '');

  console.log(JSON.stringify({ summaries: 5050, mounted, responseToFirstRowMs: Math.round(initialMs), keyboardEndMs: Math.round(endMs), mobileBreadcrumbDrawer: true }));
} finally {
  await browser?.close();
  if (started) await stopVite(started);
  await rm(tempRoot, { recursive: true, force: true });
}
