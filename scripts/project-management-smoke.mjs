import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = await mkdtemp(join(tmpdir(), 'nodus-project-management-'));
process.env.NODUS_VAULT = root;
process.env.NODUS_PREFERENCES_PATH = join(root, 'app-preferences.json');
let server, browser;
try {
  server = await createServer({ configFile: 'ui/vite.config.ts', server: { port: 0, strictPort: false } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  process.env.NODUS_ALLOWED_ORIGINS = base;
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`${base}/api${path}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const data = await response.json();
    assert(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
    return data;
  };
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.setDefaultTimeout(15_000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/app`);
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  const templates = () => page.getByRole('button', { name: 'Templates', exact: true }).click();
  const databases = () => page.getByRole('button', { name: 'Databases', exact: true }).click();
  const openDatabase = (name) => page.getByRole('button', { name: new RegExp(`^${name} —`) }).click();
  const database = async (name) => {
    const matches = (await request('/databases')).databases.filter((item) => item.name === name);
    assert.equal(matches.length, 1);
    return matches[0];
  };
  const choose = async (label, name) => {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
  };
  const apply = async (name) => {
    await page.getByRole('navigation', { name: 'Template list' }).getByRole('button', { name: `${name} Database`, exact: true }).click();
    const [preview] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/preview')),
      page.getByRole('button', { name: 'Preview', exact: true }).click(),
    ]);
    assert.equal(preview.status(), 200, await preview.text());
    const [applied] = await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/apply')),
      page.getByTestId('workspace-content').getByRole('button', { name: 'Create from template', exact: true }).click(),
    ]);
    assert.equal(applied.status(), 201, await applied.text());
    await page.getByText('Database created from template.', { exact: true }).waitFor();
  };
  const saveSchema = async () => {
    const response = page.waitForResponse((result) => /\/api\/databases\/[^/]+$/.test(result.url()) && result.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Save schema', exact: true }).click();
    assert.equal((await response).status(), 200);
    await page.getByRole('dialog', { name: 'Edit database schema' }).waitFor({ state: 'hidden' });
  };
  const setup = async (suffix) => {
    await apply('Projects');
    await apply('Work Items');
    const projects = await database('Projects');
    const items = await database('Work Items');
    assert.deepEqual(items.properties.map(({ name }) => name), ['Type', 'Status', 'Priority']);
    await databases();
    await openDatabase('Projects');
    await page.getByRole('button', { name: 'Edit schema', exact: true }).click();
    await page.getByRole('textbox', { name: 'Database name' }).fill(`Projects ${suffix}`);
    await saveSchema();
    await openDatabase('Work Items');
    await page.getByRole('button', { name: 'Edit schema', exact: true }).click();
    await page.getByRole('textbox', { name: 'Database name' }).fill(`Work Items ${suffix}`);
    await page.getByRole('button', { name: 'Add property', exact: true }).click();
    await page.getByRole('textbox', { name: 'Property 4 name', exact: true }).fill('Project');
    await choose('Property 4 type', 'Relation');
    await choose('Project Target database', `Projects ${suffix}`);
    await choose('Project Cardinality', 'One record');
    await saveSchema();
    const linked = await database(`Work Items ${suffix}`);
    const relation = linked.properties.find(({ name }) => name === 'Project');
    assert.equal(linked.id, items.id);
    assert.deepEqual(relation.relation, { databaseId: projects.id, cardinality: 'one' });
    return { projects, items, relation };
  };

  await templates();
  await page.getByRole('heading', { name: 'Project management' }).waitFor();
  await page.getByRole('button', { name: 'Add project templates' }).click();
  await page.getByRole('button', { name: 'Save template library', exact: true }).click();
  await page.getByText('Template library saved.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Add project templates' }).isDisabled(), true);
  const first = await setup('Alpha');
  await templates();
  const second = await setup('Beta');
  assert.notEqual(first.projects.id, second.projects.id);
  assert.notEqual(first.items.id, second.items.id);
  assert.equal((await database('Work Items Alpha')).properties.find(({ name }) => name === 'Project').relation.databaseId, first.projects.id);

  const seed = async (title, body = '') => (await request('/notes', 'POST', { title, body })).note;
  const project = await seed('Project brief', '## Context\nShip the first release.');
  const alphaTask = await seed('Alpha task');
  const alphaBug = await seed('Alpha bug', '## Steps to reproduce\nOpen the board.');
  const unassigned = await seed('Unassigned task');
  const { items, relation } = first;
  const [type, status, priority] = items.properties;
  const value = async (note, propertyId, input) => {
    const { contentHash } = await request(`/notes/${note.id}/properties`);
    await request(`/notes/${note.id}/properties`, 'PUT', { databaseId: items.id, propertyId, value: input, confirmCreate: true, baseHash: contentHash });
  };
  await page.reload();
  await databases();
  await openDatabase('Projects Alpha');
  await page.getByRole('button', { name: 'Add note', exact: true }).first().click();
  await page.getByRole('list', { name: 'Notes not in this database' }).getByRole('button', { name: /Project brief/ }).click();
  await page.getByRole('button', { name: 'Confirm add to Projects Alpha', exact: true }).click();
  await page.getByRole('button', { name: 'Add note to database', exact: true }).click();
  await page.getByRole('button', { name: 'Project brief', exact: true }).waitFor();
  for (const [note, typeOption] of [[alphaTask, type.options[0]], [alphaBug, type.options[1]], [unassigned, type.options[0]]]) {
    await value(note, type.id, typeOption.id);
    await value(note, status.id, status.options[0].id);
    if (note !== unassigned) await value(note, relation.id, project.id);
  }
  await value(alphaTask, priority.id, priority.options[2].id);
  await openDatabase('Work Items Alpha');
  const view = async (name) => {
    await page.getByRole('combobox', { name: 'View', exact: true }).click();
    await page.getByRole('option', { name: new RegExp(`^${name} ·`) }).click();
  };
  await view('Bugs');
  const table = page.getByRole('table');
  await table.getByRole('button', { name: 'Alpha bug', exact: true }).waitFor();
  assert.equal(await table.getByRole('button', { name: 'Alpha task', exact: true }).count(), 0);
  await view('Status board');
  const board = page.getByRole('region', { name: 'Kanban grouped by Status' });
  await board.getByRole('button', { name: 'Move Alpha task', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Edit card property' });
  await editor.getByRole('button', { name: 'Edit card Status', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Done', exact: true }).click();
  await editor.getByRole('button', { name: 'Save card', exact: true }).click();
  await board.getByRole('region', { name: 'Done column' }).getByRole('article', { name: 'Alpha task', exact: true }).waitFor();
  await view('All Work Items');
  await page.getByRole('button', { name: 'Edit Status for Alpha task' }).filter({ hasText: 'Done' }).waitFor();
  await page.getByRole('button', { name: 'Edit Priority for Alpha task' }).filter({ hasText: 'High' }).waitFor();
  const currentProject = (await request(`/notes/${project.id}`)).note;
  await request(`/notes/${project.id}`, 'PUT', {
    title: 'Renamed project', body: currentProject.body, baseHash: currentProject.contentHash,
  });
  await page.reload();
  await databases();
  await openDatabase('Work Items Alpha');
  await page.getByRole('button', { name: 'Edit Status for Alpha task' }).filter({ hasText: 'Done' }).waitFor();
  await page.getByRole('button', { name: /^Columns,/ }).click();
  await page.getByRole('checkbox', { name: 'Project', exact: true }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.getByText('View saved to this vault.', { exact: true }).waitFor();
  await table.getByRole('button', { name: /^Open related record Renamed project/  }).first().waitFor();
  await page.getByRole('button', { name: 'Filter rows', exact: true }).click();
  await page.getByRole('button', { name: 'Add filter', exact: true }).click();
  await choose('Filter 1 property', 'Project');
  await page.getByRole('option', { name: 'Choose Renamed project', exact: true }).click();
  await page.keyboard.press('Escape');
  await table.getByRole('button', { name: 'Alpha bug', exact: true }).waitFor();
  await table.getByRole('button', { name: 'Alpha task', exact: true }).waitFor();
  assert.equal(await table.getByRole('button', { name: 'Unassigned task', exact: true }).count(), 0);
  const { rows } = await request(`/databases/${items.id}/rows`);
  assert.deepEqual(rows.filter(({ values }) => values[relation.id] === project.id).map(({ title }) => title).sort(), ['Alpha bug', 'Alpha task']);
  assert.equal(rows.find(({ noteId }) => noteId === unassigned.id).values[relation.id], undefined);
  const { templates: savedTemplates } = await request('/templates');
  assert(savedTemplates.every(({ database }) => database.properties.every(({ type }) => type !== 'relation')));
  assert.deepEqual(errors, []);
  console.log('Project management browser smoke passed: reusable templates, independent pairs, schema linking, project membership, bug filtering, board edits, reload, and stable relations after rename.');
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
