import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import type { DatabaseDefinition } from '../src/database/schema.js';
import type { DatabaseView } from '../src/database/database-view.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import { withTempDir } from './tmp.js';

const NOW = '2026-11-03T09:00:00Z';
const NOTE = '11111111-1111-4111-8111-111111111111';
const DB = '22222222-2222-4222-8222-222222222222';
const VIEW = '33333333-3333-4333-8333-333333333333';
const START = '44444444-4444-4444-8444-444444444444';
const END = '55555555-5555-4555-8555-555555555555';
const OTHER = '66666666-6666-4666-8666-666666666666';

async function startApi(root: string) {
  const middleware = createLocalApiMiddleware({ vaultPath: root, now: () => NOW });
  const server = createServer((req, res) => middleware(req, res, () => res.end()));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  return {
    base: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await middleware.dispose();
    },
  };
}

async function putRange(base: string, noteId: string, input: Record<string, unknown>) {
  const response = await fetch(`${base}/api/notes/${noteId}/calendar-range`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
  return { status: response.status, body: await response.json() as { error?: { code: string; message: string } } };
}

function definition(): DatabaseDefinition {
  return { id: DB, name: 'Calendar data', properties: [
    { id: START, name: 'Start', type: 'date' },
    { id: END, name: 'End', type: 'date' },
    { id: OTHER, name: 'Text', type: 'text' },
  ] };
}

function calendarView(settings: DatabaseView['settings']): DatabaseView {
  return { id: VIEW, databaseId: DB, name: 'Calendar', type: 'calendar', settings: settings!, sort: { propertyId: 'title', direction: 'asc' }, filters: [], visiblePropertyIds: [] };
}

async function fixture(root: string, settings: DatabaseView['settings'] = { startDatePropertyId: START, endDatePropertyId: END }) {
  const vault = await FileSystemVault.open(root);
  await vault.createDatabase(definition());
  await vault.createDatabaseView(calendarView(settings));
  await vault.createNote({
    ...createNote({ id: NOTE, title: 'Calendar row', path: 'calendar-row.md', body: 'Keep body\n', now: NOW }),
    extraFrontmatter: {
      icon: '📅', unrelated: { keep: true },
      nodus_data: { format: 'nodus-note-properties', version: 1, databases: { [DB]: { [START]: '2026-11-10', [END]: '2026-11-12', [OTHER]: 'keep' } } },
    },
  });
  return vault;
}

describe('Calendar range editing API', () => {
  it('accepts newly created Calendar views with start and optional end properties in the v3 envelope', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createDatabase(definition());
      const api = await startApi(root);
      try {
        const response = await fetch(`${api.base}/api/databases/${DB}/views`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ view: calendarView({ startDatePropertyId: START, endDatePropertyId: END }) }),
        });
        expect(response.status).toBe(201);
        const created = await response.json() as { view: { view: DatabaseView } };
        expect(created.view.view.settings).toEqual({ startDatePropertyId: START, endDatePropertyId: END });
        const persisted = await vault.readDatabaseView(DB, VIEW);
        expect(persisted.view.settings).toEqual({ startDatePropertyId: START, endDatePropertyId: END });
      } finally { await api.close(); vault.dispose(); }
    });
  });

  it('writes a configured range atomically, preserves unrelated data, and refreshes the row projection', async () => {
    await withTempDir(async (root) => {
      const vault = await fixture(root);
      const api = await startApi(root);
      try {
        const current = await vault.readNoteWithHash(NOTE);
        const saved = await putRange(api.base, NOTE, { databaseId: DB, viewId: VIEW, startDatePropertyId: START, startDate: '2026-11-15', endDatePropertyId: END, endDate: '2026-11-17', baseHash: current.hash });
        expect(saved.status).toBe(200);
        const updated = await vault.readNoteWithHash(NOTE);
        expect(updated.note.extraFrontmatter).toMatchObject({ icon: '📅', unrelated: { keep: true }, nodus_data: { databases: { [DB]: { [START]: '2026-11-15', [END]: '2026-11-17', [OTHER]: 'keep' } } } });
        expect(updated.note.body).toBe('Keep body\n');
        const rows = await fetch(`${api.base}/api/databases/${DB}/rows`).then((result) => result.json()) as { rows: Array<{ noteId: string; values: Record<string, unknown> }> };
        expect(rows.rows.find((row) => row.noteId === NOTE)?.values).toMatchObject({ [START]: '2026-11-15', [END]: '2026-11-17', [OTHER]: 'keep' });
      } finally { await api.close(); vault.dispose(); }
    });
  });

  it('supports legacy single-date configuration and start-only configuration', async () => {
    for (const settings of [{ datePropertyId: START }, { startDatePropertyId: START }]) {
      await withTempDir(async (root) => {
        const vault = await fixture(root, settings);
        const api = await startApi(root);
        try {
          const current = await vault.readNoteWithHash(NOTE);
          const saved = await putRange(api.base, NOTE, { databaseId: DB, viewId: VIEW, startDatePropertyId: START, startDate: '2026-11-21', baseHash: current.hash });
          expect(saved.status).toBe(200);
          expect((await vault.readNote(NOTE)).extraFrontmatter.nodus_data).toMatchObject({ databases: { [DB]: { [START]: '2026-11-21', [END]: '2026-11-12' } } });
        } finally { await api.close(); vault.dispose(); }
      });
    }
  });

  it('rejects reversed or malformed dates without changing any source bytes', async () => {
    await withTempDir(async (root) => {
      const vault = await fixture(root);
      const api = await startApi(root);
      try {
        const current = await vault.readNoteWithHash(NOTE);
        const reversed = await putRange(api.base, NOTE, { databaseId: DB, viewId: VIEW, startDatePropertyId: START, startDate: '2026-11-20', endDatePropertyId: END, endDate: '2026-11-19', baseHash: current.hash });
        expect(reversed).toMatchObject({ status: 422, body: { error: { code: 'INVALID_DATE_RANGE' } } });
        const malformed = await putRange(api.base, NOTE, { databaseId: DB, viewId: VIEW, startDatePropertyId: START, startDate: '2026-02-30', endDatePropertyId: END, endDate: '2026-03-01', baseHash: current.hash });
        expect(malformed.status).toBe(422);
        expect((await vault.readNoteWithHash(NOTE)).hash).toBe(current.hash);
      } finally { await api.close(); vault.dispose(); }
    });
  });

  it('rejects stale revisions and properties outside the saved Calendar configuration', async () => {
    await withTempDir(async (root) => {
      const vault = await fixture(root);
      const api = await startApi(root);
      try {
        const current = await vault.readNoteWithHash(NOTE);
        await vault.replaceNote({ ...current.note, body: 'Concurrent edit\n' }, { expectedHash: current.hash });
        const stale = await putRange(api.base, NOTE, { databaseId: DB, viewId: VIEW, startDatePropertyId: START, startDate: '2026-11-15', endDatePropertyId: END, endDate: '2026-11-17', baseHash: current.hash });
        expect(stale).toMatchObject({ status: 409, body: { error: { code: 'STALE_WRITE' } } });
        const fresh = await vault.readNoteWithHash(NOTE);
        const wrongProperty = await putRange(api.base, NOTE, { databaseId: DB, viewId: VIEW, startDatePropertyId: OTHER, startDate: '2026-11-15', endDatePropertyId: END, endDate: '2026-11-17', baseHash: fresh.hash });
        expect(wrongProperty).toMatchObject({ status: 409, body: { error: { code: 'CALENDAR_CONFIGURATION_CHANGED' } } });
        expect((await vault.readNoteWithHash(NOTE)).note.body).toBe('Concurrent edit\n');
      } finally { await api.close(); vault.dispose(); }
    });
  });

  it('rejects a configured property removed from the schema or changed to a non-date type', async () => {
    for (const replacement of [
      { id: DB, name: 'Calendar data', properties: [{ id: END, name: 'End', type: 'date' as const }, { id: OTHER, name: 'Text', type: 'text' as const }] },
      { id: DB, name: 'Calendar data', properties: [{ id: START, name: 'Start', type: 'text' as const }, { id: END, name: 'End', type: 'date' as const }, { id: OTHER, name: 'Text', type: 'text' as const }] },
    ]) {
      await withTempDir(async (root) => {
        const vault = await fixture(root);
        const api = await startApi(root);
        try {
          const schema = await vault.readDatabaseWithHash(DB);
          await vault.replaceDatabase(replacement, { expectedHash: schema.hash });
          const current = await vault.readNoteWithHash(NOTE);
          const rejected = await putRange(api.base, NOTE, { databaseId: DB, viewId: VIEW, startDatePropertyId: START, startDate: '2026-11-15', endDatePropertyId: END, endDate: '2026-11-17', baseHash: current.hash });
          expect(rejected.status).toBe(422);
          expect((await vault.readNoteWithHash(NOTE)).hash).toBe(current.hash);
        } finally { await api.close(); vault.dispose(); }
      });
    }
  });

  it('rejects a saved-view revision changed after the editor loaded it', async () => {
    await withTempDir(async (root) => {
      const vault = await fixture(root);
      try {
        const [view, schema, note] = await Promise.all([
          vault.readDatabaseView(DB, VIEW), vault.readDatabaseWithHash(DB), vault.readNoteWithHash(NOTE),
        ]);
        await vault.replaceDatabaseView(calendarView({ startDatePropertyId: START }), { expectedHash: view.hash, expectedDatabaseHash: schema.hash });
        await expect(vault.setNotePropertiesAtomically(NOTE, [{ databaseId: DB, propertyId: START, value: '2026-11-15' }], {
          expectedHash: note.hash, now: NOW,
          calendarView: { databaseId: DB, viewId: VIEW, startDatePropertyId: START, endDatePropertyId: END, expectedViewHash: view.hash },
        })).rejects.toMatchObject({ code: 'STALE_WRITE' });
        expect((await vault.readNoteWithHash(NOTE)).hash).toBe(note.hash);
      } finally { vault.dispose(); }
    });
  });
});
