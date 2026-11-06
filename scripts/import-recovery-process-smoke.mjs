import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, lstat, writeFile, copyFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const repository = process.cwd();
const root = await mkdtemp(join(tmpdir(), 'nodus-import-process-'));
const vault = join(root, 'workspace');
const processRegister = join(repository, 'scripts/import-process-register.mjs');
let uiServer;
let browser;
let worker;

const delayUntil = (promise, timeoutMs = 15_000, label = 'an import-process boundary') => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}.`)), timeoutMs);
  promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
});

function startWorker(mode = '', path = '') {
  return new Promise((resolveReady, reject) => {
    const child = fork(join(repository, 'scripts/import-recovery-api-worker.mjs'), [], {
      cwd: repository,
      execArgv: ['--experimental-transform-types', '--import', processRegister],
      env: { ...process.env, NODUS_VAULT: vault, NODUS_BACKUP_ROOTS: root, NODUS_ALLOWED_ORIGINS: uiBase, NODUS_IMPORT_CRASH_MODE: mode, NODUS_IMPORT_CRASH_PATH: path },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.on('message', (message) => {
      if (message?.type === 'ready') resolveReady({ child, port: message.port, stderr: () => stderr });
    });
    child.once('exit', (code, signal) => {
      if (code !== 0) reject(new Error(`Import API worker exited before ready (${code ?? signal}): ${stderr}`));
    });
  });
}

async function stopWorker(instance, force = false) {
  if (!instance) return;
  const child = instance.child;
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (force) child.kill('SIGKILL');
  else child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

async function waitForPause(instance, boundary) {
  return delayUntil(new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (message?.type === 'paused' && message.boundary === boundary) {
        instance.child.off('message', onMessage);
        resolve(message);
      }
    };
    instance.child.on('message', onMessage);
    instance.child.once('exit', (code, signal) => reject(new Error(`Worker exited before ${boundary} (${code ?? signal}). ${instance.stderr()}`)));
  }), 15_000, `worker boundary ${boundary}; exit=${instance.child.exitCode ?? instance.child.signalCode}; stderr=${instance.stderr()}`);
}

async function clearTestProcessLock(instance) {
  const lockPath = join(vault, '.nodus-vault-write.lock');
  try { await lstat(lockPath); } catch (error) { if (error?.code === 'ENOENT') return; throw error; }
  const before = await readFile(lockPath, 'utf8');
  const owner = JSON.parse(before);
  assert.equal(owner.pid, instance.child.pid, 'The abandoned lock must belong to the terminated isolated API process.');
  const info = await lstat(lockPath);
  assert.ok(info.isFile() && !info.isSymbolicLink(), 'The abandoned lock must be a regular non-symlink file.');
  await copyFile(lockPath, join(root, `preserved-lock-${owner.token}.json`));
  assert.equal(await readFile(lockPath, 'utf8'), before, 'The exact observed lock bytes must remain unchanged until explicit fixture recovery.');
  await unlink(lockPath);
}

async function createPackage(name, files) {
  const source = join(root, name);
  for (const [relative, contents] of Object.entries(files)) {
    const destination = join(source, relative);
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, contents, 'utf8');
  }
  return source;
}

async function openImportPanel(page, source) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Backup and restore', exact: true });
  await panel.getByLabel('Source folder', { exact: true }).fill(source);
  await panel.getByRole('button', { name: 'Preview import', exact: true }).click();
  await panel.getByText(/Legacy directory preview; recognized resources validated, completeness unverified/, { exact: false }).waitFor();
  return panel;
}

async function submitAdd(panel) {
  const buttons = await panel.getByRole('button', { name: 'Add', exact: true }).all();
  for (const button of buttons) await button.click();
  await panel.getByRole('button', { name: 'Confirm and import', exact: true }).click();
}

async function submitReplace(panel) {
  const buttons = await panel.getByRole('button', { name: 'Replace', exact: true }).all();
  for (const button of buttons) await button.click();
  await panel.getByRole('checkbox', { name: /explicitly approve replacing/ }).check();
  await panel.getByRole('button', { name: 'Confirm and import', exact: true }).click();
}

async function triggerAndKill(page, source, mode, path, boundary, choice) {
  // Each scenario owns one API process. Stop the prior idle process before
  // routing browser requests to the next child.
  await stopWorker(worker, true);
  worker = null;
  const transactionRoot = join(vault, '.nodus-import-transactions');
  const previous = new Set(await readdir(transactionRoot).catch(() => []));
  worker = await startWorker(mode, path);
  const panel = await openImportPanel(page, source);
  const paused = waitForPause(worker, boundary);
  if (choice === 'replace') await submitReplace(panel);
  else await submitAdd(panel);
  await paused;
  await stopWorker(worker, true);
  const operations = (await readdir(transactionRoot)).filter((candidate) => !previous.has(candidate));
  assert.equal(operations.length, 1, 'Each isolated scenario should create exactly one new operation.');
  const [id] = operations;
  assert.ok(id);
  await clearTestProcessLock(worker);
  worker = null;
  return id;
}

process.env.NODUS_VAULT = vault;
await mkdir(vault, { recursive: true });
uiServer = await createServer({ configFile: 'ui/vite.config.ts', cacheDir: join(root, '.vite-cache'), server: { port: 0, strictPort: false } });
await uiServer.listen();
const uiBase = `http://127.0.0.1:${uiServer.httpServer.address().port}`;
browser = await chromium.launch({ headless: true });

try {
  worker = await startWorker();
  assert.equal((await fetch(`http://127.0.0.1:${worker.port}/api/status`)).status, 200);
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.route('**/api/**', async (route) => {
    const original = new URL(route.request().url());
    original.port = String(worker?.port ?? apiPort);
    try {
      const response = await route.fetch({ url: original.href, timeout: 120_000 });
      await route.fulfill({ response });
    } catch {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'The local import API stopped during the controlled recovery test.' } }) }).catch(() => undefined);
    }
  });
  const apiPort = worker.port;
  await page.goto(`${uiBase}/app`);

  // Crash after the durable staging intent but before any staging directory or destination write.
  const stagingSource = await createPackage('staging-source', { 'notes/staging.md': '# staged\n' });
  const stagingId = await triggerAndKill(page, stagingSource, 'staging', '', 'staging-journal-durable', 'add');
  worker = await startWorker();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  let recovery = page.getByRole('region', { name: 'Backup and restore', exact: true });
  await recovery.getByText(`${stagingId} · staging · 1 resources`, { exact: true }).waitFor();
  await recovery.getByRole('button', { name: 'Recover staging safely', exact: true }).click();
  await recovery.getByRole('status').getByText(new RegExp(`Import recovery rolled-back · operation ${stagingId}`)).waitFor();
  await assert.rejects(readFile(join(vault, 'notes/staging.md')));

  // Crash after an exclusive add has reached disk but before its publication bit is journaled.
  const addSource = await createPackage('add-source', { 'notes/add-a.md': '# add a\n', 'notes/add-b.md': '# add b\n' });
  const addPath = 'notes/add-a.md';
  const addId = await triggerAndKill(page, addSource, 'add-published', addPath, 'addition-published-before-journal', 'add');
  worker = await startWorker();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  recovery = page.getByRole('region', { name: 'Backup and restore', exact: true });
  await recovery.getByText(`${addId} · publishing · 2 resources`, { exact: true }).waitFor();
  await recovery.getByRole('button', { name: 'Retry safely', exact: true }).click();
  await recovery.getByText(/Import completed/, { exact: false }).waitFor();
  assert.equal(await readFile(join(vault, 'notes/add-a.md'), 'utf8'), '# add a\n');
  assert.equal(await readFile(join(vault, 'notes/add-b.md'), 'utf8'), '# add b\n');
  await stopWorker(worker, true);
  worker = null;

  // Crash after replacement rename. The pre-rename journal record proves output inode ownership,
  // so the real UI can safely roll back and restore the original bytes.
  const replacePath = 'notes/replace.md';
  await mkdir(join(vault, 'notes'), { recursive: true });
  const originalReplace = '# original replace\n';
  await writeFile(join(vault, replacePath), originalReplace, 'utf8');
  const replaceSource = await createPackage('replace-source', { [replacePath]: '# incoming replace\n' });
  const replaceId = await triggerAndKill(page, replaceSource, 'replace-published', replacePath, 'replacement-renamed-before-publication-journal', 'replace');
  assert.equal(await readFile(join(vault, replacePath), 'utf8'), '# incoming replace\n');
  worker = await startWorker();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  recovery = page.getByRole('region', { name: 'Backup and restore', exact: true });
  await recovery.getByText(`${replaceId} · publishing · 1 resources`, { exact: true }).waitFor();
  await recovery.getByRole('button', { name: 'Roll back safely', exact: true }).click();
  await recovery.getByRole('status').getByText(new RegExp(`Import recovery rolled-back · operation ${replaceId}`)).waitFor();
  assert.equal(await readFile(join(vault, replacePath), 'utf8'), originalReplace);
  await stopWorker(worker, true);
  worker = null;

  // Crash after the replacement temp inode is journaled but before atomic rename.
  const preRenamePath = 'notes/pre-rename.md';
  const originalPreRename = '# original before rename\n';
  await writeFile(join(vault, preRenamePath), originalPreRename, 'utf8');
  const preRenameSource = await createPackage('pre-rename-source', { [preRenamePath]: '# incoming before rename\n' });
  const preRenameId = await triggerAndKill(page, preRenameSource, 'replace-temp-journaled', preRenamePath, 'replacement-temp-journaled-before-rename', 'replace');
  assert.equal(await readFile(join(vault, preRenamePath), 'utf8'), originalPreRename);
  assert.ok((await readdir(join(vault, 'notes'))).some((name) => name.startsWith('.nodus-tmp-')), 'The real pre-rename crash should leave the atomic writer temp for recovery to identify.');
  worker = await startWorker();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  recovery = page.getByRole('region', { name: 'Backup and restore', exact: true });
  await recovery.getByText(`${preRenameId} · publishing · 1 resources`, { exact: true }).waitFor();
  await recovery.getByRole('button', { name: 'Roll back safely', exact: true }).click();
  await recovery.getByRole('status').getByText(new RegExp(`Import recovery rolled-back · operation ${preRenameId}`)).waitFor();
  assert.equal(await readFile(join(vault, preRenamePath), 'utf8'), originalPreRename);
  assert.equal((await readdir(join(vault, 'notes'))).filter((name) => name.startsWith('.nodus-tmp-')).length, 0, 'Recovery removes only the recorded operation-owned atomic temp.');
  await stopWorker(worker, true);
  worker = null;

  // A failed second publication triggers the actual rollback. Kill after rollback writes have
  // restored bytes but before the terminal journal update; restart recovery must be idempotent.
  await writeFile(join(vault, 'notes/rollback-a.md'), '# old a\n', 'utf8');
  await writeFile(join(vault, 'notes/rollback-b.md'), '# old b\n', 'utf8');
  const rollbackSource = await createPackage('rollback-source', { 'notes/rollback-a.md': '# new a\n', 'notes/rollback-b.md': '# new b\n' });
  const rollbackPath = 'notes/rollback-a.md';
  const rollbackId = await triggerAndKill(page, rollbackSource, 'rollback', rollbackPath, 'rollback-files-restored-before-journal-update', 'replace');
  assert.equal(await readFile(join(vault, 'notes/rollback-a.md'), 'utf8'), '# old a\n');
  worker = await startWorker();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  recovery = page.getByRole('region', { name: 'Backup and restore', exact: true });
  await recovery.getByText(`${rollbackId} · publishing · 2 resources`, { exact: true }).waitFor();
  await recovery.getByRole('button', { name: 'Roll back safely', exact: true }).click();
  await recovery.getByRole('status').getByText(new RegExp(`Import recovery rolled-back · operation ${rollbackId}`)).waitFor();
  assert.equal(await readFile(join(vault, 'notes/rollback-a.md'), 'utf8'), '# old a\n');
  assert.equal(await readFile(join(vault, 'notes/rollback-b.md'), 'utf8'), '# old b\n');
  await stopWorker(worker, true);
  worker = null;

  // Simulate an external edit after a replacement crash; recovery must report ambiguity and preserve it.
  const ambiguousPath = 'notes/ambiguous.md';
  await writeFile(join(vault, ambiguousPath), '# original ambiguous\n', 'utf8');
  const ambiguousSource = await createPackage('ambiguous-source', { [ambiguousPath]: '# incoming ambiguous\n' });
  const ambiguousId = await triggerAndKill(page, ambiguousSource, 'replace-published', ambiguousPath, 'replacement-renamed-before-publication-journal', 'replace');
  const externalBytes = '# external edit after crash\n';
  await writeFile(join(vault, ambiguousPath), externalBytes, 'utf8');
  worker = await startWorker();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  recovery = page.getByRole('region', { name: 'Backup and restore', exact: true });
  await recovery.getByText(`${ambiguousId} · publishing · 1 resources`, { exact: true }).waitFor();
  await recovery.getByRole('button', { name: 'Roll back safely', exact: true }).click();
  await recovery.getByText(`${ambiguousId} · recovery-required · 1 resources`, { exact: true }).waitFor();
  await recovery.getByRole('alert').getByText(/recovery is incomplete/i).waitFor();
  assert.equal(await readFile(join(vault, ambiguousPath), 'utf8'), externalBytes);
  const ambiguousBackup = await readdir(join(vault, '.nodus-import-transactions', ambiguousId, 'backup'));
  assert.equal(ambiguousBackup.length, 1, 'Verified replacement backup remains available for manual recovery.');

  assert.deepEqual(pageErrors, [], 'The import/recovery UI must not produce uncaught browser errors.');

  console.log('Import restart/browser smoke passed: staging interruption/recovery, add interruption/retry, replacement crashes before and after rename, interruption after rollback writes, and ambiguous external edit preservation.');
} finally {
  await stopWorker(worker, true).catch(() => undefined);
  await browser?.close();
  uiServer?.httpServer?.closeAllConnections?.();
  uiServer?.httpServer?.closeIdleConnections?.();
  await uiServer?.close();
  await rm(root, { recursive: true, force: true });
}
