import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = await mkdtemp(join(tmpdir(), 'nodus-connections-sheet-'));
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
  const created = await fetch(`${base}/api/notes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Connections smoke note' }),
  });
  assert.equal(created.status, 201, 'smoke note creation succeeds');
  browser = await chromium.launch({ headless: true });

  for (const width of [320, 375, 768, 1280]) {
    for (const colorScheme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 860 }, colorScheme, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.goto(`${base}/app`);
      const trigger = page.getByRole('button', { name: 'Open note connections' });
      await trigger.waitFor();
      await trigger.click();
      const sheet = page.getByRole('dialog', { name: 'Connections' });
      await sheet.waitFor();
      await sheet.getByText('Links and related notes for Connections smoke note. This information is separate from your Markdown.').waitFor();
      await sheet.getByRole('region', { name: 'Linked mentions' }).waitFor();
      await sheet.getByRole('region', { name: 'Outgoing links' }).waitFor();
      await sheet.getByRole('region', { name: 'Incoming database relations' }).waitFor();
      await sheet.getByRole('region', { name: 'Related notes' }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px ${colorScheme}: sheet does not cause horizontal overflow`);
      await page.keyboard.press('Escape');
      await sheet.waitFor({ state: 'hidden' });
      assert.equal(await trigger.evaluate((element) => document.activeElement === element), true, `${width}px ${colorScheme}: focus returns to the trigger`);
      assert.deepEqual(pageErrors, [], `${width}px ${colorScheme}: no uncaught browser errors`);
      await context.close();
      console.log(`Connections sheet passed at ${width}px (${colorScheme})`);
    }
  }
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
