import { createServer } from 'node:http';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createNote, type Note } from '../src/domain/note.js';
import type { DatabaseDefinition } from '../src/database/schema.js';
import { projectRelations } from '../src/database/relations.js';
import type { UiDatabase, UiDatabaseRowsResponse } from '../src/ui-server/dto.js';
import { withTempDir } from './tmp.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PROJECTS = id(1), TASKS = id(2), ARCHIVE = id(3);
const REL = id(4), TEXT = id(5), TASK_TITLE = id(6);
const P1 = id(10), T1 = id(11), T2 = id(12), A1 = id(13);
const NOW = '2026-11-01T00:00:00Z';

const projects = (cardinality: 'one' | 'many'): DatabaseDefinition => ({
  id: PROJECTS, name: 'Projects',
  properties: [{ id: REL, name: 'Related tasks', type: 'relation', relation: { databaseId: TASKS, cardinality } }],
});
const tasks: DatabaseDefinition = { id: TASKS, name: 'Tasks', properties: [{ id: TEXT, name: 'Summary', type: 'text' }, { id: TASK_TITLE, name: 'Code', type: 'text' }] };
const archive: DatabaseDefinition = { id: ARCHIVE, name: 'Archive', properties: [] };

function record(noteId: string, title: string, path: string, databaseId?: string, values: Record<string, unknown> = {}): Note {
  const note = createNote({ id: noteId, title, path, body: 'Body\n', now: NOW });
  return databaseId === undefined ? note : { ...note, extraFrontmatter: { nodus_data: { format: 'nodus-note-properties', version: 1, databases: { [databaseId]: values } } } };
}

async function start(vaultPath: string) {
  const middleware = createLocalApiMiddleware({ vaultPath, now: () => NOW });
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  return { server, base: `http://127.0.0.1:${address.port}`, middleware };
}

async function stop(started: Awaited<ReturnType<typeof start>>) {
  started.server.closeAllConnections();
  await new Promise<void>((resolve, reject) => started.server.close((error) => error ? reject(error) : resolve()));
  started.middleware.dispose();
}

async function call<T>(base: string, path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, {
    method: init?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  return { status: response.status, body: await response.json() as T };
}

describe('relation property lifecycle through the local API', () => {
  it('creates and updates configuration, isolates candidates, persists across restart, and survives target deletion', async () => {
    await withTempDir(async (dir) => {
      const root = join(dir, 'vault');
      const vault = await FileSystemVault.open(root);
      await vault.createDatabase(projects('many'));
      await vault.createDatabase(tasks);
      await vault.createDatabase(archive);
      for (const note of [
        record(P1, 'Project One', 'projects/one.md', PROJECTS),
        record(T1, 'Task One', 'tasks/one.md', TASKS, { [TEXT]: 'First' }),
        record(T2, 'Task Two', 'tasks/two.md', TASKS, { [TEXT]: 'Second' }),
        record(A1, 'Archived note', 'archive/one.md', ARCHIVE),
      ]) await vault.createNote(note);

      const started = await start(root);
      try {
        const databases = await call<{ databases: UiDatabase[] }>(started.base, '/api/databases');
        expect(databases.status).toBe(200);
        expect(databases.body.databases.find((database) => database.id === PROJECTS)?.properties[0]).toMatchObject({
          type: 'relation', relation: { databaseId: TASKS, cardinality: 'many' },
        });

        // Update relation configuration through the existing schema endpoint.
        const current = await vault.readDatabaseWithHash(PROJECTS);
        const updated = await call<{ database: UiDatabase }>(started.base, `/api/databases/${PROJECTS}`, {
          method: 'PUT',
          body: { database: projects('one'), baseHash: current.hash },
        });
        expect(updated.status, JSON.stringify(updated.body)).toBe(200);
        expect(updated.body.database.properties[0]?.relation).toMatchObject({ databaseId: TASKS, cardinality: 'one' });
        const one = await vault.readDatabaseWithHash(PROJECTS);
        const restored = await call<{ database: UiDatabase }>(started.base, `/api/databases/${PROJECTS}`, {
          method: 'PUT',
          body: { database: projects('many'), baseHash: one.hash },
        });
        expect(restored.status).toBe(200);

        const rows = async () => (await call<UiDatabaseRowsResponse>(started.base, `/api/databases/${PROJECTS}/rows`)).body;
        const before = await rows();
        expect(before.relationCandidates?.[TASKS]?.map((note) => note.id)).toEqual([T1, T2]);
        expect(before.relationCandidates?.[TASKS]?.some((note) => note.id === A1)).toBe(false);
        expect(before.relationCandidates?.[ARCHIVE]).toBeUndefined();

        const search = async (query: string, limit = 20) => call<{ candidates: Array<{ id: string; title: string }>; truncated: boolean }>(
          started.base,
          `/api/databases/${PROJECTS}/relation-candidates?propertyId=${REL}&query=${encodeURIComponent(query)}&limit=${limit}`,
        );
        const first = await search('Task');
        expect(first.status, JSON.stringify(first.body)).toBe(200);
        expect(first.body.candidates.map((candidate) => candidate.id)).toEqual([T1, T2]);
        expect(first.body.truncated).toBe(false);
        const bounded = await search('Task', 1);
        expect(bounded.body.candidates.map((candidate) => candidate.id)).toEqual([T1]);
        expect(bounded.body.truncated).toBe(true);
        expect((await search('Archived')).body.candidates).toEqual([]);
        expect((await search('', 1)).body.candidates.map((candidate) => candidate.id)).toEqual([T1]);
        expect((await call(started.base, `/api/databases/${PROJECTS}/relation-candidates?propertyId=${TEXT}&query=Task`)).status).toBe(400);
        expect((await call(started.base, `/api/databases/${PROJECTS}/relation-candidates?propertyId=${id(999)}&query=Task`)).status).toBe(400);
        expect((await call(started.base, `/api/databases/${PROJECTS}/relation-candidates?propertyId=${REL}&query=Task&limit=0`)).status).toBe(400);
        expect((await call(started.base, `/api/databases/${PROJECTS}/relation-candidates?propertyId=${REL}&query=Task&limit=51`)).status).toBe(400);
        expect((await call(started.base, `/api/databases/${PROJECTS}/relation-candidates?propertyId=${REL}&query=${'a'.repeat(201)}`)).status).toBe(400);
        expect((await call(started.base, `/api/databases/${PROJECTS}/relation-candidates?query=Task`)).status).toBe(400);

        const project = await vault.readNoteWithHash(P1);
        const linked = await call<{ rows: Array<{ values: Record<string, unknown> }> }>(started.base, `/api/notes/${P1}/properties`, {
          method: 'PUT',
          body: { databaseId: PROJECTS, propertyId: REL, value: [T1, T2], baseHash: project.hash },
        });
        expect(linked.status, JSON.stringify(linked.body)).toBe(200);
        const linkedRow = (await rows()).rows.find((row) => row.noteId === P1)!;
        expect(linkedRow.relations?.[REL]?.map((reference) => reference.title)).toEqual(['Task One', 'Task Two']);

        for (const [value, code] of [[[A1], 'INCOMPATIBLE_TARGET'], [[id(999)], 'MISSING_TARGET'], [[T1, T1], 'INVALID_VALUE']] as const) {
          const fresh = await vault.readNoteWithHash(P1);
          const rejected = await call<{ error: { structuredDataIssues: Array<{ code: string }> } }>(started.base, `/api/notes/${P1}/properties`, {
            method: 'PUT',
            body: { databaseId: PROJECTS, propertyId: REL, value, baseHash: fresh.hash },
          });
          expect(rejected.status).toBe(422);
          expect(rejected.body.error.structuredDataIssues).toContainEqual(expect.objectContaining({ code }));
          expect(await readFile(join(root, fresh.note.path), 'utf8')).toBe(fresh.text);
        }

        const stale = await call(started.base, `/api/notes/${P1}/properties`, {
          method: 'PUT',
          body: { databaseId: PROJECTS, propertyId: REL, value: [T1], baseHash: project.hash },
        });
        expect(stale.status).toBe(409);
      } finally {
        await stop(started);
      }

      // Reopening the vault must preserve the forward relation by stable note IDs.
      const reopened = await FileSystemVault.open(root);
      const schemas = new Map([
        [PROJECTS, await reopened.readDatabase(PROJECTS)],
        [TASKS, await reopened.readDatabase(TASKS)],
        [ARCHIVE, await reopened.readDatabase(ARCHIVE)],
      ]);
      const notes = await reopened.snapshotNotes();
      const graph = projectRelations(notes, schemas);
      expect(graph.rows.get(P1)?.get(PROJECTS)?.values[REL]).toEqual([T1, T2]);
      expect(graph.rows.get(P1)?.get(PROJECTS)?.relations[REL]?.map((reference) => reference.status)).toEqual(['resolved', 'resolved']);

      // Renaming and moving linked records keeps the stable references.
      const renamed = await reopened.readNoteWithHash(T1);
      const moved = await reopened.moveNote(T1, 'moved/task.md', { expectedHash: renamed.hash });
      const movedHash = await reopened.readNoteWithHash(T1);
      await reopened.replaceNote({ ...moved, title: 'Renamed Task' }, { expectedHash: movedHash.hash });
      const movedGraph = projectRelations(await reopened.snapshotNotes(), schemas);
      expect(movedGraph.rows.get(P1)?.get(PROJECTS)?.relations[REL]?.[0]).toMatchObject({ id: T1, title: 'Renamed Task', path: 'moved/task.md' });

      // Deleting the target database preserves the stored reference and reports a configuration diagnostic.
      await reopened.deleteDatabase(TASKS);
      const afterDelete = await start(root);
      try {
        const response = await call<UiDatabaseRowsResponse>(afterDelete.base, `/api/databases/${PROJECTS}/rows`);
        expect(response.status).toBe(200);
        const row = response.body.rows.find((item) => item.noteId === P1)!;
        expect(row.values[REL]).toEqual([T1, T2]);
        expect(response.body.diagnostics.some((issue) => issue.code === 'INVALID_CONFIGURATION')).toBe(true);
        expect(response.body.relationCandidates?.[TASKS]).toEqual([]);
        const missingTarget = await call<{ error: { code: string } }>(afterDelete.base, `/api/databases/${PROJECTS}/relation-candidates?propertyId=${REL}&query=Task`);
        expect(missingTarget.status).toBe(422);
        expect(missingTarget.body.error.code).toBe('INVALID_CONFIGURATION');
      } finally {
        await stop(afterDelete);
      }
    });
  });
});
