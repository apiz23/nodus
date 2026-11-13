import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const temp = await mkdtemp(join(tmpdir(), 'nodus-landing-test-'));
const artifacts = await mkdtemp(join(tmpdir(), 'nodus-landing-visual-'));
const reservation = createServer();
await new Promise((done) => reservation.listen(0, '127.0.0.1', done));
const port = reservation.address().port;
await new Promise((done) => reservation.close(done));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--config', 'ui/vite.config.ts', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: root, env: { ...process.env, NODUS_VAULT: join(temp, 'vault'), NODUS_PREFERENCES_PATH: join(temp, 'preferences.json'), NODUS_ALLOWED_ORIGINS: base }, stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
server.stdout.on('data', (value) => { logs += value; });
server.stderr.on('data', (value) => { logs += value; });
const browser = await chromium.launch({ headless: true });
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    if (attempt > 100) throw new Error(`Preview startup failed: ${logs}`);
    await delay(200);
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  assert.match(await page.getByRole('heading', { level: 1 }).innerText(), /Your local workspace\s+for notes and projects/);
  const footer = page.getByRole('contentinfo');
  await footer.getByRole('heading', { name: 'Make space for what’s next.' }).waitFor();
  assert.equal(await footer.getByRole('link', { name: 'Open your workspace' }).getAttribute('href'), '/app');
  for (const [label, href] of [['Connected notes', '#features'], ['Flexible databases', '#databases'], ['Your local files', '#philosophy'], ['Workspace', '/app'], ['GitHub', 'https://github.com/apiz23/nodus']]) {
    assert.equal(await footer.getByRole('link', { name: new RegExp(label) }).getAttribute('href'), href, `Footer ${label} link has a valid destination`);
  }
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to content', exact: true });
  assert(await skipLink.evaluate((element) => element === document.activeElement), 'The skip link is the first keyboard stop');
  assert.notEqual(await skipLink.evaluate((element) => getComputedStyle(element).boxShadow), 'none', 'Keyboard focus has a visible ring');
  const heroAction = page.getByRole('link', { name: 'Start writing', exact: true });
  const footerAction = footer.getByRole('link', { name: 'Open your workspace' });
  assert.equal(await heroAction.evaluate((element) => element.getBoundingClientRect().height), await footerAction.evaluate((element) => element.getBoundingClientRect().height), 'Primary actions share a height');
  await footerAction.focus();
  assert.notEqual(await footerAction.evaluate((element) => getComputedStyle(element).boxShadow), 'none', 'Inverse footer action keeps a visible focus ring');
  await heroAction.focus();
  assert(await heroAction.evaluate((element) => element === document.activeElement));
  for (const width of [1440, 1024, 768, 390, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      const nextLabel = theme === 'dark' ? 'Switch to dark theme' : 'Switch to light theme';
      const toggle = page.getByRole('button', { name: nextLabel });
      if (await toggle.count()) await toggle.click();
      for (const visual of await page.locator('img:visible').all()) { await visual.scrollIntoViewIfNeeded(); await visual.evaluate((image) => image.decode()); }
      await page.locator('#philosophy').scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollTo(0, 0));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}/${theme}: horizontal overflow`);
      const image = page.locator('figure img:visible').first();
      assert(await image.evaluate((element) => element.complete && element.naturalWidth > 0), `${width}/${theme}: missing product image`);
      await page.screenshot({ path: join(artifacts, `${width}-${theme}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const menuTrigger = page.locator('button[aria-label="Open menu"]');
  await menuTrigger.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Databases', exact: true }).waitFor();
  assert.equal(await menuTrigger.getAttribute('aria-expanded'), 'true', 'The mobile menu announces its expanded state');
  await page.keyboard.press('Escape');
  assert.equal(await menuTrigger.getAttribute('aria-expanded'), 'false', 'The mobile menu announces its collapsed state');
  assert(await menuTrigger.evaluate((element) => element === document.activeElement));
  await page.getByRole('link', { name: 'Start writing', exact: true }).click();
  await page.waitForURL('**/app');
  await page.getByRole('button', { name: 'New note', exact: true }).waitFor();
  await page.screenshot({ path: join(artifacts, 'workspace-mobile.png') });
  const motion = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  motion.on('pageerror', (error) => errors.push(error.message));
  await motion.goto(base, { waitUntil: 'networkidle' });
  await motion.locator('.nodus-logo-splash').waitFor({ state: 'hidden' });
  const statement = motion.locator('.nodus-ink-statement');
  const bounds = await statement.boundingBox();
  const radii = [];
  for (const progress of [0, 0.3, 1, 0.3]) {
    await motion.evaluate(({ top, height, progress }) => window.scrollTo(0, top + progress * (height - innerHeight)), { top: bounds.y, height: bounds.height, progress });
    await motion.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    radii.push(await statement.evaluate((element) => parseFloat(element.style.getPropertyValue('--ink-radius'))));
    await motion.screenshot({ path: join(artifacts, `scroll-${progress}-${radii.length}.png`) });
  }
  assert(radii[0] < radii[1] && radii[1] < radii[2] && radii[3] < radii[2], 'Ink reveal follows scrolling in both directions');
  assert((await motion.locator('.landing-page > header').boundingBox()).y < 0, 'Landing navbar scrolls away from the statement');
  for (const width of [320, 375, 768, 1440]) {
    await motion.setViewportSize({ width, height: 844 });
    for (const theme of ['light', 'dark']) {
      const themeToggle = motion.getByRole('button', { name: theme === 'dark' ? 'Switch to dark theme' : 'Switch to light theme' });
      if (await themeToggle.count()) await themeToggle.click();
      const bounds = await statement.evaluate((element) => ({ top: element.getBoundingClientRect().top + scrollY, height: element.getBoundingClientRect().height }));
      for (const progress of [0, 0.5, 1, 0.5]) {
        await motion.evaluate(({ top, height, progress }) => scrollTo(0, top + progress * (height - innerHeight)), { top: bounds.top, height: bounds.height, progress });
        await motion.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        const copy = motion.locator('.nodus-ink-copy');
        assert.equal(await copy.evaluate((element) => getComputedStyle(element).clipPath), 'none', `${width}/${theme}: statement text is not clipped by the ink edge`);
        assert.equal(await copy.evaluate((element) => getComputedStyle(element).mixBlendMode), 'difference', `${width}/${theme}: statement text contrasts across the ink edge`);
        assert(await motion.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}/${theme}: reveal has no horizontal overflow`);
        if (progress === 0.5) await motion.locator('.nodus-ink-stage').screenshot({ path: join(artifacts, `scroll-${width}-${theme}-${progress}.png`) });
      }
    }
  }
  await motion.emulateMedia({ reducedMotion: 'reduce' });
  await motion.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  assert.equal(await statement.getAttribute('data-scroll-enabled'), null, 'Reduced motion removes the scroll hold');
  assert((await statement.boundingBox()).height <= 1000, 'Reduced motion presents one static statement');
  await motion.close();
  assert.deepEqual(errors, []);
  console.log(`Landing visual smoke passed: 6 widths × 2 themes, real assets, no overflow, keyboard menu/focus return, reversible scroll reveal, reduced-motion fallback, workspace navigation, and no console errors. Screenshots: ${artifacts}`);
} finally {
  await browser.close();
  server.kill('SIGTERM');
  await Promise.race([new Promise((done) => server.once('close', done)), delay(5000)]);
  await rm(temp, { recursive: true, force: true });
}
