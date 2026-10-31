import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNote, type Note } from '../src/domain/note.js';
import { projectIncomingRelations } from '../src/database/relations.js';
import type { DatabaseDefinition } from '../src/database/schema.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import type { UiRelationBacklinksResponse } from '../src/ui-server/dto.js';
import { withTempDir } from './tmp.js';

const id = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SOURCE_DB = id(1);
const TARGET_DB = id(2);
const OTHER_DB = id(3);
const FORWARD = id(4);
const REVERSE = id(5);
const TARGET = id(10);
const SOURCE_A = id(11);
const SOURCE_B = id(12);

const sourceSchema = (): DatabaseDefinition => ({
  id: SOURCE_DB,
  name: 'Projects',
  properties: [{
    id: FORWARD, name: 'Related task', type: 'relation',
    relation: { databaseId: TARGET_DB, cardinality: 'many' },
  }],
});
const targetSchema: DatabaseDefinition = {
  id: TARGET_DB,
  name: 'Tasks',
  properties: [{ id: REVERSE, name: 'Projects', type: 'relation', relation: { databaseId: SOURCE_DB, cardinality: 'many', reversePropertyId: FORWARD } }],
};
const targetSchemaWithoutReciprocal: DatabaseDefinition = { id: TARGET_DB, name: 'Tasks', properties: [] };
const otherSchema: DatabaseDefinition = { id: OTHER_DB, name: 'Archive', properties: [] };

function record(noteId: string, title: string, path: string, databases: Record<string, Record<string, unknown>>): Note {
  const note = createNote({ id: noteId, title, path, body: '', now: '2026-10-30T00:00:00Z' });
  return { ...note, extraFrontmatter: { nodus_data: { format: 'nodus-note-properties', version: 1, databases } } };
}

function api(vaultPath: string): Promise<{ server: Server; base: string }> {
  const middleware = createLocalApiMiddleware({ vaultPath });
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  return new Promise((resolve, reject) => server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') { reject(new Error('No test port')); return; }
    resolve({ server, base: `http://127.0.0.1:${address.port}` });
  }));
}

async function stop(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

describe('incoming database relation backlinks', () => {
  it('derives multiple incoming relations with reciprocal configuration and stable source identity', () => {
    const notes = [
      record(TARGET, 'Same title', 'tasks/target.md', { [TARGET_DB]: {} }),
      record(SOURCE_A, 'Same title', 'projects/a.md', { [SOURCE_DB]: { [FORWARD]: [TARGET] } }),
      record(SOURCE_B, 'Another project', 'projects/b.md', { [SOURCE_DB]: { [FORWARD]: [TARGET] } }),
    ];
    const backlinks = projectIncomingRelations(notes, new Map([[SOURCE_DB, sourceSchema()], [TARGET_DB, targetSchema]])).get(TARGET);
    expect(backlinks).toHaveLength(2);
    expect(backlinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceId: SOURCE_A, sourceTitle: 'Same title', sourcePath: 'projects/a.md', sourceDatabaseName: 'Projects', propertyName: 'Related task', reciprocalPropertyName: 'Projects', status: 'resolved' }),
      expect.objectContaining({ sourceId: SOURCE_B, status: 'resolved' }),
    ]));
  });

  it('shows incoming links without claiming a reciprocal property exists', () => {
    const notes = [record(TARGET, 'Task', 'tasks/task.md', { [TARGET_DB]: {} }), record(SOURCE_A, 'Project', 'projects/p.md', { [SOURCE_DB]: { [FORWARD]: [TARGET] } })];
    const backlinks = projectIncomingRelations(notes, new Map([[SOURCE_DB, sourceSchema()], [TARGET_DB, targetSchemaWithoutReciprocal]])).get(TARGET);
    expect(backlinks).toHaveLength(1);
    expect(backlinks![0]).not.toHaveProperty('reciprocalPropertyName');
    expect(backlinks![0]).toMatchObject({ status: 'resolved', propertyName: 'Related task' });
  });

  it('preserves incompatible references to a moved target and drops deleted sources or targets from projection', () => {
    const source = record(SOURCE_A, 'Project', 'projects/p.md', { [SOURCE_DB]: { [FORWARD]: [TARGET] } });
    const movedTarget = record(TARGET, 'Task', 'archive/task.md', { [OTHER_DB]: {} });
    const backlinks = projectIncomingRelations([source, movedTarget], new Map([[SOURCE_DB, sourceSchema()], [TARGET_DB, targetSchema], [OTHER_DB, otherSchema]])).get(TARGET);
    expect(backlinks).toHaveLength(1);
    expect(backlinks![0]).toMatchObject({ sourceId: SOURCE_A, status: 'incompatible' });
    expect(projectIncomingRelations([movedTarget], new Map([[SOURCE_DB, sourceSchema()], [TARGET_DB, targetSchema], [OTHER_DB, otherSchema]])).get(TARGET)).toBeUndefined();
    expect(projectIncomingRelations([source], new Map([[SOURCE_DB, sourceSchema()], [TARGET_DB, targetSchema]])).get(TARGET)).toBeUndefined();
  });

  it('serves incoming links and invalidates its snapshot after schema and source-note changes', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(join(dir, 'vault'));
      await vault.createDatabase(sourceSchema());
      await vault.createDatabase(targetSchema);
      await vault.createNote(record(TARGET, 'Task', 'tasks/task.md', { [TARGET_DB]: {} }));
      await vault.createNote(record(SOURCE_A, 'Project', 'projects/project.md', { [SOURCE_DB]: { [FORWARD]: [TARGET] } }));
      const started = await api(vault.root);
      try {
        const initial = await fetch(`${started.base}/api/notes/${TARGET}/relation-backlinks`).then((response) => response.json()) as UiRelationBacklinksResponse;
        expect(initial.backlinks).toHaveLength(1);
        expect(initial.backlinks[0]).toMatchObject({ sourceId: SOURCE_A, reciprocalPropertyName: 'Projects', status: 'resolved' });

        const currentSchema = await vault.readDatabaseWithHash(TARGET_DB);
        const schemaUpdate = await fetch(`${started.base}/api/databases/${TARGET_DB}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ database: targetSchemaWithoutReciprocal, baseHash: currentSchema.hash }),
        });
        expect(schemaUpdate.ok).toBe(true);
        const afterSchemaChange = await fetch(`${started.base}/api/notes/${TARGET}/relation-backlinks`).then((response) => response.json()) as UiRelationBacklinksResponse;
        expect(afterSchemaChange.backlinks).toHaveLength(1);
        expect(afterSchemaChange.backlinks[0]).not.toHaveProperty('reciprocalPropertyName');

        const source = await vault.readNoteWithHash(SOURCE_A);
        await vault.deleteNote(SOURCE_A, { expectedHash: source.hash });
        const afterDelete = await fetch(`${started.base}/api/notes/${TARGET}/relation-backlinks?refresh=true`).then((response) => response.json()) as UiRelationBacklinksResponse;
        expect(afterDelete.backlinks).toEqual([]);

        const missingTarget = await fetch(`${started.base}/api/notes/${SOURCE_A}/relation-backlinks`);
        expect(missingTarget.status).toBe(404);
      } finally {
        await stop(started.server);
      }
    });
  });

  it('keeps source rows when their target database was deleted and marks the backlink incompatible', () => {
    const notes = [record(TARGET, 'Unassigned note', 'notes/target.md', {}), record(SOURCE_A, 'Project', 'projects/p.md', { [SOURCE_DB]: { [FORWARD]: [TARGET] } })];
    const backlinks = projectIncomingRelations(notes, new Map([[SOURCE_DB, sourceSchema()]])).get(TARGET);
    expect(backlinks).toHaveLength(1);
    expect(backlinks![0]).toMatchObject({ status: 'incompatible', sourceId: SOURCE_A });
  });
});
