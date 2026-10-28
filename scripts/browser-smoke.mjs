import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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

async function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    delay(timeoutMs).then(() => { throw new Error(message); }),
  ]);
}

async function captureScreenshot(page, name) {
  const artifactsDir = process.env.NODUS_SMOKE_ARTIFACTS;
  if (artifactsDir === undefined || artifactsDir === '') return;
  await mkdir(artifactsDir, { recursive: true });
  await page.screenshot({ path: join(artifactsDir, `${name}.png`), fullPage: false });
  console.log(`Screenshot: ${join(artifactsDir, `${name}.png`)}`);
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
  let page;
  const browserErrors = [];
  const apiFailures = [];

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
    page = await context.newPage();
    let expectedStaleConflictWindow = false;
    let expectedInjectedFailureWindow = false;
    page.on('pageerror', (error) => browserErrors.push(`uncaught: ${error.name}: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      if (expectedStaleConflictWindow && /status of 409 \(Conflict\)/i.test(message.text())) return;
      if (expectedInjectedFailureWindow && /status of 500 \(Internal Server Error\)/i.test(message.text())) return;
      browserErrors.push(`console: ${message.text()}`);
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

    const databaseId = '33333333-3333-4333-8333-333333333333';
    const propertyIds = {
      summary: '44444444-4444-4444-8444-444444444444',
      rating: '55555555-5555-4555-8555-555555555555',
      done: '66666666-6666-4666-8666-666666666666',
      due: '77777777-7777-4777-8777-777777777777',
      category: '88888888-8888-4888-8888-888888888888',
      topics: '99999999-9999-4999-8999-999999999999',
      labels: 'abababab-abab-4bab-8bab-abababababab',
    };
    const optionIds = {
      reading: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      done: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    };
    const labelOptions = [
      ['b0000000-0000-4000-8000-000000000001', 'Alpha'],
      ['b0000000-0000-4000-8000-000000000002', 'Beta'],
      ['b0000000-0000-4000-8000-000000000003', 'Gamma'],
      ['b0000000-0000-4000-8000-000000000004', 'Delta'],
      ['b0000000-0000-4000-8000-000000000005', 'Epsilon'],
      ['b0000000-0000-4000-8000-000000000006', 'Zeta'],
      ['b0000000-0000-4000-8000-000000000007', 'Eta'],
      ['b0000000-0000-4000-8000-000000000008', 'Theta'],
      ['b0000000-0000-4000-8000-000000000009', 'Iota'],
    ];
    const secondDatabaseId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    await mkdir(join(expectedVaultPath, 'databases'), { recursive: true });
    await writeFile(join(expectedVaultPath, 'databases', `${databaseId}.json`), `${JSON.stringify({
      format: 'nodus-database',
      version: 1,
      id: databaseId,
      name: 'Reading list',
      properties: [
        { id: propertyIds.summary, name: 'Summary', type: 'text' },
        { id: propertyIds.rating, name: 'Rating', type: 'number' },
        { id: propertyIds.done, name: 'Done', type: 'checkbox' },
        { id: propertyIds.due, name: 'Due date', type: 'date' },
        { id: propertyIds.category, name: 'Category', type: 'select', options: [
          { id: optionIds.reading, name: 'Reading' },
          { id: optionIds.done, name: 'Done' },
        ] },
        { id: propertyIds.topics, name: 'Topics', type: 'multi-select', options: [
          { id: optionIds.reading, name: 'Work' },
          { id: optionIds.done, name: 'Research' },
        ] },
        { id: propertyIds.labels, name: 'Labels', type: 'multi-select', options: labelOptions.map(([id, name]) => ({ id, name })) },
      ],
    }, null, 2)}\n`, 'utf8');
    await writeFile(join(expectedVaultPath, 'databases', `${secondDatabaseId}.json`), `${JSON.stringify({
      format: 'nodus-database',
      version: 1,
      id: secondDatabaseId,
      name: 'Second empty database',
      properties: [],
    }, null, 2)}\n`, 'utf8');
    await writeFile(join(expectedVaultPath, 'notes', 'unsupported.md'), `---\ntitle: Unsupported properties note\nnodus:\n  version: 1\n  id: cccccccc-cccc-4ccc-8ccc-cccccccccccc\n  createdAt: 2026-10-28T10:00:00Z\n  updatedAt: 2026-10-28T10:00:00Z\nnodus_data:\n  format: nodus-note-properties\n  version: 2\n  databases:\n    ${databaseId}:\n      ${propertyIds.summary}: future-value\n---\nOpaque values stay in Markdown.\n`, 'utf8');
    await writeFile(join(expectedVaultPath, 'notes', 'invalid.md'), `---\ntitle: Invalid properties note\nnodus:\n  version: 1\n  id: dddddddd-dddd-4ddd-8ddd-dddddddddddd\n  createdAt: 2026-10-28T10:00:00Z\n  updatedAt: 2026-10-28T10:00:00Z\nnodus_data:\n  format: nodus-note-properties\n  version: 1\n  databases:\n    ${databaseId}:\n      ${propertyIds.summary}: 42\n---\nInvalid value stays readable.\n`, 'utf8');
    await writeFile(join(expectedVaultPath, 'notes', 'race-member.md'), `---\ntitle: Database A race member\nnodus:\n  version: 1\n  id: 12121212-1212-4121-8121-121212121212\n  createdAt: 2026-10-28T10:00:00Z\n  updatedAt: 2026-10-28T10:00:00Z\nnodus_data:\n  format: nodus-note-properties\n  version: 1\n  databases:\n    ${databaseId}:\n      ${propertyIds.summary}: A-only-row\n---\nThis row belongs only to database A.\n`, 'utf8');

    // Defer A's row response while B loads. Resolving both success and failure
    // after B is visible must not leak A's rows or status into the selection.
    const rowPath = `/api/databases/${databaseId}/rows`;
    let rowLoadMode = 'success';
    let signalRowLoad;
    let releaseRowLoad;
    const rowLoadIntercepted = new Promise((resolve) => { signalRowLoad = resolve; });
    await page.route(`**${rowPath}*`, async (route) => {
      if (rowLoadMode === 'pass') return route.continue();
      signalRowLoad();
      await new Promise((resolve) => { releaseRowLoad = resolve; });
      if (rowLoadMode === 'failure') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INJECTED_ROWS_FAILURE', message: 'Injected row load failure' } }) });
      } else {
        await route.continue();
      }
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Databases' }).click();
    await withTimeout(rowLoadIntercepted, 15_000, 'Deferred database A row load was never requested');
    await page.getByRole('button', { name: /Second empty database/ }).click();
    await page.getByRole('heading', { name: 'Second empty database' }).waitFor({ state: 'visible' });
    await page.getByText('No notes in this database yet', { exact: true }).waitFor({ state: 'visible' });
    const delayedSuccessResponse = page.waitForResponse((response) => new URL(response.url()).pathname === rowPath && response.status() === 200);
    releaseRowLoad();
    await delayedSuccessResponse;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.getByText('No notes in this database yet', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('table').getByRole('button', { name: 'Database A race member', exact: true }).count(), 0, 'Database A row leaked into database B');
    rowLoadMode = 'pass';
    const switchedBackRowsResponse = page.waitForResponse((response) => new URL(response.url()).pathname === rowPath);
    await page.getByRole('button', { name: /Reading list/ }).click();
    assert.equal((await switchedBackRowsResponse).status(), 200, 'Reloading database A rows failed after returning from B');
    await page.getByRole('table').getByRole('button', { name: 'Database A race member', exact: true }).waitFor({ state: 'visible' });

    rowLoadMode = 'failure';
    const secondRowLoadIntercepted = new Promise((resolve) => { signalRowLoad = resolve; });
    await page.getByRole('button', { name: 'Refresh' }).click();
    await withTimeout(secondRowLoadIntercepted, 15_000, 'Second deferred database A row load was never requested');
    await page.getByRole('button', { name: /Second empty database/ }).click();
    await page.getByRole('heading', { name: 'Second empty database' }).waitFor({ state: 'visible' });
    expectedInjectedFailureWindow = true;
    const delayedFailureResponse = page.waitForResponse((response) => new URL(response.url()).pathname === rowPath && response.status() === 500);
    releaseRowLoad();
    await delayedFailureResponse;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expectedInjectedFailureWindow = false;
    assert.equal(await page.getByRole('alert').count(), 0, 'Database A load error leaked into database B');
    assert.equal(await page.getByRole('table').getByRole('button', { name: 'Database A race member', exact: true }).count(), 0, 'Database A row reappeared after its delayed failed load');
    rowLoadMode = 'pass';
    await page.unroute(`**${rowPath}*`);

    await page.getByRole('button', { name: /Reading list/ }).click();
    await page.getByRole('heading', { name: 'Reading list' }).waitFor({ state: 'visible' });

    // Change the schema after the selector loaded its hash. Refresh must see
    // SCHEMA_CHANGED, refresh definitions, and retry against the new snapshot.
    const schemasBeforeRevision = (await (await fetch(`${baseUrl}/api/databases`)).json()).databases;
    const schemaBeforeRevision = schemasBeforeRevision.find((item) => item.id === databaseId);
    assert(schemaBeforeRevision, 'Could not read schema revision for the UI refresh test');
    const renamedSchemaResponse = await fetch(`${baseUrl}/api/databases/${databaseId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        database: { id: databaseId, name: 'Reading list revision', properties: schemaBeforeRevision.properties },
        baseHash: schemaBeforeRevision.contentHash,
      }),
    });
    assert.equal(renamedSchemaResponse.status, 200, 'Could not change schema during the UI revision test');
    expectedStaleConflictWindow = true;
    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.getByRole('heading', { name: 'Reading list revision' }).waitFor({ state: 'visible' });
    await page.getByRole('table').getByRole('button', { name: 'Database A race member', exact: true }).waitFor({ state: 'visible' });
    expectedStaleConflictWindow = false;

    const changedSchemas = (await (await fetch(`${baseUrl}/api/databases`)).json()).databases;
    const changedSchema = changedSchemas.find((item) => item.id === databaseId);
    assert(changedSchema, 'Could not read updated schema revision');
    const restoredSchemaResponse = await fetch(`${baseUrl}/api/databases/${databaseId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        database: { id: databaseId, name: 'Reading list', properties: changedSchema.properties },
        baseHash: changedSchema.contentHash,
      }),
    });
    assert.equal(restoredSchemaResponse.status, 200, 'Could not restore temporary database name');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Databases' }).click();
    await page.getByRole('heading', { name: 'Reading list' }).waitFor({ state: 'visible' });

    await page.getByText(/2 structured-data diagnostics/i).click();
    await page.getByText(/newer than supported version/i).waitFor({ state: 'visible' });
    await expectDisabled(page.getByRole('button', { name: 'Edit Summary for Invalid properties note' }));
    await page.getByRole('button', { name: 'Add note', exact: true }).click();
    const noteSearch = page.getByRole('textbox', { name: 'Find a note to add' });
    await noteSearch.fill('Browser smoke first note');
    await noteSearch.press('Tab');
    const noteSuggestion = page.getByRole('list', { name: 'Notes not in this database' }).getByRole('button', { name: /Browser smoke first note/ });
    assert.equal(await noteSuggestion.evaluate((element) => element === document.activeElement), true, 'Tab did not focus the note suggestion');
    assert.equal(await noteSuggestion.evaluate((element) => element.closest('label') === null), true, 'Suggestion button is nested inside a label');
    await noteSuggestion.press('Enter');
    assert.equal(await noteSuggestion.getAttribute('aria-pressed'), 'true', 'Enter did not select the note');
    assert.equal(await noteSuggestion.evaluate((element) => element === document.activeElement), true, 'Selecting a note unexpectedly moved focus');
    await noteSuggestion.press('Space');
    assert.equal(await noteSuggestion.getAttribute('aria-pressed'), 'true', 'Space did not activate the note suggestion');
    await noteSuggestion.press('Tab');
    assert.equal(await page.getByRole('combobox', { name: 'Property to set' }).evaluate((element) => element === document.activeElement), true, 'Tab did not continue to the property chooser');
    await page.getByRole('textbox', { name: 'Summary value for Browser smoke first note' }).fill('Initial row');
    await page.getByRole('button', { name: 'Confirm add to Reading list' }).click();
    await page.getByRole('button', { name: /Second empty database/ }).click();
    await page.getByRole('heading', { name: 'Second empty database' }).waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('region', { name: 'Add note to database' }).count(), 0, 'Add-note draft remained visible after database selection changed');
    await page.getByRole('button', { name: /Reading list/ }).click();
    await page.getByRole('heading', { name: 'Reading list' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Add note', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Confirm add to Reading list' }).count(), 0, 'Membership confirmation leaked across database selection');
    await page.getByRole('textbox', { name: 'Find a note to add' }).fill('Browser smoke first note');
    await page.getByRole('list', { name: 'Notes not in this database' }).getByRole('button', { name: /Browser smoke first note/ }).click();
    await page.getByRole('textbox', { name: 'Summary value for Browser smoke first note' }).fill('Initial row');
    await page.getByRole('button', { name: 'Confirm add to Reading list' }).click();
    const addResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/notes/${firstSummary.id}/properties` &&
      response.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Add note and save property' }).click();
    assert.equal((await addResponse).status(), 200, 'Explicit add-to-database API request failed');
    await page.getByText('Property saved.', { exact: true }).waitFor({ state: 'visible' });
    await captureScreenshot(page, 'desktop-databases');

    // Exercise the actual component controls: invalid filter association,
    // filtered empty state, Popover collision/focus return, and column recovery.
    const filterTrigger = page.getByRole('button', { name: /^Filter rows/ });
    await filterTrigger.click();
    const filtersDialog = page.getByRole('dialog', { name: 'Filters' });
    await filtersDialog.waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Add filter', exact: true }).click();
    const filterValue = page.getByRole('textbox', { name: 'Filter 1 value' });
    assert.equal(await filterValue.getAttribute('aria-invalid'), 'true', 'Empty contains filter was not marked invalid');
    const filterDescriptionId = await filterValue.getAttribute('aria-describedby');
    assert(filterDescriptionId, 'Invalid filter input has no described-by association');
    assert.equal(await page.locator(`#${filterDescriptionId}`).isVisible(), true, 'Filter validation hint is not visible');
    await filterValue.fill('does-not-match');
    await page.getByText('No rows match these filters', { exact: true }).waitFor({ state: 'visible' });
    await captureScreenshot(page, 'desktop-filtered-empty');
    await filterValue.fill('Initial row');
    await page.getByRole('button', { name: `Edit Summary for ${firstNote.title}` }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Remove filter 1' }).click();
    await page.keyboard.press('Escape');
    await filtersDialog.waitFor({ state: 'hidden' });
    assert.equal(await filterTrigger.evaluate((element) => element === document.activeElement), true, 'Filter Popover did not restore focus to its trigger');

    const summaryHeader = page.locator('th').filter({ hasText: /^Summary$/ });
    const ratingHeader = page.locator('th').filter({ hasText: /^Rating$/ });
    await summaryHeader.waitFor({ state: 'visible' });
    const columnsTrigger = page.getByRole('button', { name: /^Columns/ });
    await columnsTrigger.click();
    const columnsDialog = page.getByRole('dialog', { name: 'Columns' });
    const summaryColumn = page.getByRole('group', { name: 'Visible columns' }).getByRole('checkbox', { name: /Summary/ });
    const ratingColumn = page.getByRole('group', { name: 'Visible columns' }).getByRole('checkbox', { name: /Rating/ });
    await summaryColumn.uncheck();
    await ratingColumn.uncheck();
    await summaryHeader.waitFor({ state: 'hidden' });
    await ratingHeader.waitFor({ state: 'hidden' });
    const showAllColumns = columnsDialog.getByRole('button', { name: 'Show all' });
    assert.equal(await showAllColumns.isEnabled(), true, 'Show all did not become available after hiding columns');
    await showAllColumns.click();
    await summaryHeader.waitFor({ state: 'visible' });
    await ratingHeader.waitFor({ state: 'visible' });
    assert.equal(await showAllColumns.isDisabled(), true, 'Show all remained enabled with every column visible');
    await page.keyboard.press('Escape');
    await columnsDialog.waitFor({ state: 'hidden' });
    const columnsFocus = await page.evaluate(() => ({
      tag: document.activeElement?.tagName ?? null,
      label: document.activeElement?.getAttribute('aria-label') ?? null,
      text: document.activeElement?.textContent?.trim().slice(0, 80) ?? null,
    }));
    assert.equal(await columnsTrigger.evaluate((element) => element === document.activeElement), true, `Columns Popover did not restore focus to its trigger: ${JSON.stringify(columnsFocus)}`);

    const saveProperty = async (propertyName, operation) => {
      await page.getByRole('button', { name: `Edit ${propertyName} for ${firstNote.title}` }).click();
      await operation();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.getByText('Property saved.', { exact: true }).waitFor({ state: 'visible' });
    };
    await saveProperty('Rating', async () => {
      await page.getByRole('spinbutton', { name: `Rating for ${firstNote.title}` }).fill('4.5');
    });
    await saveProperty('Done', async () => {
      await page.getByRole('button', { name: `Done for ${firstNote.title}` }).click();
    });
    await saveProperty('Due date', async () => {
      await page.getByLabel(`Due date for ${firstNote.title}`).fill('2026-10-28');
    });
    await saveProperty('Category', async () => {
      await page.getByRole('button', { name: `Category for ${firstNote.title}` }).click();
      await page.getByRole('menuitemradio', { name: 'Reading' }).click();
    });
    await saveProperty('Topics', async () => {
      await page.getByRole('button', { name: `Topics for ${firstNote.title}` }).click();
      await page.getByRole('menuitemcheckbox', { name: 'Work' }).click();
    });
    await saveProperty('Labels', async () => {
      const labelTrigger = page.getByRole('button', { name: `Labels for ${firstNote.title}` });
      await labelTrigger.click();
      const labelDialog = page.getByRole('dialog', { name: 'Labels options' });
      await labelDialog.waitFor({ state: 'visible' });
      const labelSearch = page.getByRole('combobox', { name: 'Search Labels options' });
      assert.equal(await labelSearch.evaluate((element) => element === document.activeElement), true, 'Searchable option input did not receive focus');
      await labelSearch.fill('Alpha');
      await labelDialog.getByRole('option', { name: 'Alpha' }).waitFor({ state: 'visible' });
      await captureScreenshot(page, 'desktop-searchable-options');
      await labelSearch.press('ArrowDown');
      await labelSearch.press('Enter');
      await page.keyboard.press('Escape');
      await labelDialog.waitFor({ state: 'hidden' });
      assert.equal(await labelTrigger.evaluate((element) => element === document.activeElement), true, 'Option Popover did not restore focus to its trigger');
      assert.equal((await labelTrigger.textContent())?.includes('Alpha'), true, 'Selected long option was not summarized on the trigger');
    });
    for (const value of ['Initial row', '4.5', 'Yes', '2026-10-28', 'Reading', 'Work', 'Alpha']) {
      await page.getByText(value, { exact: true }).waitFor({ state: 'visible' });
    }

    await page.getByRole('button', { name: `Edit Summary for ${firstNote.title}` }).click();
    const staleDraft = 'Draft preserved after stale write';
    const summaryInput = page.getByRole('textbox', { name: `Summary for ${firstNote.title}` });
    await summaryInput.fill(staleDraft);
    const latestResponse = await fetch(`${baseUrl}/api/notes/${firstSummary.id}`);
    assert.equal(latestResponse.status, 200, 'Could not read note for deterministic concurrent edit');
    const latestNote = (await latestResponse.json()).note;
    const concurrentSave = await fetch(`${baseUrl}/api/notes/${firstSummary.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: latestNote.title,
        body: `${latestNote.body}\nConcurrent edit from smoke test.`,
        baseHash: latestNote.contentHash,
      }),
    });
    assert.equal(concurrentSave.status, 200, 'Could not create the deterministic stale-write condition');
    expectedStaleConflictWindow = true;
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText(/changed on disk/i).waitFor({ state: 'visible' });
    expectedStaleConflictWindow = false;
    assert.equal(await summaryInput.inputValue(), staleDraft, 'Stale write discarded the user draft');
    await page.getByRole('button', { name: 'Reload latest note, keep draft' }).click();
    await page.getByText(/Your draft is still here/i).waitFor({ state: 'visible' });
    assert.equal(await summaryInput.inputValue(), staleDraft, 'Reload did not keep the user draft');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Property saved.', { exact: true }).waitFor({ state: 'visible' });
    await page.getByText(staleDraft, { exact: true }).waitFor({ state: 'visible' });

    // Hold A's property request before it reaches the API, load B, then allow
    // the actual write to complete. This makes response ordering deterministic.
    let signalIntercepted;
    let releaseDelayedRequest;
    const intercepted = new Promise((resolve) => { signalIntercepted = resolve; });
    const held = new Promise((resolve) => { releaseDelayedRequest = resolve; });
    const delayedValue = 'Delayed database A response';
    const propertyUrl = `**/api/notes/${firstSummary.id}/properties`;
    const holdPropertyRequest = async (route) => {
      const body = route.request().postDataJSON();
      if (route.request().method() === 'PUT' && body.value === delayedValue) {
        signalIntercepted();
        await held;
      }
      await route.continue();
    };
    await page.route(propertyUrl, holdPropertyRequest);
    try {
      await page.getByRole('button', { name: `Edit Summary for ${firstNote.title}` }).click();
      await page.getByRole('textbox', { name: `Summary for ${firstNote.title}` }).fill(delayedValue);
      const delayedResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/notes/${firstSummary.id}/properties` &&
        response.request().method() === 'PUT',
      );
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await withTimeout(intercepted, 15_000, 'Deferred property write was never requested');
      await page.getByRole('button', { name: /Second empty database/ }).click();
      await page.getByRole('heading', { name: 'Second empty database' }).waitFor({ state: 'visible' });
      await page.getByText('No notes in this database yet', { exact: true }).waitFor({ state: 'visible' });
      releaseDelayedRequest();
      assert.equal((await delayedResponse).status(), 200, 'The delayed database A write did not complete');
      // The successful response belongs to A and must not replace B's empty view.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.getByText('No notes in this database yet', { exact: true }).waitFor({ state: 'visible' });
      assert.equal(await page.getByText('Property saved.', { exact: true }).count(), 0);
    } finally {
      releaseDelayedRequest();
      await page.unroute(propertyUrl, holdPropertyRequest);
    }
    await page.getByRole('button', { name: /Reading list/ }).click();
    await page.getByRole('heading', { name: 'Reading list' }).waitFor({ state: 'visible' });
    await page.getByText(delayedValue, { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('textbox', { name: `Summary for ${firstNote.title}` }).count(), 0, 'Database-scoped editor draft remained open after switching away');

    let signalFailureIntercepted;
    let releaseFailedRequest;
    const failureIntercepted = new Promise((resolve) => { signalFailureIntercepted = resolve; });
    const failedRequestHeld = new Promise((resolve) => { releaseFailedRequest = resolve; });
    const failedDraft = 'Draft from failed database A request';
    const failPropertyRequest = async (route) => {
      const body = route.request().postDataJSON();
      if (route.request().method() === 'PUT' && body.value === failedDraft) {
        signalFailureIntercepted();
        await failedRequestHeld;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'INJECTED_FAILURE', message: 'A failed request' } }),
        });
        return;
      }
      await route.continue();
    };
    await page.route(propertyUrl, failPropertyRequest);
    try {
      await page.getByRole('button', { name: `Edit Summary for ${firstNote.title}` }).click();
      await page.getByRole('textbox', { name: `Summary for ${firstNote.title}` }).fill(failedDraft);
      const failedResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/notes/${firstSummary.id}/properties` &&
        response.request().method() === 'PUT',
      );
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await withTimeout(failureIntercepted, 15_000, 'Failed property write was never requested');
      await page.getByRole('button', { name: /Second empty database/ }).click();
      await page.getByRole('heading', { name: 'Second empty database' }).waitFor({ state: 'visible' });
      await page.getByText('No notes in this database yet', { exact: true }).waitFor({ state: 'visible' });
      expectedInjectedFailureWindow = true;
      releaseFailedRequest();
      assert.equal((await failedResponse).status(), 500, 'The injected database A failure did not occur');
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expectedInjectedFailureWindow = false;
      assert.equal(await page.getByRole('alert').count(), 0, 'A failure message leaked into database B');
      await page.getByText('No notes in this database yet', { exact: true }).waitFor({ state: 'visible' });
    } finally {
      releaseFailedRequest();
      await page.unroute(propertyUrl, failPropertyRequest);
    }
    await page.getByRole('button', { name: /Reading list/ }).click();
    await page.getByRole('heading', { name: 'Reading list' }).waitFor({ state: 'visible' });
    const failedDraftInput = page.getByRole('textbox', { name: `Summary for ${firstNote.title}` });
    assert.equal(await failedDraftInput.count(), 0, 'Failed database A editor draft leaked across a selection change');

    await page.getByRole('button', { name: 'New database' }).click();
    const createSchemaSheet = page.getByRole('dialog', { name: 'New database schema' });
    await createSchemaSheet.waitFor({ state: 'visible' });
    const createSheetBox = await createSchemaSheet.boundingBox();
    assert(createSheetBox, 'Schema Sheet has no layout box');
    assert(createSheetBox.width >= 600 && createSheetBox.width <= 700, `Desktop schema Sheet width is unexpected: ${createSheetBox.width}`);
    const createSheetFooter = createSchemaSheet.locator('[data-slot="sheet-footer"]');
    const createFooterBox = await createSheetFooter.boundingBox();
    assert(createFooterBox, 'Schema Sheet footer has no layout box');
    assert(createFooterBox.y + createFooterBox.height <= 900, 'Schema Sheet footer is outside the viewport');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await createSchemaSheet.evaluate((dialog) => dialog.contains(document.activeElement)), true, 'Shift+Tab escaped the schema Sheet');
    await page.keyboard.press('Tab');
    assert.equal(await createSchemaSheet.evaluate((dialog) => dialog.contains(document.activeElement)), true, 'Tab escaped the schema Sheet');

    await page.getByRole('textbox', { name: 'Database name' }).fill('Browser schema');
    await page.getByRole('button', { name: 'Add property' }).click();
    await page.getByRole('textbox', { name: 'Property 1 name' }).fill('Description');
    await page.getByRole('button', { name: 'Add property' }).click();
    await page.getByRole('textbox', { name: 'Property 2 name' }).fill('Status');
    await page.getByRole('combobox', { name: 'Property 2 type' }).click();
    await page.getByRole('option', { name: 'Select', exact: true }).click();
    await page.getByRole('button', { name: 'Add option' }).click();
    await page.getByRole('textbox', { name: 'Status option 1' }).fill('Open');
    await page.getByRole('textbox', { name: 'Property 2 name' }).fill('Description');
    await captureScreenshot(page, 'desktop-schema-sheet');

    await page.setViewportSize({ width: 1280, height: 420 });
    const createSheetBody = createSchemaSheet.locator('div.overflow-y-auto').first();
    assert.equal(await createSheetBody.evaluate((element) => element.scrollHeight > element.clientHeight), true, 'Schema Sheet body did not become scrollable at a short viewport');
    const footerBeforeScroll = await createSheetFooter.boundingBox();
    await createSheetBody.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const footerAfterScroll = await createSheetFooter.boundingBox();
    assert(footerBeforeScroll && footerAfterScroll, 'Schema Sheet footer disappeared during scroll');
    assert(Math.abs(footerBeforeScroll.y - footerAfterScroll.y) < 1, 'Schema Sheet footer moved while the body scrolled');
    assert(footerAfterScroll.y + footerAfterScroll.height <= 420, 'Schema Sheet footer left the short viewport');
    await captureScreenshot(page, 'desktop-schema-sheet-short');
    await page.setViewportSize({ width: 1280, height: 900 });

    const createSchemaButton = createSchemaSheet.getByRole('button', { name: 'Create database' });
    await createSchemaButton.click();
    await page.getByRole('alert').getByText('Property names must be unique, ignoring case.').waitFor({ state: 'visible' });
    assert.equal(await createSchemaButton.getAttribute('aria-describedby'), 'database-schema-error', 'Schema error is not associated with the save action');
    assert.equal((await (await fetch(`${baseUrl}/api/databases`)).json()).databases.some((database) => database.name === 'Browser schema'), false, 'Invalid duplicate property names reached storage');
    await page.getByRole('textbox', { name: 'Property 2 name' }).fill('Status');
    const createSchemaResponse = page.waitForResponse((response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/databases');
    await createSchemaButton.click();
    assert.equal((await createSchemaResponse).status(), 201, 'Schema creation API request failed');
    await createSchemaSheet.waitFor({ state: 'hidden' });
    const schemaResponse = await fetch(`${baseUrl}/api/databases`);
    const createdSchemas = (await schemaResponse.json()).databases;
    const createdSchema = createdSchemas.find((database) => database.name === 'Browser schema');
    assert(createdSchema, 'Created schema was not returned by the API');
    const createdPropertyIds = createdSchema.properties.map((property) => property.id);
    const createdOptionId = createdSchema.properties[1].options[0].id;

    const editSchemaTrigger = page.getByRole('button', { name: 'Edit schema' });
    await editSchemaTrigger.click();
    const editSchemaSheet = page.getByRole('dialog', { name: 'Edit database schema' });
    await editSchemaSheet.waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await editSchemaSheet.waitFor({ state: 'hidden' });
    const editSchemaFocus = await page.evaluate(() => ({
      tag: document.activeElement?.tagName ?? null,
      label: document.activeElement?.getAttribute('aria-label') ?? null,
      text: document.activeElement?.textContent?.trim().slice(0, 80) ?? null,
    }));
    assert.equal(await editSchemaTrigger.evaluate((element) => element === document.activeElement), true, `Schema Sheet did not restore focus to its trigger: ${JSON.stringify(editSchemaFocus)}`);
    await editSchemaTrigger.click();
    await editSchemaSheet.waitFor({ state: 'visible' });
    await page.getByRole('textbox', { name: 'Database name' }).fill('Browser schema renamed');
    await page.getByRole('textbox', { name: 'Property 1 name' }).fill('Summary');
    await page.getByRole('textbox', { name: 'Status option 1' }).fill('In progress');
    const updateSchemaResponse = page.waitForResponse((response) =>
      response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/databases/${createdSchema.id}`);
    await page.getByRole('button', { name: 'Save schema' }).click();
    assert.equal((await updateSchemaResponse).status(), 200, 'Schema update API request failed');
    const savedSchemaText = await readFile(join(expectedVaultPath, 'databases', `${createdSchema.id}.json`), 'utf8');
    const savedSchema = JSON.parse(savedSchemaText);
    assert.equal(savedSchema.name, 'Browser schema renamed');
    assert.deepEqual(savedSchema.properties.map((property) => property.id), createdPropertyIds, 'Schema editing changed stable property IDs');
    assert.equal(savedSchema.properties[1].options[0].id, createdOptionId, 'Option rename changed its stable ID');
    assert.equal(savedSchema.properties[1].options[0].name, 'In progress');
    await page.getByRole('button', { name: 'Edit schema' }).click();
    await page.getByRole('button', { name: 'Add property' }).click();
    await page.getByRole('textbox', { name: 'Property 3 name' }).fill('Reviewed');
    await page.getByRole('combobox', { name: 'Property 3 type' }).click();
    await page.getByRole('option', { name: 'Checkbox', exact: true }).click();
    const appendPropertyResponse = page.waitForResponse((response) =>
      response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/databases/${createdSchema.id}`);
    await page.getByRole('button', { name: 'Save schema' }).click();
    assert.equal((await appendPropertyResponse).status(), 200, 'Adding a property to an existing schema failed');
    const appendedSchema = JSON.parse(await readFile(join(expectedVaultPath, 'databases', `${createdSchema.id}.json`), 'utf8'));
    assert.equal(appendedSchema.properties.length, 3);
    assert.deepEqual(appendedSchema.properties.slice(0, 2).map((property) => property.id), createdPropertyIds);
    assert.equal(appendedSchema.properties[2].name, 'Reviewed');

    // Narrow viewport checks: skip link, mobile drawer inertness/focus return,
    // Popover collision, Sheet width/footer, and persistence across reloads.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Note title' }).waitFor({ state: 'visible' });
    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', { name: 'Skip to content' });
    assert.equal(await skipLink.evaluate((element) => element === document.activeElement), true, 'Skip link was not the first Tab stop');
    await captureScreenshot(page, 'narrow-skip-link');
    await page.keyboard.press('Enter');
    assert.equal(new URL(page.url()).hash, '#main-content', 'Skip link did not navigate to main content');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'main-content', 'Skip link did not move focus to main content');

    const openNavigation = page.getByRole('button', { name: 'Open navigation' });
    await openNavigation.click();
    const mobileDrawer = page.getByRole('dialog', { name: 'Workspace navigation' });
    await mobileDrawer.waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.querySelector('main')?.hasAttribute('inert')), true, 'Main content was not inert while the mobile drawer was open');
    await captureScreenshot(page, 'narrow-mobile-drawer');
    await page.keyboard.press('Escape');
    await mobileDrawer.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.querySelector('main')?.hasAttribute('inert')), false, 'Main content stayed inert after closing the mobile drawer');
    assert.equal(await openNavigation.evaluate((element) => element === document.activeElement), true, 'Mobile drawer did not restore focus to its trigger');

    await openNavigation.click();
    await mobileDrawer.getByRole('button', { name: 'Databases' }).click();
    await page.getByRole('heading', { name: 'Databases' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: /Reading list/ }).click();
    await page.getByRole('heading', { name: 'Reading list' }).waitFor({ state: 'visible' });

    const narrowFilterTrigger = page.getByRole('button', { name: /^Filter rows/ });
    await narrowFilterTrigger.click();
    const narrowFiltersDialog = page.getByRole('dialog', { name: 'Filters' });
    await narrowFiltersDialog.waitFor({ state: 'visible' });
    const narrowFilterBox = await narrowFiltersDialog.boundingBox();
    assert(narrowFilterBox, 'Narrow filter Popover has no layout box');
    assert(narrowFilterBox.x >= 0 && narrowFilterBox.x + narrowFilterBox.width <= 390, 'Filter Popover overflowed the narrow viewport');
    await captureScreenshot(page, 'narrow-filter-popover');
    await page.keyboard.press('Escape');
    await narrowFiltersDialog.waitFor({ state: 'hidden' });
    assert.equal(await narrowFilterTrigger.evaluate((element) => element === document.activeElement), true, 'Narrow filter Popover did not restore focus');

    const narrowNewDatabase = page.getByRole('button', { name: 'New database' });
    await narrowNewDatabase.click();
    const narrowSchemaSheet = page.getByRole('dialog', { name: 'New database schema' });
    await narrowSchemaSheet.waitFor({ state: 'visible' });
    const narrowSheetBox = await narrowSchemaSheet.boundingBox();
    assert(narrowSheetBox, 'Narrow schema Sheet has no layout box');
    assert.equal(Math.round(narrowSheetBox.width), 390, `Narrow schema Sheet width is unexpected: ${narrowSheetBox.width}`);
    const narrowSheetFooter = narrowSchemaSheet.locator('[data-slot="sheet-footer"]');
    const narrowFooterBox = await narrowSheetFooter.boundingBox();
    assert(narrowFooterBox && narrowFooterBox.y + narrowFooterBox.height <= 844, 'Narrow schema Sheet footer is outside the viewport');
    await captureScreenshot(page, 'narrow-schema-sheet');
    await page.keyboard.press('Escape');
    await narrowSchemaSheet.waitFor({ state: 'hidden' });
    assert.equal(await narrowNewDatabase.evaluate((element) => element === document.activeElement), true, 'Narrow schema Sheet did not restore focus to its trigger');

    // Dark mode token check and desktop screenshot.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Note title' }).waitFor({ state: 'visible' });
    const toggleTheme = page.getByRole('button', { name: 'Switch to dark theme' });
    await toggleTheme.click();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true, 'Dark theme class was not applied');
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(28, 27, 25)', 'Dark theme background token was not applied');
    await page.getByRole('button', { name: 'Databases' }).click();
    await page.getByRole('heading', { name: 'Databases' }).waitFor({ state: 'visible' });
    await page.getByRole('heading', { name: 'Browser schema renamed' }).waitFor({ state: 'visible' });
    assert.equal(await page.getByText(/structured-data diagnostics?/i).count(), 0, 'Diagnostics from another database leaked into the selected database');
    await captureScreenshot(page, 'desktop-dark-databases');
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), false, 'Light theme did not restore the dark class');

    // Restore confirmation moves focus into the review region.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('heading', { name: 'Settings' }).waitFor({ state: 'visible' });
    await page.locator('#backup-source').fill(join(tempRoot, 'backup-review'));
    await page.getByRole('button', { name: /Review restore/ }).click();
    const restoreConfirmation = page.getByRole('group', { name: 'Confirm restore' });
    await restoreConfirmation.waitFor({ state: 'visible' });
    assert.equal(await restoreConfirmation.evaluate((element) => element === document.activeElement), true, 'Restore confirmation did not receive focus');
    await captureScreenshot(page, 'desktop-restore-confirmation');
    await restoreConfirmation.getByRole('button', { name: 'Cancel' }).click();
    await restoreConfirmation.waitFor({ state: 'hidden' });

    const expectedStaleResponse = `PUT /api/notes/${firstSummary.id}/properties: HTTP 409`;
    const expectedInjectedFailure = `PUT /api/notes/${firstSummary.id}/properties: HTTP 500`;
    const expectedRowsFailure = `GET ${rowPath}: HTTP 500`;
    const expectedSchemaMismatch = `GET ${rowPath}: HTTP 409`;
    const expectedApiFailures = new Set([expectedStaleResponse, expectedInjectedFailure, expectedRowsFailure, expectedSchemaMismatch]);
    assert.deepEqual(apiFailures.filter((failure) => !expectedApiFailures.has(failure)), [], 'Unexpected local API request failed');
    assert.deepEqual(browserErrors, [], 'Browser reported uncaught or console errors');
    console.log('Browser smoke passed: startup, note navigation/save/reload, structured properties, selection-scoped deferred row loads and mutations, filtering, column visibility, searchable options, viewport/Sheet layout, responsive focus behavior, and isolated API/filesystem persistence.');
  } catch (error) {
    console.error(`Browser errors: ${JSON.stringify(browserErrors)}`);
    console.error(`API failures: ${JSON.stringify(apiFailures)}`);
    if (page !== undefined) {
      await captureScreenshot(page, 'failure').catch(() => undefined);
      const bodyText = await page.locator('body').innerText().catch(() => '<unavailable>');
      console.error(`Page text at failure: ${bodyText.slice(0, 2_000)}`);
    }
    throw error;
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

async function expectDisabled(locator) {
  assert.equal(await locator.isDisabled(), true, 'Invalid structured data should disable property editing');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
