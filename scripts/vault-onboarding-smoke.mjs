import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function port() {
  const server = createServer();
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  assert(address && typeof address === 'object');
  await new Promise((done, fail) => server.close((error) => error ? fail(error) : done()));
  return address.port;
}

async function start(portNumber, env) {
  const child = spawn(process.execPath, [join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', 'ui/vite.config.ts', '--host', '127.0.0.1', '--port', String(portNumber)], {
    cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (value) => { logs = `${logs}${value}`.slice(-8000); });
  child.stderr.on('data', (value) => { logs = `${logs}${value}`.slice(-8000); });
  for (let index = 0; index < 100; index += 1) {
    if (child.exitCode !== null) throw new Error(`Vite exited before startup. ${logs}`);
    if (logs.replace(/\x1b\[[0-9;]*m/g, '').includes(`http://127.0.0.1:${portNumber}/`)) return child;
    await delay(100);
  }
  child.kill('SIGTERM');
  throw new Error(`Timed out waiting for Vite. ${logs}`);
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((done) => child.once('close', done));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(5000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

const tempRoot = await mkdtemp(join(tmpdir(), 'nodus-vault-onboarding-'));
const preferenceRoot = join(tempRoot, 'user-config');
const selectedVault = join(tempRoot, 'existing-vault');
await mkdir(selectedVault, { recursive: true });
const portNumber = await port();
const env = { ...process.env, APPDATA: preferenceRoot, XDG_CONFIG_HOME: preferenceRoot, HOME: preferenceRoot, NODUS_VAULT_ROOTS: tempRoot, NODUS_ALLOWED_ORIGINS: `http://127.0.0.1:${portNumber}` };
delete env.NODUS_VAULT;
const browser = await chromium.launch({ headless: true });
let child;
let page;
try {
  child = await start(portNumber, env);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  page = await context.newPage();
  await page.goto(`http://127.0.0.1:${portNumber}/app`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Choose your Nodus vault' }).waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Onboarding overflows a narrow viewport');
  const pathField = page.getByRole('textbox', { name: 'Folder path' });
  await pathField.fill(join(tempRoot, 'missing-vault'));
  await pathField.press('Enter');
  await page.getByRole('alert').getByText(/does not exist/i).waitFor({ state: 'visible' });
  await page.getByRole('heading', { name: 'Choose your Nodus vault' }).waitFor({ state: 'visible' });
  await pathField.fill(selectedVault);
  await pathField.press('Enter');
  await page.getByRole('button', { name: /Vault menu: existing-vault/ }).waitFor({ state: 'visible' });
  const preferenceFile = process.platform === 'darwin'
    ? join(preferenceRoot, 'Library', 'Application Support', 'Nodus', 'preferences.json')
    : join(preferenceRoot, process.platform === 'linux' ? 'nodus' : 'Nodus', 'preferences.json');
  const preference = JSON.parse(await readFile(preferenceFile, 'utf8'));
  assert.equal(preference.lastVaultPath, await realpath(selectedVault));

  await stop(child);
  child = await start(portNumber, env);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Vault menu: existing-vault/ }).waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('heading', { name: 'Choose your Nodus vault' }).count(), 0, 'Saved selection did not restore after server restart');
  await context.close();
  console.log('Vault onboarding smoke passed: first-run choice, keyboard folder selection, narrow viewport, preference persistence, and restart recovery.');
} finally {
  if (child) await stop(child);
  await browser.close();
  await rm(tempRoot, { recursive: true, force: true });
}
