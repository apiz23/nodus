import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
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

function startVite(vaultPath, port) {
  const viteEntry = join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [viteEntry, '--config', 'ui/vite.config.ts', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODUS_VAULT: vaultPath,
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
      if (output.includes(`http://127.0.0.1:${port}/`)) finish(resolveReady);
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

async function main() {
  let tempRoot;
  let started;
  let browser;
  let context;

  try {
    tempRoot = await mkdtemp(join(tmpdir(), 'nodus-browser-smoke-'));
    const vaultPath = join(tempRoot, 'vault');
    await mkdir(vaultPath, { recursive: true });
    const expectedVaultPath = await realpath(vaultPath);
    const port = await reserveLoopbackPort();
    const baseUrl = `http://127.0.0.1:${port}`;

    started = startVite(vaultPath, port);
    await waitForVite(started, port);

    // Do not open a browser until the child Vite process has announced its listener,
    // and prove that this instance points at the fresh temporary vault.
    const statusResponse = await fetch(`${baseUrl}/api/status`);
    assert.equal(statusResponse.status, 200, 'Dedicated local API did not start');
    const status = await statusResponse.json();
    assert.equal(status.vault.path, expectedVaultPath, 'Vite instance did not use the isolated temporary vault');
    assert.deepEqual(status.counts, { notes: 0, databases: 0, issues: 0 }, 'The new test vault was not empty');

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const browserErrors = [];
    const apiFailures = [];
    page.on('pageerror', (error) => browserErrors.push(`uncaught: ${error.name}: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
    });
    page.on('requestfailed', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/')) {
        const errorText = request.failure()?.errorText ?? 'failed';
        // A document reload can cancel an in-flight, nonessential backlinks read.
        if (errorText !== 'net::ERR_ABORTED') {
          apiFailures.push(`${request.method()} ${new URL(request.url()).pathname}: ${errorText}`);
        }
      }
    });
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/api/') && response.status() >= 400) {
        apiFailures.push(`${response.request().method()} ${url.pathname}: HTTP ${response.status()}`);
      }
    });

    const navigation = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    assert.equal(navigation?.status(), 200, 'Nodus UI did not load');
    await page.getByRole('heading', { name: 'Open a note to begin' }).waitFor({ state: 'visible' });
    await page.getByText('No pages yet', { exact: true }).waitFor({ state: 'visible' });

    const createPage = page.getByRole('button', { name: 'New page' }).first();
    await createPage.click();
    const title = page.getByRole('textbox', { name: 'Note title' });
    const body = page.getByRole('textbox', { name: 'Markdown body' });
    await title.waitFor({ state: 'visible' });
    await title.fill('Browser smoke first note');
    await body.fill('Real browser save survives reload.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Saved', { exact: true }).waitFor({ state: 'visible' });

    const firstNote = await titleAndBody(title, body);
    const notesResponse = await fetch(`${baseUrl}/api/notes`);
    assert.equal(notesResponse.status, 200, 'Note listing API failed after save');
    const noteList = await notesResponse.json();
    const firstSummary = noteList.notes.find((note) => note.title === firstNote.title);
    assert(firstSummary, 'Saved note did not appear through the local API');
    assert(firstSummary.path.startsWith('notes/'), 'New note was not stored under the notes directory');
    const firstAbsolutePath = resolve(expectedVaultPath, ...firstSummary.path.split('/'));
    assert(firstAbsolutePath.startsWith(`${expectedVaultPath}${sep}`), 'API note path escaped the temporary vault');
    const firstFileContents = await readFile(firstAbsolutePath, 'utf8');
    assert(firstFileContents.includes(firstNote.body), 'Saved Markdown file did not contain the edited body');

    const createSecondResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/notes' &&
      response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'New page' }).first().click();
    assert.equal((await createSecondResponse).status(), 201, 'Second note creation API request failed');
    await page.waitForFunction(
      () => document.querySelector('#note-title')?.value === 'Untitled note',
    );
    await title.fill('Browser smoke second note');
    await body.fill('Second note for navigation.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Saved', { exact: true }).waitFor({ state: 'visible' });

    await page.getByRole('treeitem', { name: 'Browser smoke first note' }).click();
    await page.waitForFunction(
      (expectedTitle) => document.querySelector('#note-title')?.value === expectedTitle,
      firstNote.title,
    );
    assert.equal((await body.textContent())?.trim(), firstNote.body, 'Selecting a note did not restore its body');
    await page.reload({ waitUntil: 'domcontentloaded' });
    const reloadedNote = page.getByRole('treeitem', { name: firstNote.title });
    await reloadedNote.waitFor({ state: 'visible' });
    await reloadedNote.click();
    await page.getByRole('textbox', { name: 'Note title' }).waitFor({ state: 'visible' });
    await page.waitForFunction(
      (expectedTitle) => document.querySelector('#note-title')?.value === expectedTitle,
      firstNote.title,
    );
    assert.equal(
      (await page.getByRole('textbox', { name: 'Markdown body' }).textContent())?.trim(),
      firstNote.body,
      'Reload did not restore the saved Markdown body',
    );

    assert.deepEqual(apiFailures, [], 'Essential local API requests failed');
    assert.deepEqual(browserErrors, [], 'Browser reported uncaught or console errors');
    console.log('Browser smoke passed: startup, empty-vault state, two-note navigation, save, API/filesystem persistence, and reload.');
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    if (started !== undefined) await stopVite(started);
    if (tempRoot !== undefined) await rm(tempRoot, { recursive: true, force: true });
  }
}

async function titleAndBody(title, body) {
  return {
    title: await title.inputValue(),
    body: (await body.textContent())?.trim() ?? '',
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
