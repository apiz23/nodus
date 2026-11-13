import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(join(tmpdir(), 'nodus-conflict-ui-'));
const vault = join(temp, 'vault');
const preferences = join(temp, 'preferences.json');
const nodeMajor = Number(process.versions.node.split('.')[0]);
assert(nodeMajor >= 24, 'Conflict UI smoke requires Node 24 or newer');

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve Vite port');
  await new Promise((resolveClose) => server.close(resolveClose));
  return address.port;
}

const port = await freePort();
const vite = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--config', 'ui/vite.config.ts', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: root,
  env: { ...process.env, NODUS_VAULT: vault, NODUS_PREFERENCES_PATH: preferences, NODUS_ALLOWED_ORIGINS: `http://127.0.0.1:${port}` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
vite.stdout.setEncoding('utf8'); vite.stderr.setEncoding('utf8');
vite.stdout.on('data', (chunk) => { logs = `${logs}${chunk}`.slice(-10_000); });
vite.stderr.on('data', (chunk) => { logs = `${logs}${chunk}`.slice(-10_000); });

const hash = (value) => createHash('sha256').update(value).digest('hex');
const id = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-10-25T12:00:00Z';
const local = `---\ntitle: Conflict note\nnodus:\n  version: 1\n  id: ${id}\n  createdAt: 2026-10-25T12:00:00Z\n  updatedAt: 2026-10-25T12:00:00Z\n---\nLocal exact version\n`;
const remote = `---\ntitle: Conflict note\nnodus:\n  version: 1\n  id: ${id}\n  createdAt: 2026-10-25T12:00:00Z\n  updatedAt: 2026-10-25T12:01:00Z\n---\nIncoming exact version\n`;
const conflictId = 'dGVzdC1jb25mbGljdA';
const summary = {
  schemaVersion: 1, conflictId, vaultId: 'vault-test', epoch: 1,
  document: { kind: 'note', id }, status: 'open', resolutionDecisionId: null,
  applyStatus: 'pending', type: 'content-divergence', base: null,
  local: { path: 'notes/conflict.md', hash: hash(local) },
  remote: { version: 2, path: 'notes/conflict.md', hash: hash(remote), operation: 'update' },
  target: null, copy: null, mergedCopyCount: 0, hasApplyIntent: true, hasBlockedApply: true,
  createdAt: '2026-10-25T12:01:00Z', updatedAt: '2026-10-25T12:01:00Z', diagnostics: [],
};
const inspection = {
  summary,
  local: { id, path: 'notes/conflict.md', hash: hash(local), content: local },
  remote: { id, path: 'notes/conflict.md', version: 2, hash: hash(remote), operation: 'update', timestamp: '2026-10-25T12:01:00Z', content: remote, verified: true },
  copy: null, diagnostics: [],
};
let executeCount = 0;
let decisionNumber = 0;
let lastIntent = null;
let historyEntries = [];
let emptyConflicts = false;
let staleNextPrepare = false;
let needsRecoveryNextExecute = false;
const mergedId = '22222222-2222-4222-8222-222222222222';
let releaseExecute;
const executeGate = new Promise((resolveGate) => { releaseExecute = resolveGate; });

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(6_000);
  page.on('pageerror', (error) => console.error('Browser error:', error));
  page.on('requestfailed', (request) => console.error('Browser request failed:', request.url(), request.failure()?.errorText));
  await page.route('**/api/preferences/getting-started', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ completed: true }) }));
  await page.route(`**/api/notes/${mergedId}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ note: { id: mergedId, title: 'Reviewed merge (Merged)', path: `notes/reviewed-${mergedId.slice(0, 8)}.md`, updatedAt: NOW, createdAt: NOW, aliases: [], icon: null, body: 'Reviewed merged text', tags: [], metadataKeys: [], contentHash: hash(remote) } }) }));
  await page.route('**/api/sync/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/connection')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ connected: true, vaultId: 'vault-test', epoch: 1 }) });
    if (path.endsWith('/conflicts') && !path.endsWith('/history')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ conflicts: emptyConflicts ? [] : [summary], next: null }) });
    if (path.endsWith('/history')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ decisions: historyEntries, next: null }) });
    if (path === `/api/sync/conflicts/${conflictId}`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(inspection) });
    if (path.endsWith('/resolutions/remote-preview')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id, path: 'notes/conflict.md', content: remote, contentHash: hash(remote) }) });
    if (path.endsWith('/resolutions/merged-preview')) {
      const content = `---\ntitle: Reviewed merge (Merged)\nnodus:\n  version: 1\n  id: ${mergedId}\n  createdAt: 2026-10-25T12:00:00Z\n  updatedAt: 2026-10-25T12:00:00Z\n---\nReviewed merged text\n`;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: mergedId, path: `notes/reviewed-${mergedId.slice(0, 8)}.md`, content, contentHash: hash(content) }) });
    }
    if (path.endsWith('/resolutions/prepare')) {
      if (staleNextPrepare) {
        staleNextPrepare = false;
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'STALE_REVIEW', message: 'The exact reviewed bytes changed.' } }) });
      }
      decisionNumber += 1;
      lastIntent = route.request().postDataJSON().intent;
      historyEntries = [{ decisionId: lastIntent.decisionId, conflictId, action: lastIntent.action, status: 'prepared', revision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null, result: null, diagnostic: null }, ...historyEntries];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ vaultId: 'vault-test', epoch: 1, intent: route.request().postDataJSON().intent, status: 'prepared', revision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null, result: null, diagnostic: null }) });
    }
    if (path.endsWith('/execute')) {
      executeCount += 1;
      if (executeCount === 1) await executeGate;
      const action = lastIntent?.action;
      const entry = historyEntries.find((item) => item.decisionId === lastIntent?.decisionId);
      if (needsRecoveryNextExecute) {
        needsRecoveryNextExecute = false;
        if (entry) Object.assign(entry, { status: 'needs-recovery', revision: 1, updatedAt: new Date().toISOString(), diagnostic: 'Injected ambiguous result for recovery review.' });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ vaultId: 'vault-test', epoch: 1, intent: lastIntent, status: 'needs-recovery', revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null, result: null, diagnostic: 'Injected ambiguous result for recovery review.' }) });
      }
      const result = action === 'save-merged-copy'
        ? { id: lastIntent.target.id, path: lastIntent.target.path, contentHash: lastIntent.target.contentHash, relayVersion: null }
        : action === 'keep-remote'
          ? { id, path: 'notes/conflict.md', contentHash: hash(remote), relayVersion: 3 }
          : { id, path: 'notes/conflict.md', contentHash: hash(local), relayVersion: 3 };
      if (entry) Object.assign(entry, { status: 'completed', revision: 2, updatedAt: new Date().toISOString(), completedAt: new Date().toISOString(), result, diagnostic: null });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ vaultId: 'vault-test', epoch: 1, intent: lastIntent, status: 'completed', revision: 2, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: new Date().toISOString(), result, diagnostic: null }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });

  const ready = new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error(`Vite did not start. ${logs}`)), 20_000);
    if (logs.includes(`http://127.0.0.1:${port}/`)) { clearTimeout(timer); resolveReady(); return; }
    vite.stdout.on('data', (chunk) => { if (String(chunk).includes(`http://127.0.0.1:${port}/`)) { clearTimeout(timer); resolveReady(); } });
  });
  await ready;
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.getByRole('link', { name: 'Open workspace', exact: true }).click();
  await delay(1_000);
  console.log('Workspace view:', (await page.locator('body').innerText()).slice(0, 1500));
  const nav = page.getByRole('button', { name: 'Conflicts', exact: true });
  await nav.focus(); await nav.press('Enter');
  await page.getByRole('heading', { name: 'Conflicts', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).focus();
  await page.getByRole('button', { name: 'Expand sidebar', exact: true }).press('Enter');
  await page.getByRole('button', { name: /note · 11111111/ }).click();
  await page.getByLabel('Local version exact content').getByText('Local exact version').waitFor();
  await page.getByLabel('Incoming version exact content').getByText('Incoming exact version').waitFor();

  await page.getByRole('button', { name: 'Keep local', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Keep local', exact: true });
  await confirm.getByText(/exact local version will be retained/).waitFor();
  assert.equal(executeCount, 0, 'Opening confirmation does not execute a decision');
  await confirm.getByRole('button', { name: 'Confirm and execute', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Preparing and executing keep local' }).waitFor();
  await delay(120);
  assert.equal(decisionNumber, 1, 'One reviewed decision was prepared');
  assert.equal(executeCount, 1, 'One execution is in flight');
  releaseExecute();
  await page.getByRole('status').filter({ hasText: 'Keep local completed.' }).waitFor();

  staleNextPrepare = true;
  await page.getByRole('button', { name: 'Keep incoming', exact: true }).click();
  const keepRemote = page.getByRole('dialog', { name: 'Keep incoming', exact: true });
  assert.equal(executeCount, 1, 'Keep incoming also waits for explicit confirmation');
  await keepRemote.getByRole('button', { name: 'Confirm and execute', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'reviewed versions changed' }).waitFor();
  assert.equal(executeCount, 1, 'A stale review is rejected before execution');

  needsRecoveryNextExecute = true;
  await page.getByRole('button', { name: 'Keep incoming', exact: true }).click();
  await page.getByRole('dialog', { name: 'Keep incoming', exact: true }).getByRole('button', { name: 'Confirm and execute', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Decision status: needs recovery.' }).waitFor();
  await page.getByRole('button', { name: 'Retry safely', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'The saved resolution completed.' }).waitFor();
  assert.equal(lastIntent.action, 'keep-remote', 'Keep incoming prepares the authoritative keep-remote action');

  await page.getByLabel('Merged document content (explicitly reviewed; no automatic merge)').fill('Reviewed merged text');
  await page.getByRole('button', { name: 'Review merged copy', exact: true }).click();
  const merged = page.getByRole('dialog', { name: 'Create merged copy', exact: true });
  await merged.getByText(/Reviewed output/).waitFor();
  await merged.getByRole('button', { name: 'Confirm and execute', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Merged copy saved at' }).waitFor();
  assert.equal(lastIntent.action, 'save-merged-copy', 'Merged review prepares a new-document action');
  assert.match(await page.locator('body').innerText(), /original conflict remains unresolved/);
  assert.equal(historyEntries.find((entry) => entry.decisionId === lastIntent.decisionId)?.status, 'completed');
  await page.getByRole('button', { name: 'Open merged copy', exact: true }).click();
  await page.getByRole('textbox', { name: /note title/i }).waitFor();
  assert.match(await page.locator('body').innerText(), /Reviewed merge \(Merged\)/);
  await page.getByRole('button', { name: 'Conflicts', exact: true }).focus();
  await page.getByRole('button', { name: 'Conflicts', exact: true }).press('Enter');
  await page.getByRole('heading', { name: 'Conflicts', exact: true }).waitFor();
  emptyConflicts = true;
  await page.getByRole('button', { name: 'Refresh local conflict list', exact: true }).click();
  await page.getByText(/No recorded conflicts in this vault/).waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  const main = page.locator('main');
  const dimensions = await main.evaluate((element) => ({ width: element.clientWidth, scroll: element.scrollWidth }));
  assert(dimensions.scroll <= dimensions.width + 1, 'Conflict view fits a narrow viewport');
  console.log('Conflict UI smoke passed: conflict list and empty state, exact comparison, keyboard navigation, confirmation for all three actions, stale review rejection, needs-recovery retry, merged-copy history/navigation, duplicate-submit guard, and narrow viewport.');
} finally {
  await browser.close();
  if (vite.exitCode === null && vite.signalCode === null) { vite.kill('SIGTERM'); await Promise.race([new Promise((resolveExit) => vite.once('close', resolveExit)), delay(5_000)]); }
  await rm(temp, { recursive: true, force: true });
}
