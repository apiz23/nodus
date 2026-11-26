import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = await mkdtemp(join(tmpdir(), 'nodus-project-management-'));
const vaultA = join(root, 'vault-a');
const vaultB = join(root, 'vault-b');
await mkdir(vaultB);
process.env.NODUS_VAULT = vaultA;
process.env.NODUS_VAULT_ROOTS = root;
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
  const page = await browser.newPage({ timezoneId: 'America/Los_Angeles' });
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
  const setup = async (suffix, workItemsAlreadyApplied = false) => {
    await apply('Projects');
    if (!workItemsAlreadyApplied) await apply('Work Items');
    const projects = await database('Projects');
    const items = await database('Work Items');
    assert.deepEqual(items.properties.map(({ name }) => name), ['Type', 'Status', 'Priority', 'Date']);
    await databases();
    await openDatabase('Projects');
    await page.getByRole('button', { name: 'Edit schema', exact: true }).click();
    await page.getByRole('textbox', { name: 'Database name' }).fill(`Projects ${suffix}`);
    await saveSchema();
    await openDatabase('Work Items');
    await page.getByRole('button', { name: 'Edit schema', exact: true }).click();
    await page.getByRole('textbox', { name: 'Database name' }).fill(`Work Items ${suffix}`);
    await page.getByRole('button', { name: 'Add property', exact: true }).click();
    await page.getByRole('textbox', { name: 'Property 5 name', exact: true }).fill('Project');
    await choose('Property 5 type', 'Relation');
    await choose('Project Target database', `Projects ${suffix}`);
    await choose('Project Cardinality', 'One record');
    await saveSchema();
    const linked = await database(`Work Items ${suffix}`);
    const relation = linked.properties.find(({ name }) => name === 'Project');
    assert.equal(linked.id, items.id);
    assert.deepEqual(relation.relation, { databaseId: projects.id, cardinality: 'one' });
    return { projects, items, relation };
  };

  const captureId = '92929292-9292-4929-8929-929292929292';
  await request('/databases', 'POST', { database: { id: captureId, name: 'Capture fixture', properties: [] } });
  await page.reload();
  await templates();
  await page.getByRole('heading', { name: 'Project management' }).waitFor();
  const list = page.getByRole('navigation', { name: 'Template list' });
  const templateButton = (name) => list.getByRole('button', { name: `${name} Database`, exact: true });
  const captureRoute = (url) => url.pathname === `/api/databases/${captureId}/views`;
  const originatingPath = await realpath(vaultA);
  const fetched = Promise.withResolvers();
  const releaseObsoleteCapture = Promise.withResolvers();
  const obsoleteRouteDone = Promise.withResolvers();
  let catalogWrites = 0;
  page.on('request', (pending) => {
    if (new URL(pending.url()).pathname === '/api/templates' && pending.method() === 'PUT') catalogWrites++;
  });
  await page.route(captureRoute, async (route) => {
    try {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      assert.equal(new URL(route.request().url()).searchParams.get('vaultPath'), originatingPath);
      fetched.resolve();
      await releaseObsoleteCapture.promise;
      // Chromium may already have aborted the intercepted request.
      await route.fulfill({ response }).catch(() => {});
    } finally {
      obsoleteRouteDone.resolve();
    }
  }, { times: 1 });
  await page.getByRole('combobox', { name: 'Create database template' }).selectOption(captureId);
  await fetched.promise;
  await page.getByRole('button', { name: 'Add project templates' }).click();
  await templateButton('Projects').waitFor();
  await templateButton('Work Items').waitFor();
  const aborted = page.waitForEvent('requestfailed', (pending) => captureRoute(new URL(pending.url())));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  assert.match((await aborted).failure()?.errorText ?? '', /ABORTED|CANCELLED/i);
  const switchVault = async (path) => {
    await page.getByRole('textbox', { name: 'Vault folder' }).fill(path);
    const [response] = await Promise.all([
      page.waitForResponse((result) => new URL(result.url()).pathname === '/api/vault/open'),
      page.getByRole('button', { name: 'Use folder', exact: true }).click(),
    ]);
    assert.equal(response.status(), 200, await response.text());
  };
  await switchVault(vaultB);
  releaseObsoleteCapture.resolve();
  await obsoleteRouteDone.promise;
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  assert.equal(catalogWrites, 0, 'An obsolete capture attempted to persist its catalog');
  assert.deepEqual(await request('/templates'), { templates: [], hash: null });
  for (const target of [vaultA, vaultB]) {
    await assert.rejects(access(join(target, '.nodus-templates', 'templates.json')), { code: 'ENOENT' });
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await switchVault(vaultA);
  await templates();

  const releaseCapture = Promise.withResolvers();
  await page.route(captureRoute, async (route) => {
    await releaseCapture.promise;
    await route.continue();
  }, { times: 1 });
  await Promise.all([
    page.waitForRequest((pending) => captureRoute(new URL(pending.url()))),
    page.getByRole('combobox', { name: 'Create database template' }).selectOption(captureId),
  ]);
  await page.getByRole('button', { name: 'Add project templates' }).click();
  await templateButton('Projects').waitFor();
  await templateButton('Work Items').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Save template library' }).isDisabled(), true);
  assert.deepEqual((await request('/templates')).templates, []);
  releaseCapture.resolve();
  await page.getByText('Template library saved.', { exact: true }).waitFor();
  const expectedTemplates = ['Capture fixture template', 'Projects', 'Work Items'];
  for (const name of expectedTemplates) await templateButton(name).waitFor();
  const savedCatalog = await request('/templates');
  assert.deepEqual(savedCatalog.templates.map(({ name }) => name).sort(), expectedTemplates);
  assert.equal(await page.getByRole('button', { name: 'Add project templates' }).isDisabled(), true);

  const projectsTemplate = savedCatalog.templates.find(({ name }) => name === 'Projects');
  const workItemsTemplate = savedCatalog.templates.find(({ name }) => name === 'Work Items');
  const projectsPreview = `**/api/templates/${projectsTemplate.id}/preview`;
  const workItemsPreview = `**/api/templates/${workItemsTemplate.id}/preview`;
  const previewButton = page.getByRole('button', { name: 'Preview', exact: true });
  const applyButton = page.getByTestId('workspace-content').getByRole('button', { name: 'Create from template', exact: true });
  const previewOutput = page.getByTestId('workspace-content').locator('pre');
  for (const currentResponseFirst of [false, true]) {
    const releaseObsolete = Promise.withResolvers();
    await page.route(projectsPreview, async (route) => {
      await releaseObsolete.promise;
      await route.continue();
    }, { times: 1 });
    await templateButton('Projects').click();
    await Promise.all([page.waitForRequest(projectsPreview), previewButton.click()]);
    await templateButton('Work Items').click();
    assert.equal(await applyButton.isDisabled(), true);
    const loadCurrentPreview = async () => {
      await Promise.all([page.waitForResponse(workItemsPreview), previewButton.click()]);
      await previewOutput.filter({ hasText: '"name": "Work Items"' }).waitFor();
      assert.equal(await applyButton.isEnabled(), true);
    };
    if (currentResponseFirst) await loadCurrentPreview();
    const obsolete = page.waitForResponse(projectsPreview);
    releaseObsolete.resolve();
    await (await obsolete).finished();
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    if (!currentResponseFirst) {
      assert.equal(await previewOutput.count(), 0);
      assert.equal(await applyButton.isDisabled(), true);
      await loadCurrentPreview();
    } else {
      assert.match(await previewOutput.innerText(), /"name": "Work Items"/);
      assert.equal(await applyButton.isEnabled(), true);
    }
  }
  const [appliedCurrent] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/apply')),
    applyButton.click(),
  ]);
  assert.equal(new URL(appliedCurrent.url()).pathname, `/api/templates/${workItemsTemplate.id}/apply`);
  assert.equal(appliedCurrent.status(), 201, await appliedCurrent.text());
  await page.getByText('Database created from template.', { exact: true }).waitFor();
  await database('Work Items');
  assert.equal((await request('/databases')).databases.some(({ name }) => name === 'Projects'), false);

  const first = await setup('Alpha', true);
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
  const [type, status, priority, date] = items.properties;
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
  await value(alphaBug, date.id, '2028-02-29');
  await page.reload();
  await databases();
  await openDatabase('Work Items Alpha');
  await view('Calendar');
  const calendar = page.getByRole('region', { name: 'Calendar by Date' });
  await calendar.getByRole('region', { name: 'Undated calendar events' }).getByRole('button', { name: /Alpha task/ }).waitFor();
  const month = calendar.getByLabel('Month', { exact: true });
  const currentMonth = await month.inputValue();
  const desktopViewport = page.viewportSize();
  await page.setViewportSize({ width: 620, height: 800 });
  const dates = calendar.getByRole('region', { name: 'Calendar dates' });
  assert(await dates.evaluate((element) => element.scrollWidth > element.clientWidth));
  await page.setViewportSize(desktopViewport);
  await month.fill('2028-02');
  await calendar.getByRole('button', { name: 'Next month' }).click();
  assert.equal(await month.inputValue(), '2028-03');
  await calendar.getByRole('button', { name: 'Previous month' }).click();
  assert.equal(await month.inputValue(), '2028-02');
  const day = (iso) => calendar.getByRole('cell').filter({ has: page.getByRole('button', { name: `Create note on ${iso}`, exact: true }) });
  const bug = day('2028-02-29').getByRole('article', { name: 'Alpha bug' });
  await bug.getByRole('button', { name: 'Alpha bug', exact: true }).click();
  const openedTitle = page.getByRole('textbox', { name: 'Note title', exact: true });
  await openedTitle.waitFor();
  assert.equal(await openedTitle.inputValue(), 'Alpha bug');
  await databases();
  await openDatabase('Work Items Alpha');
  await view('Calendar');
  await month.fill('2028-02');
  await bug.getByRole('button', { name: 'Edit date', exact: true }).click();
  const editDate = page.getByRole('dialog', { name: 'Edit Calendar dates' });
  await editDate.getByLabel('Start date').fill('2028-02-28');
  await editDate.getByRole('button', { name: 'Save dates' }).click();
  await day('2028-02-28').getByRole('article', { name: 'Alpha bug' }).waitFor();
  await calendar.getByRole('button', { name: 'Create note on 2028-02-29', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create a dated note' });
  assert.equal(await create.getByLabel('Date', { exact: true }).inputValue(), '2028-02-29');
  await create.getByLabel('Title', { exact: true }).fill('Calendar work item');
  await create.getByRole('button', { name: 'Create note and add date' }).click();
  await day('2028-02-29').getByRole('article', { name: 'Calendar work item' }).waitFor();
  const calendarRows = (await request(`/databases/${items.id}/rows`)).rows;
  assert.equal(calendarRows.find(({ title }) => title === 'Calendar work item').values[date.id], '2028-02-29');
  await calendar.getByRole('button', { name: 'Today', exact: true }).click();
  assert.equal(await month.inputValue(), currentMonth);
  await calendar.getByText('No events on this day.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Filter rows', exact: true }).click();
  await page.getByRole('button', { name: 'Add filter', exact: true }).click();
  await choose('Filter 1 property', 'Date');
  await choose('Filter 1 operator', 'is not empty');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  await page.getByText('View saved to this vault.', { exact: true }).waitFor();
  await page.reload();
  await databases();
  await openDatabase('Work Items Alpha');
  await view('Calendar');
  await month.fill('2028-02');
  await day('2028-02-29').getByRole('article', { name: 'Calendar work item' }).waitFor();
  assert.equal(await calendar.getByRole('button', { name: /Alpha task/ }).count(), 0);
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
  console.log('Project management browser smoke passed: cross-vault cancellation, reusable templates, independent pairs, schema linking, project membership, bug filtering, board edits, reload, stable relations after rename, and Work Items Calendar navigation, opening, editing, creation, filtering and persistence.');
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
