import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = await mkdtemp(join(tmpdir(), 'nodus-relations-'));
process.env.NODUS_VAULT = root;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DB = id(1), TASKS = id(2), COST = id(3), DONE = id(4), STATUS = id(5), OPEN = id(6), DATE = id(7);
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
  await request('/databases', 'POST', { database: { id: TASKS, name: 'Tasks', properties: [{ id: COST, name: 'Cost', type: 'number' }, { id: DONE, name: 'Done', type: 'checkbox' }] } });
  await request('/databases', 'POST', { database: { id: DB, name: 'Projects', properties: [{ id: STATUS, name: 'Status', type: 'select', options: [{ id: OPEN, name: 'Open' }] }, { id: DATE, name: 'Date', type: 'date' }] } });
  const seed = async (title, databaseId, values, tags = []) => {
    let { note } = await request('/notes', 'POST', { title, tags });
    for (const [propertyId, value] of values) {
      const saved = await request(`/notes/${note.id}/properties`, 'PUT', { databaseId, propertyId, value, confirmCreate: true, baseHash: note.contentHash });
      note = { ...note, contentHash: saved.contentHash };
    }
    return note;
  };
  const project = await seed('Project Alpha', DB, [[STATUS, OPEN], [DATE, '2026-10-29']]);
  const first = await seed('Task One', TASKS, [[COST, 3], [DONE, false]]);
  const second = await seed('Task Two', TASKS, [[COST, 7], [DONE, true]]);
  const third = await seed('Task Three', TASKS, [[COST, 11], [DONE, false]], ['relation-picker-demo']);
  const derivedDb = id(70), sourceDb = id(71), forward = id(72), reverse = id(73);
  await request('/databases', 'POST', { database: { id: sourceDb, name: 'Z relation sources', properties: [{ id: forward, name: 'Targets', type: 'relation', relation: { databaseId: derivedDb, cardinality: 'many' } }] } });
  await request('/databases', 'POST', { database: { id: derivedDb, name: 'Z derived records', properties: [{ id: reverse, name: 'Sources', type: 'relation', relation: { databaseId: sourceDb, cardinality: 'many', reversePropertyId: forward } }] } });
  const unassigned = (await request('/notes', 'POST', { title: 'Unassigned record' })).note;
  const deferredMember = (await request('/notes', 'POST', { title: 'Deferred member' })).note;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/app`);
  let projectRowRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === `/api/databases/${DB}/rows`) projectRowRequests++;
  });
  await page.getByRole('button', { name: 'Databases', exact: true }).click();
  await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
  const choose = async (label, name) => {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name, exact: true }).click();
    const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
    if (await continueButton.isVisible().catch(() => false)) await continueButton.click();
  };
  await page.getByRole('button', { name: 'Edit schema', exact: true }).click();
  let propertyCount = 2;
  const add = async (name, type) => {
    await page.getByRole('button', { name: 'Add property', exact: true }).click();
    propertyCount++;
    await page.getByRole('textbox', { name: `Property ${propertyCount} name`, exact: true }).fill(name);
    await choose(`Property ${propertyCount} type`, type);
  };
  await add('Related tasks', 'Relation');
  await choose('Related tasks Target database', 'Tasks');
  await add('Total cost', 'Rollup');
  await choose('Total cost Relation', 'Related tasks');
  await choose('Total cost Operation', 'sum');
  await choose('Total cost Target property', 'Cost');
  await add('Completion', 'Rollup');
  await choose('Completion Relation', 'Related tasks');
  await choose('Completion Operation', 'completion percentage');
  await choose('Completion Target property', 'Done');
  await add('Lead task', 'Relation');
  await choose('Lead task Target database', 'Tasks');
  await choose('Lead task Cardinality', 'One record');
  await page.getByRole('button', { name: 'Save schema', exact: true }).click();
  await page.getByRole('dialog', { name: 'Edit database schema' }).waitFor({ state: 'hidden' });
  const getSchema = async (db) => (await request('/databases')).databases.find((item) => item.id === db);
  const schema = await getSchema(DB);
  const relation = schema.properties.find((property) => property.name === 'Related tasks');
  const total = schema.properties.find((property) => property.name === 'Total cost');
  const completion = schema.properties.find((property) => property.name === 'Completion');
  const saveCell = async () => {
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    try { await page.getByText('Property saved.', { exact: true }).waitFor(); }
    catch (error) {
      console.error('Property save did not complete:', await page.locator('[role="alert"]').allInnerTexts());
      throw error;
    }
  };
  await page.getByRole('button', { name: 'Edit Related tasks for Project Alpha', exact: true }).click();
  await page.getByRole('button', { name: 'Related tasks for Project Alpha', exact: true }).click();
  await page.getByRole('option', { name: 'Choose Task One', exact: true }).click();
  await page.getByRole('option', { name: 'Choose Task Two', exact: true }).click();
  await page.keyboard.press('Escape');
  await saveCell();
  await page.locator(`[aria-label="Total cost for Project Alpha"]`).filter({ hasText: '10' }).waitFor();
  assert.equal(await page.locator('[aria-label="Completion for Project Alpha"]').innerText(), '50.0%');
  assert.equal(await page.getByRole('button', { name: 'Edit Total cost for Project Alpha', exact: true }).count(), 0);

  await page.getByRole('button', { name: 'Edit schema', exact: true }).click();
  await choose('Related tasks Cardinality', 'One record');
  await page.getByRole('button', { name: 'Save schema', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'This change may make saved relation values invalid.' }).waitFor();
  assert.match(await page.getByRole('alert').filter({ hasText: 'This change may make saved relation values invalid.' }).innerText(), /1 note has a stored value/);
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.deepEqual((await request(`/databases/${DB}/rows`)).rows.find((row) => row.noteId === project.id).values[relation.id], [first.id, second.id]);

  await page.getByRole('button', { name: 'Edit Lead task for Project Alpha', exact: true }).click();
  await page.getByRole('button', { name: 'Lead task for Project Alpha', exact: true }).click();
  const option = page.getByRole('option', { name: 'Choose Task One', exact: true });
  await option.waitFor();
  await option.evaluate((element) => element.focus());
  await page.keyboard.press('Enter');
  await saveCell();

  const selectDb = async (name) => {
    await page.getByRole('button', { name: new RegExp(`^${name} —`) }).click();
    await page.getByRole('heading', { name, exact: true }).waitFor();
  };
  await selectDb('Tasks');
  await page.getByRole('button', { name: 'Edit schema', exact: true }).click();
  propertyCount = 2;
  await add('Parent projects', 'Relation');
  await choose('Parent projects Target database', 'Projects');
  await choose('Parent projects Direction', 'Reverse (computed)');
  await choose('Parent projects Forward property', 'Related tasks');
  await page.getByRole('button', { name: 'Save schema', exact: true }).click();
  await page.getByRole('dialog', { name: 'Edit database schema' }).waitFor({ state: 'hidden' });
  await page.getByRole('row').filter({ hasText: 'Task One' }).getByRole('button', { name: /Open related record Project Alpha/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Edit Parent projects for Task One', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Edit Done for Task One', exact: true }).click();
  await page.getByRole('button', { name: 'Done for Task One', exact: true }).click();
  await saveCell();
  await selectDb('Projects');
  await page.locator('[aria-label="Completion for Project Alpha"]').filter({ hasText: '100.0%' }).waitFor();

  for (const [index, type] of ['table', 'kanban', 'calendar'].entries()) {
    await request(`/databases/${DB}/views`, 'POST', { view: { id: id(30 + index), databaseId: DB, name: `${type} relations`, type,
      sort: { propertyId: total.id, direction: 'desc' }, filters: [{ id: id(40 + index), propertyId: relation.id, operator: 'includes', value: first.id }], visiblePropertyIds: [relation.id, total.id, completion.id],
      settings: type === 'kanban' ? { groupPropertyId: STATUS } : type === 'calendar' ? { datePropertyId: DATE } : {} } });
  }
  await page.reload();
  await page.getByRole('button', { name: 'Databases', exact: true }).click();
  for (const type of ['table', 'kanban', 'calendar']) {
    await choose('View', new RegExp(`^${type} relations`));
    if (type === 'calendar') await page.getByLabel('Month', { exact: true }).fill('2026-10');
    const layout = type === 'kanban' ? page.getByRole('region', { name: 'Kanban grouped by Status' }) : type === 'calendar' ? page.getByRole('region', { name: 'Calendar by Date' }) : page.getByRole('table').first();
    await layout.getByRole('button', { name: /Open related record Task One/ }).first().waitFor();
    assert.match(await layout.innerText(), /10/);
  }
  await choose('View', /^table relations/);
  await page.getByRole('table').getByRole('button', { name: /Open related record Task One/ }).first().click();
  await page.getByRole('textbox', { name: 'Note title', exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Note title', exact: true }).inputValue(), 'Task One');
  const incoming = page.getByRole('region', { name: 'Incoming database relation records' });
  const sourceLink = incoming.getByRole('button', { name: /Open Project Alpha in Projects, linked through Related tasks/ });
  await sourceLink.waitFor();
  await incoming.getByText(/reciprocal: Parent projects/).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  const relationPanelBounds = await incoming.boundingBox();
  assert(relationPanelBounds && relationPanelBounds.x >= 0 && relationPanelBounds.x + relationPanelBounds.width <= 390, 'incoming relations should fit the mobile viewport');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'incoming relations should not introduce mobile horizontal overflow');
  await sourceLink.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('textbox', { name: 'Note title', exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Note title', exact: true }).inputValue(), 'Project Alpha');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Databases', exact: true }).click();
  await selectDb('Projects');
  await choose('View', /^table relations/);
  // Return to table before testing stale selection, deletion and reference repair.
  const old = (await request(`/notes/${first.id}`)).note;
  const renamed = (await request(`/notes/${first.id}`, 'PUT', { title: 'Renamed task', body: old.body, baseHash: old.contentHash })).note;
  await request(`/notes/${first.id}/move`, 'POST', { path: 'moved/task.md', baseHash: renamed.contentHash });
  await request(`/notes/${second.id}`, 'DELETE', { baseHash: (await request(`/notes/${second.id}`)).note.contentHash });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await page.getByRole('table').getByRole('button', { name: /Open related record Renamed task/ }).first().waitFor();
  await page.getByText('Missing record', { exact: true }).waitFor();
  assert.equal((await page.getByRole('row').filter({ hasText: 'Project Alpha' }).innerText()).includes(second.id), false);
  await page.getByRole('button', { name: 'Edit Related tasks for Project Alpha', exact: true }).click();
  await page.getByRole('button', { name: `Remove missing relation ${second.id.slice(-8)}`, exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByText('Missing record', { exact: true }).waitFor();
  assert.deepEqual((await request(`/databases/${DB}/rows`)).rows.find((row) => row.noteId === project.id).values[relation.id], [first.id, second.id]);

  await page.getByRole('button', { name: 'Edit Related tasks for Project Alpha', exact: true }).click();
  await page.getByRole('button', { name: 'Related tasks for Project Alpha', exact: true }).click();
  const relationSearch = page.getByRole('combobox', { name: 'Related tasks for Project Alpha', exact: true });
  const requestsBeforeSearch = projectRowRequests;
  await relationSearch.fill('relation-picker-demo');
  const replacement = page.getByRole('option', { name: 'Choose Task Three', exact: true });
  await replacement.waitFor();
  assert.equal(projectRowRequests, requestsBeforeSearch, 'relation picker search should use loaded target candidates without another rows request');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'missing/deleted' }).waitFor();
  await page.getByRole('button', { name: `Remove missing relation ${second.id.slice(-8)}`, exact: true }).click();
  await saveCell();
  const repaired = (await request(`/databases/${DB}/rows`)).rows.find((row) => row.noteId === project.id);
  assert.deepEqual(repaired.values[relation.id], [first.id, third.id]);
  assert.equal(repaired.values[total.id], 14);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Edit Related tasks for Project Alpha', exact: true }).click();
  await page.getByRole('button', { name: 'Related tasks for Project Alpha', exact: true }).click();
  const pickerBounds = await page.locator('[data-slot="popover-content"]').boundingBox();
  assert(pickerBounds && pickerBounds.x >= 0 && pickerBounds.x + pickerBounds.width <= 390, 'relation picker should fit the mobile viewport');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('table').getByRole('button', { name: /Open related record Renamed task/ }).first().click();
  await page.waitForFunction(() => document.querySelector('#note-title')?.value === 'Renamed task');
  await page.getByRole('button', { name: 'Databases', exact: true }).click();
  await selectDb('Z derived records');
  await page.getByRole('button', { name: 'Add note', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Find a note to add' }).fill('Unassigned record');
  await page.getByRole('list', { name: 'Notes not in this database' }).getByRole('button', { name: /Unassigned record/ }).click();
  await page.getByRole('button', { name: 'Confirm add to Z derived records', exact: true }).click();
  await page.getByRole('button', { name: 'Add note to database', exact: true }).click();
  await page.getByText('Note added to the database. Derived values were not stored.', { exact: true }).waitFor();
  assert.deepEqual((await request(`/notes/${unassigned.id}/properties`)).rows[0].values[reverse], []);
  // Leaving the database before the preflight finishes must not start a later membership write.
  let releasePreflight, preflightStarted;
  const started = new Promise((resolve) => { preflightStarted = resolve; });
  let membershipWrites = 0;
  page.on('request', (req) => { if (req.method() === 'POST' && new URL(req.url()).pathname === `/api/databases/${derivedDb}/rows`) membershipWrites++; });
  await page.route(`**/api/notes/${deferredMember.id}/properties`, async (route) => {
    preflightStarted();
    await new Promise((resolve) => { releasePreflight = resolve; });
    await route.continue();
  });
  await page.getByRole('button', { name: 'Add note', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Find a note to add' }).fill('Deferred member');
  await page.getByRole('list', { name: 'Notes not in this database' }).getByRole('button', { name: /Deferred member/ }).click();
  await page.getByRole('button', { name: 'Confirm add to Z derived records', exact: true }).click();
  await page.getByRole('button', { name: 'Add note to database', exact: true }).click();
  await started;
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const finished = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/notes/${deferredMember.id}/properties`);
  releasePreflight(); await finished;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(membershipWrites, 0);
  assert.deepEqual((await request(`/notes/${deferredMember.id}/properties`)).rows, []);
  assert.deepEqual(errors, []);
  console.log('Relations smoke passed: UI schema configuration, single/multiple selection, forward and incoming relation navigation, derived reciprocal links, rollups after edits, all saved layouts, filters, rename/move/delete, repair, and stable-ID navigation.');
} finally {
  await browser?.close(); await server?.close(); await rm(root, { recursive: true, force: true });
}
