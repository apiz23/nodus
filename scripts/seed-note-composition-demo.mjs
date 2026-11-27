#!/usr/bin/env node
/**
 * Seed a disposable vault for the Markdown note-composition prototype.
 *
 * Writes ordinary Nodus files only: notes with `nodus_data` properties,
 * `databases/*.json` schemas and `database-views/**` saved views. No new
 * storage format, no code path in the app is involved.
 *
 *   node scripts/seed-note-composition-demo.mjs /tmp/nodus-composition-demo
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const target = resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  console.error('Usage: node scripts/seed-note-composition-demo.mjs <empty-or-missing-directory>');
  process.exit(2);
}
try {
  await access(join(target, 'notes'));
  console.error(`Refusing to overwrite existing vault at ${target}`);
  process.exit(2);
} catch {
  // Missing is expected.
}

const D = {
  docs: '11111111-1111-4111-8111-111111111111',
  bugs: '22222222-2222-4222-8222-222222222222',
  tests: '33333333-3333-4333-8333-333333333333',
};
const V = {
  docs: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  bugs: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  testsStaging: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  testsModule: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
  testsBoard: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
  testsCalendar: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4',
};
const P = {
  docsItem: 'd0000001-0000-4000-8000-000000000001',
  docsType: 'd0000001-0000-4000-8000-000000000002',
  docsStatus: 'd0000001-0000-4000-8000-000000000003',
  docsOwner: 'd0000001-0000-4000-8000-000000000004',
  bugSeverity: 'd0000002-0000-4000-8000-000000000001',
  bugStatus: 'd0000002-0000-4000-8000-000000000002',
  bugVersion: 'd0000002-0000-4000-8000-000000000003',
  bugReported: 'd0000002-0000-4000-8000-000000000004',
  testModule: 'd0000003-0000-4000-8000-000000000001',
  testStatus: 'd0000003-0000-4000-8000-000000000002',
  testVersion: 'd0000003-0000-4000-8000-000000000003',
  testPriority: 'd0000003-0000-4000-8000-000000000004',
  testDue: 'd0000003-0000-4000-8000-000000000005',
};
const O = {
  uiCheck: 'e0000001-0000-4000-8000-000000000001',
  userManual: 'e0000001-0000-4000-8000-000000000002',
  docsNotStarted: 'e0000001-0000-4000-8000-000000000003',
  docsDone: 'e0000001-0000-4000-8000-000000000004',
  critical: 'e0000002-0000-4000-8000-000000000011',
  high: 'e0000002-0000-4000-8000-000000000012',
  medium: 'e0000002-0000-4000-8000-000000000013',
  low: 'e0000002-0000-4000-8000-000000000014',
  bugNotStarted: 'e0000002-0000-4000-8000-000000000015',
  bugVerify: 'e0000002-0000-4000-8000-000000000016',
  bugInProgress: 'e0000002-0000-4000-8000-000000000017',
  bugDone: 'e0000002-0000-4000-8000-000000000018',
  uiModule: 'e0000003-0000-4000-8000-000000000021',
  dataModule: 'e0000003-0000-4000-8000-000000000022',
  testNotStarted: 'e0000003-0000-4000-8000-000000000023',
  testInProgress: 'e0000003-0000-4000-8000-000000000024',
  testDone: 'e0000003-0000-4000-8000-000000000025',
  testHigh: 'e0000003-0000-4000-8000-000000000026',
  testMedium: 'e0000003-0000-4000-8000-000000000027',
  testLow: 'e0000003-0000-4000-8000-000000000028',
};
const select = (id, name) => ({ id, name });

const databases = [
  {
    format: 'nodus-database', version: 1, id: D.docs, name: 'Docs & UI checklist',
    properties: [
      { id: P.docsItem, name: 'Item', type: 'text' },
      { id: P.docsType, name: 'Type', type: 'select', options: [select(O.uiCheck, 'UI Check'), select(O.userManual, 'User Manual')] },
      { id: P.docsStatus, name: 'Status', type: 'select', options: [select(O.docsNotStarted, 'Not started'), select(O.docsDone, 'Done')] },
      { id: P.docsOwner, name: 'Owner', type: 'text' },
    ],
  },
  {
    format: 'nodus-database', version: 1, id: D.bugs, name: 'Bug tracker',
    properties: [
      { id: P.bugSeverity, name: 'Severity', type: 'select', options: [select(O.critical, 'Critical'), select(O.high, 'High'), select(O.medium, 'Medium'), select(O.low, 'Low')] },
      { id: P.bugStatus, name: 'Status', type: 'select', options: [select(O.bugNotStarted, 'Not started'), select(O.bugVerify, 'To Verify/Test'), select(O.bugInProgress, 'In progress'), select(O.bugDone, 'Done')] },
      { id: P.bugVersion, name: 'Version', type: 'text' },
      { id: P.bugReported, name: 'Reported', type: 'date' },
    ],
  },
  {
    format: 'nodus-database', version: 1, id: D.tests, name: 'Test case repository',
    properties: [
      { id: P.testModule, name: 'Module', type: 'select', options: [select(O.uiModule, 'UI Check'), select(O.dataModule, 'Data Testing')] },
      { id: P.testStatus, name: 'Status', type: 'select', options: [select(O.testNotStarted, 'Not started'), select(O.testInProgress, 'In progress'), select(O.testDone, 'Done')] },
      { id: P.testVersion, name: 'Version', type: 'text' },
      { id: P.testPriority, name: 'Priority', type: 'select', options: [select(O.testHigh, 'High'), select(O.testMedium, 'Medium'), select(O.testLow, 'Low')] },
      { id: P.testDue, name: 'Due', type: 'date' },
    ],
  },
];

const views = [
  {
    format: 'nodus-database-view', version: 4, id: V.docs, databaseId: D.docs, name: 'Docs & UI (O\'Zone)',
    type: 'table', settings: {}, sort: { propertyId: 'title', direction: 'asc' }, sorts: [{ propertyId: 'title', direction: 'asc' }],
    filters: [], visiblePropertyIds: [P.docsType, P.docsStatus, P.docsOwner],
  },
  {
    format: 'nodus-database-view', version: 4, id: V.bugs, databaseId: D.bugs, name: 'Staging bugs',
    type: 'table', settings: {}, sort: { propertyId: P.bugSeverity, direction: 'asc' }, sorts: [{ propertyId: P.bugSeverity, direction: 'asc' }],
    filters: [], visiblePropertyIds: [P.bugSeverity, P.bugStatus, P.bugVersion, P.bugReported],
  },
  {
    format: 'nodus-database-view', version: 4, id: V.testsStaging, databaseId: D.tests, name: 'Staging checklist (v1.1.1)',
    type: 'table', settings: {}, sort: { propertyId: P.testStatus, direction: 'asc' }, sorts: [{ propertyId: P.testStatus, direction: 'asc' }],
    filters: [{ id: 'f0000001-0000-4000-8000-000000000001', propertyId: P.testVersion, operator: 'equals', value: 'v1.1.1' }],
    visiblePropertyIds: [P.testModule, P.testStatus, P.testPriority, P.testVersion],
  },
  {
    format: 'nodus-database-view', version: 4, id: V.testsModule, databaseId: D.tests, name: 'All tests, newest first',
    type: 'table', settings: {}, sort: { propertyId: 'title', direction: 'desc' }, sorts: [{ propertyId: 'title', direction: 'desc' }],
    filters: [], visiblePropertyIds: [P.testModule, P.testPriority, P.testVersion],
  },
  {
    format: 'nodus-database-view', version: 4, id: V.testsBoard, databaseId: D.tests, name: 'Stage board',
    type: 'kanban', settings: { groupPropertyId: P.testStatus }, sort: { propertyId: 'title', direction: 'asc' },
    sorts: [{ propertyId: 'title', direction: 'asc' }], filters: [], visiblePropertyIds: [P.testModule, P.testPriority],
  },
  {
    format: 'nodus-database-view', version: 4, id: V.testsCalendar, databaseId: D.tests, name: 'Due calendar',
    type: 'calendar', settings: { startDatePropertyId: P.testDue }, sort: { propertyId: P.testDue, direction: 'asc' },
    sorts: [{ propertyId: P.testDue, direction: 'asc' }], filters: [], visiblePropertyIds: [P.testStatus, P.testPriority],
  },
];

const docsRows = [
  ['Upload button gradient matches the approved design', O.uiCheck, O.docsNotStarted, 'Adam'],
  ['Tamil sign-out label overflows the button', O.uiCheck, O.docsNotStarted, 'Adam'],
  ['Subtitle clips in mobile portrait', O.uiCheck, O.docsDone, 'Hafiz'],
  ['Operator handbook covers the strike appeal', O.userManual, O.docsNotStarted, 'QA lead'],
  ['Release note lists the new mail templates', O.userManual, O.docsDone, 'QA lead'],
];
const bugRows = [
  ['Android Back reopens a deep link instead of leaving', O.high, O.bugInProgress, 'v1.1.1', '2026-11-25'],
  ['iPad overflow menu clips in landscape', O.low, O.bugNotStarted, 'v1.1.1', '2026-11-24'],
  ['Report queue drops the reporter name', O.medium, O.bugNotStarted, 'v1.1.1', '2026-11-24'],
  ['Account name visible for one second after sign-out', O.low, O.bugVerify, 'v1.1.0', '2026-11-24'],
  ['Comment filter allows the middle-finger emoji', O.medium, O.bugDone, 'v1.1.1', '2026-11-20'],
];
const testRows = [
  ['Store build on production', O.uiModule, O.testNotStarted, 'v1.1.1', O.testHigh, '2026-11-18'],
  ['Update over the store build', O.uiModule, O.testNotStarted, 'v1.1.1', O.testHigh, '2026-11-20'],
  ['Offline cache keeps the last feed', O.dataModule, O.testDone, 'v1.1.1', O.testLow, '2026-11-20'],
  ['iPad menus stay inside the viewport', O.uiModule, O.testNotStarted, 'v1.1.1', O.testLow, '2026-11-24'],
  ['Report a comment and find it in the operator queue', O.dataModule, O.testInProgress, 'v1.1.1', O.testHigh, '2026-11-25'],
  ['Account info clears after sign-out (previous build)', O.uiModule, O.testInProgress, 'v1.1.0', O.testLow, '2026-11-26'],
];

let counter = 1;
function noteId() {
  const suffix = String(counter++).padStart(12, '0');
  return `f0000000-0000-4000-8000-${suffix}`;
}

function note(title, body, databases) {
  const now = '2026-11-27T00:00:00Z';
  const data = Object.entries(databases).map(([databaseId, values]) => {
    const lines = Object.entries(values).map(([propertyId, value]) => `      ${propertyId}: ${typeof value === 'string' ? value : String(value)}`);
    return `    ${databaseId}:\n${lines.join('\n')}`;
  }).join('\n');
  return `---
title: ${title}
nodus:
  version: 1
  id: ${noteId()}
  createdAt: ${now}
  updatedAt: ${now}
nodus_data:
  format: nodus-note-properties
  version: 1
  databases:
${data}
---

${body}
`;
}

const rowNotes = [
  ...docsRows.map(([title, type, status, owner]) => note(title, `# ${title}\n\nChecklist item seeded for the note-composition demo.`, {
    [D.docs]: { [P.docsType]: type, [P.docsStatus]: status, [P.docsOwner]: owner },
  })),
  ...bugRows.map(([title, severity, status, version, reported]) => note(title, `# ${title}\n\nBug seeded for the note-composition demo.`, {
    [D.bugs]: { [P.bugSeverity]: severity, [P.bugStatus]: status, [P.bugVersion]: version, [P.bugReported]: reported },
  })),
  ...testRows.map(([title, module, status, version, priority, due]) => note(title, `# ${title}\n\nTest case seeded for the note-composition demo.`, {
    [D.tests]: { [P.testModule]: module, [P.testStatus]: status, [P.testVersion]: version, [P.testPriority]: priority, [P.testDue]: due },
  })),
];

const demoBody = `# Note composition

This is an ordinary Markdown note. The prose, headings and links are normal Markdown; the three blocks below are saved database views embedded by reference. Rows stay in their database notes, so this page holds no duplicated records.

## Documentation & UI checklist

\`\`\`nodus-view
database: ${D.docs}
view: ${V.docs}
height: 240
\`\`\`

## Bug tracker

\`\`\`nodus-view
database: ${D.bugs}
view: ${V.bugs}
\`\`\`

## Test cases for this release

\`\`\`nodus-view
database: ${D.tests}
view: ${V.testsStaging}
height: 280
\`\`\`

The same database can appear again with a different saved view and its own height:

\`\`\`nodus-view
database: ${D.tests}
view: ${V.testsModule}
height: 200
\`\`\`

## The same rows as a board

\`\`\`nodus-view
database: ${D.tests}
view: ${V.testsBoard}
height: 360
\`\`\`

## And as a calendar

\`\`\`nodus-view
database: ${D.tests}
view: ${V.testsCalendar}
height: 420
\`\`\`

## Why this is not a block editor

Each fence is plain text. Edit it in the source pane, preview it on the right, and any Markdown viewer without Nodus support still sees a fenced code block.
`;

const edgeBody = `# Embed edge cases

Malformed directive:

\`\`\`nodus-view
database: not-a-uuid
view: ${V.docs}
\`\`\`

Missing database:

\`\`\`nodus-view
database: 99999999-9999-4999-8999-999999999999
view: ${V.docs}
\`\`\`

Missing saved view:

\`\`\`nodus-view
database: ${D.docs}
view: 88888888-8888-4888-8888-888888888888
\`\`\`

Unrelated code fence still renders as code:

\`\`\`js
const untouched = true;
\`\`\`
`;

const files = [
  ['notes/Demo/Note composition.md', note('Note composition', demoBody, {})],
  ['notes/Demo/Embed edge cases.md', note('Embed edge cases', edgeBody, {})],
  ...rowNotes.map((content, index) => [`notes/Demo/Rows/row-${String(index + 1).padStart(2, '0')}.md`, content]),
];

await mkdir(join(target, 'databases'), { recursive: true });
await mkdir(join(target, 'notes', 'Demo', 'Rows'), { recursive: true });
for (const database of databases) {
  await writeFile(join(target, 'databases', `${database.id}.json`), `${JSON.stringify(database, null, 2)}\n`);
}
for (const view of views) {
  await mkdir(join(target, 'database-views', view.databaseId), { recursive: true });
  await writeFile(join(target, 'database-views', view.databaseId, `${view.id}.json`), `${JSON.stringify(view, null, 2)}\n`);
}
for (const [path, content] of files) {
  const absolute = join(target, path);
  await mkdir(join(absolute, '..'), { recursive: true });
  await writeFile(absolute, content);
}

console.log(`Seeded ${target}`);
console.log(`  demo: notes/Demo/Note composition.md`);
console.log(`  edge cases: notes/Demo/Embed edge cases.md`);
console.log(`  databases: ${databases.length}, views: ${views.length}, rows: ${rowNotes.length}`);
