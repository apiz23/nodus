import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = await mkdtemp(join(tmpdir(), 'nodus-tasks-'));
process.env.NODUS_VAULT = root;
let server;
let browser;
try {
  await writeFile(join(root, 'project.md'), [
    '# Project plan',
    '',
    '- [ ] Duplicate task',
    '- [ ] Duplicate task [due:2026-11-10] [priority:high]',
    '  - [x] Nested completed task',
    '',
    '```',
    '- [ ] Code block task',
    '```',
    '',
    '## Later',
    '',
    '- [X] Finished task',
    '',
  ].join('\n'), 'utf8');
  await writeFile(join(root, 'other.md'), '# Other note\n\n- [ ] Other task\n', 'utf8');
  server = await createServer({ configFile: 'ui/vite.config.ts', server: { port: 0, strictPort: false } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  process.env.NODUS_ALLOWED_ORIGINS = base;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/app`);
  let failuresRemaining = 2;
  await page.route(/\/api\/tasks(?:\?|$)/, async (route) => {
    if (failuresRemaining <= 0) return route.continue();
    failuresRemaining--;
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_FAILURE', message: 'Temporary task failure' } }) });
  });
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('alert').getByText('Temporary task failure').waitFor();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('heading', { name: 'Tasks', exact: true }).waitFor();
  await page.getByText('3 open · 2 completed').waitFor();
  assert.equal(await page.getByText('Code block task', { exact: true }).count(), 0, 'Fenced code was interpreted as a task');
  assert.equal(await page.getByText('Nested completed task', { exact: true }).count(), 1, 'Nested task missing');
  assert.equal(await page.getByText('Due 2026-11-10', { exact: true }).count(), 1, 'Due date metadata missing');
  assert.equal(await page.getByText('high priority', { exact: true }).count(), 1, 'Priority metadata missing');

  const statusFilters = page.getByRole('group', { name: 'Filter tasks by status' });
  await statusFilters.getByRole('button', { name: /^Open/ }).click();
  await page.getByText('3 open · 2 completed').waitFor();
  assert.equal(await page.getByText('Finished task', { exact: true }).count(), 0, 'Completed filter leaked a completed task');
  await statusFilters.getByRole('button', { name: /^Completed/ }).click();
  assert.equal(await page.getByText('Finished task', { exact: true }).count(), 1, 'Completed filter missed a completed task');
  await statusFilters.getByRole('button', { name: /^All/ }).click();

  await page.getByRole('textbox', { name: 'Filter tasks' }).fill('no such task');
  await page.getByText('No matching tasks', { exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Filter tasks' }).fill('other task');
  assert.equal(await page.getByText('Other task', { exact: true }).count(), 1, 'Task search missed a task');
  assert.equal(await page.getByText('Duplicate task', { exact: true }).count(), 0, 'Task search did not filter unrelated tasks');
  await page.getByRole('textbox', { name: 'Filter tasks' }).fill('');

  await page.getByRole('button', { name: 'View options' }).click();
  await page.getByRole('combobox', { name: 'Group tasks' }).click();
  await page.getByRole('option', { name: 'Status', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('region', { name: 'Open' }).waitFor();
  await page.getByRole('region', { name: 'Completed' }).waitFor();

  const duplicate = page.getByRole('checkbox', { name: /Mark “Duplicate task” complete/ }).first();
  await duplicate.click();
  await page.getByText('2 open · 3 completed').waitFor();
  const source = await readFile(join(root, 'project.md'), 'utf8');
  assert(source.includes('- [x] Duplicate task\n- [ ] Duplicate task [due:2026-11-10]'), 'Task toggle changed the wrong duplicate or surrounding Markdown');

  await page.getByRole('button', { name: 'Duplicate task', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Note title' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Note title' }).inputValue(), 'project');
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('heading', { name: 'Tasks', exact: true }).waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.locator('main').evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  assert(overflow.scroll <= overflow.client + 1, 'Tasks view overflowed the narrow viewport');
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log('Tasks browser smoke passed: extraction, counts, filters, search, grouping, duplicate-safe toggle, source navigation, and mobile layout.');
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
  await rm(root, { recursive: true, force: true });
}
