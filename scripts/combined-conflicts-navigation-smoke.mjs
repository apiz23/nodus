import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = await mkdtemp(join(tmpdir(), 'nodus-combined-nav-'));
const vault = join(root, 'vault');
await mkdir(vault);
process.env.NODUS_VAULT = vault;
process.env.NODUS_VAULT_ROOTS = root;
let server;
let browser;
try {
  server = await createServer({ configFile: 'ui/vite.config.ts', server: { port: 0, strictPort: false } });
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  process.env.NODUS_ALLOWED_ORIGINS = base;
  const created = await fetch(base + '/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Combined navigation acceptance' }),
  });
  assert(created.ok, 'workspace API creates its test note');

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 }, reducedMotion: 'reduce' });
  const screenshotRoot = join(process.cwd(), 'acceptance-screenshots');
  await mkdir(screenshotRoot, { recursive: true });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

  async function runCommand(title) {
    await page.keyboard.press(modifier + '+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.waitFor();
    await palette.getByRole('combobox').fill(title);
    await palette.getByRole('option', { name: title, exact: true }).click();
    await palette.waitFor({ state: 'hidden' });
  }

  async function checkNoOverflow(label) {
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ': horizontal overflow');
  }

  await page.goto(base + '/app');
  const gettingStarted = page.getByRole('button', { name: 'Got it', exact: true });
  await gettingStarted.waitFor();
  await gettingStarted.click();
  await gettingStarted.waitFor({ state: 'detached' });
  const allNotes = page.getByRole('button', { name: 'All notes', exact: true });
  await allNotes.focus();
  await page.keyboard.press('Tab');
  const conflictsNav = page.getByRole('button', { name: 'Conflicts', exact: true });
  assert.equal(await conflictsNav.evaluate((element) => element === document.activeElement && element.matches(':focus-visible')), true, 'keyboard traversal reaches Conflicts with visible focus');
  assert.notEqual(await conflictsNav.evaluate((element) => getComputedStyle(element).boxShadow), 'none', 'Conflicts navigation focus ring is visible');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Conflicts', exact: true }).waitFor();
  await page.getByText('No conflicts have been recorded on this device.').waitFor();
  await page.screenshot({ path: join(screenshotRoot, 'workspace-conflicts-1280-light.png') });

  await runCommand('Enter focus mode');
  await page.getByText('Focus mode is on — the sidebar is hidden.').waitFor();
  await page.getByRole('button', { name: 'Conflicts', exact: true }).waitFor({ state: 'detached' });
  await runCommand('Conflicts');
  await page.getByRole('heading', { name: 'Conflicts', exact: true }).waitFor();
  await runCommand('Exit focus mode');
  await page.getByRole('button', { name: 'Conflicts', exact: true }).waitFor();

  await runCommand('Search filters');
  await page.getByLabel('Filter value').waitFor();
  await page.keyboard.press('Escape');
  await page.getByLabel('Filter value').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Filter notes') === true);

  await runCommand('Saved searches');
  await page.getByText('Saved searches are stored in this browser for this vault.').waitFor();
  await page.keyboard.press('Escape');
  await page.getByText('Saved searches are stored in this browser for this vault.').waitFor({ state: 'hidden' });

  async function setTheme(theme) {
    const current = await page.locator('html').getAttribute('data-theme');
    if (current !== theme) await runCommand('Use ' + theme + ' theme');
    const expectedColor = theme === 'dark' ? 'rgb(232, 229, 223)' : 'rgb(43, 42, 38)';
    await page.waitForFunction(({ theme, expectedColor }) => {
      const heading = document.querySelector('#conflicts-title');
      return document.documentElement.dataset.theme === theme &&
        document.documentElement.classList.contains('dark') === (theme === 'dark') &&
        heading !== null && getComputedStyle(heading).color === expectedColor;
    }, { theme, expectedColor });
  }

  for (const width of [320, 375, 768, 1280]) {
    for (const theme of ['light', 'dark']) {
      await setTheme(theme);
      await page.setViewportSize({ width, height: 850 });
      if (width < 768) {
        const open = page.getByRole('button', { name: 'Open navigation' });
        await open.click();
        const navigation = page.getByRole('dialog', { name: 'Workspace navigation' });
        await navigation.waitFor();
        await page.screenshot({ path: join(screenshotRoot, 'workspace-navigation-' + width + '-' + theme + '.png') });
        assert.equal(await navigation.getByRole('button', { name: 'Conflicts', exact: true }).count(), 1);
        await navigation.getByRole('button', { name: 'Conflicts', exact: true }).click();
        await navigation.waitFor({ state: 'hidden' });

        await runCommand('Conflicts');
        await page.getByRole('heading', { name: 'Conflicts', exact: true }).waitFor();
        await runCommand('Search filters');
        await page.getByRole('dialog', { name: 'Workspace navigation' }).waitFor();
        await page.getByLabel('Filter value').waitFor();
        await page.keyboard.press('Escape');
        await page.getByLabel('Filter value').waitFor({ state: 'hidden' });
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Filter notes') === true);
        await page.keyboard.press('Escape');
        await page.getByRole('dialog', { name: 'Workspace navigation' }).waitFor({ state: 'hidden' });
        assert.equal(await open.evaluate((element) => element === document.activeElement), true, 'mobile navigation restores trigger focus');

        await runCommand('Saved searches');
        await page.getByRole('dialog', { name: 'Workspace navigation' }).waitFor();
        await page.getByText('Saved searches are stored in this browser for this vault.').waitFor();
        await page.keyboard.press('Escape');
        await page.getByText('Saved searches are stored in this browser for this vault.').waitFor({ state: 'hidden' });
        await page.keyboard.press('Escape');
        await page.getByRole('dialog', { name: 'Workspace navigation' }).waitFor({ state: 'hidden' });
      }
      await checkNoOverflow(width + 'px/' + theme);
      await page.screenshot({ path: join(screenshotRoot, 'workspace-conflicts-' + width + '-' + theme + '.png') });
    }
  }

  await page.setViewportSize({ width: 1280, height: 850 });
  await setTheme('light');
  await runCommand('Enter focus mode');
  await page.setViewportSize({ width: 375, height: 850 });
  await runCommand('Exit focus mode');
  await page.getByRole('button', { name: 'Open navigation' }).waitFor();
  await runCommand('Search filters');
  await page.getByRole('dialog', { name: 'Workspace navigation' }).waitFor();
  await page.getByLabel('Filter value').waitFor();
  await page.keyboard.press('Escape');
  await page.getByLabel('Filter value').waitFor({ state: 'hidden' });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog', { name: 'Workspace navigation' }).waitFor({ state: 'hidden' });
  await checkNoOverflow('desktop-to-mobile focus recovery');
  assert.deepEqual(pageErrors, []);
  console.log('Combined Conflicts/navigation smoke passed: sidebar and palette Conflicts navigation; focus enter/exit on Conflicts; focus-to-mobile recovery; search filters and saved searches; nested Escape and focus restoration; light/dark themes; 320/375/768/1280px; no page errors or horizontal overflow.');
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
