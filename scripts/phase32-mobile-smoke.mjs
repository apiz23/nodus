import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = await mkdtemp(join(tmpdir(), 'nodus-phase32-mobile-'));
const vault = join(root, 'vault');
await mkdir(vault);
process.env.NODUS_VAULT = vault;
process.env.NODUS_VAULT_ROOTS = root;
let server;
let browser;
try {
  server = await createServer({ configFile: 'ui/vite.config.ts', server: { port: 0, strictPort: false } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  process.env.NODUS_ALLOWED_ORIGINS = base;
  const response = await fetch(`${base}/api/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Mobile review' }) });
  assert(response.ok);
  browser = await chromium.launch({ headless: true });
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
  for (const width of [320, 375, 768, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 800 }, reducedMotion: 'reduce' });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${base}/app`);
    const navigation = page.getByRole('dialog', { name: 'Workspace navigation' });
    const mobile = width < 768;
    if (mobile) {
      const open = page.getByRole('button', { name: 'Open navigation' });
      await open.waitFor();
      await open.click();
      await navigation.waitFor();
      await page.getByRole('button', { name: 'Filter notes', exact: true }).click();
      await page.getByLabel('Filter value').waitFor();
      await page.keyboard.press('Escape');
      await page.getByLabel('Filter value').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Filter notes') === true);
      assert(await navigation.isVisible(), `Escape closed mobile navigation instead of only the filter at ${width}px`);
      await page.keyboard.press('Escape');
      await navigation.waitFor({ state: 'hidden' });
      assert.equal(await open.evaluate((el) => document.activeElement === el), true, `navigation focus not restored at ${width}px`);
    } else {
      await page.getByRole('searchbox', { name: 'Search notes', exact: true }).waitFor();
    }
    if (!mobile) {
      const search = page.getByRole('searchbox', { name: 'Search notes', exact: true });
      await search.focus();
      await page.keyboard.press(`${modifier}+k`);
      const palette = page.getByRole('dialog', { name: 'Command palette' });
      await palette.waitFor();
      await page.keyboard.press('Escape');
      await palette.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search notes', null, { timeout: 3000 });
    }
    const runCommand = async (name) => {
      await page.keyboard.press(`${modifier}+k`);
      const palette = page.getByRole('dialog', { name: 'Command palette' });
      await palette.waitFor();
      await palette.getByRole('combobox').fill(name);
      await palette.getByRole('option', { name, exact: true }).click();
      await palette.waitFor({ state: 'hidden' });
    };
    if (!mobile) {
      await runCommand('Enter focus mode');
      await page.getByText('Focus mode is on — the sidebar is hidden.').waitFor();
      if (width === 1280) {
        // A desktop focus session can cross the mobile breakpoint after resize.
        await page.setViewportSize({ width: 375, height: 800 });
        await runCommand('Exit focus mode');
        await page.getByRole('button', { name: 'Open navigation' }).waitFor();
        await runCommand('Search filters');
        await page.getByLabel('Filter value').waitFor();
        await page.keyboard.press('Escape');
        await page.getByLabel('Filter value').waitFor({ state: 'hidden' });
        await page.keyboard.press('Escape');
        await page.getByRole('dialog', { name: 'Workspace navigation' }).waitFor({ state: 'hidden' });
        await page.setViewportSize({ width: 1280, height: 800 });
      } else {
        await runCommand('Exit focus mode');
      }
      await page.getByRole('searchbox', { name: 'Search notes', exact: true }).waitFor();
    }
    await runCommand('Saved searches');
    await page.getByText('Saved searches are stored in this browser for this vault.').waitFor();
    await page.keyboard.press('Escape');
    await page.getByText('Saved searches are stored in this browser for this vault.').waitFor({ state: 'hidden' });
    if (mobile) {
      assert(await navigation.isVisible(), `Saved searches Escape closed navigation at ${width}px`);
      await page.keyboard.press('Escape');
      await navigation.waitFor({ state: 'hidden' });
      const open = page.getByRole('button', { name: 'Open navigation' });
      assert.equal(await open.evaluate((el) => document.activeElement === el), true, `saved-search drawer focus not restored at ${width}px`);

      // Palette-driven search opens the mobile navigation programmatically.
      // Closing the nested popover and then the drawer must return focus to its
      // actual mobile trigger, not leave focus on the off-screen search control.
      await runCommand('Search filters');
      await navigation.waitFor();
      await page.getByLabel('Filter value').waitFor();
      await page.keyboard.press('Escape');
      await page.getByLabel('Filter value').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label')?.startsWith('Filter notes') === true);
      await page.keyboard.press('Escape');
      await navigation.waitFor({ state: 'hidden' });
      assert.equal(await open.evaluate((el) => document.activeElement === el), true, `command-opened navigation focus not restored at ${width}px`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `horizontal overflow at ${width}px`);
    assert.deepEqual(pageErrors, [], `browser errors at ${width}px`);
    await page.close();
    console.log(`Phase 32 responsive navigation passed at ${width}px`);
  }
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
