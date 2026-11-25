import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createBackup, restoreBackup } from '../src/storage/backup/backup.js';
import { exportVault } from '../src/storage/portable/export.js';
import { applyImport, planImport } from '../src/storage/portable/import.js';
import { createNote } from '../src/domain/note.js';
import { projectManagementTemplates } from '../src/database/project-templates.js';
import { serializeDatabaseView } from '../src/database/database-view.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import type { DatabaseTemplate, NoteTemplate } from '../src/database/templates.js';

const NOW = '2026-11-02T00:00:00Z';
const DB = '11111111-1111-4111-8111-111111111111';
const PROP = '22222222-2222-4222-8222-222222222222';
const TID = '33333333-3333-4333-8333-333333333333';

async function withApi(fn: (base: string, vault: FileSystemVault) => Promise<void>) {
  const parent = await mkdtemp(join(tmpdir(), 'nodus-template-api-'));
  const vaultPath = join(parent, 'vault'); const vault = await FileSystemVault.open(vaultPath);
  const middleware = createLocalApiMiddleware({ vaultPath, now: () => NOW });
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (typeof address !== 'object' || !address) throw new Error('No port');
  try { await fn(`http://127.0.0.1:${address.port}`, vault); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await rm(parent, { recursive: true, force: true }); }
}
async function json<T>(base: string, path: string, method = 'GET', body?: unknown) {
  const response = await fetch(base + path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() as T };
}

describe('template management API', () => {
  it('rejects stale capture reads and catalog writes after switching between empty vaults', async () => {
    await withApi(async (base, vault) => {
      const other = join(vault.root, '..', 'other');
      await mkdir(other);
      await vault.createDatabase({ id: DB, name: 'Source database', properties: [] });
      const vaultPath = vault.root;
      const query = new URLSearchParams({ vaultPath });
      expect((await json(base, `/api/databases/${DB}/views?${query}`)).status).toBe(200);
      expect((await json(base, `/api/databases/${DB}/rows?${query}`)).status).toBe(200);

      const switched = await json<{ vault: { path: string } }>(base, '/api/vault/open', 'POST', { path: other });
      expect(switched.status).toBe(200);
      for (const path of ['/api/templates', `/api/databases/${DB}/views`, `/api/databases/${DB}/rows`]) {
        expect(await json(base, `${path}?${query}`)).toMatchObject({
          status: 409, body: { error: { code: 'STALE_VAULT' } },
        });
      }
      const templates = projectManagementTemplates(NOW);
      expect(await json(base, '/api/templates', 'PUT', { templates, baseHash: null, vaultPath })).toMatchObject({
        status: 409, body: { error: { code: 'STALE_VAULT' } },
      });
      expect((await json(base, '/api/templates', 'PUT', { templates, baseHash: null })).status).toBe(400);
      expect((await json(base, '/api/templates')).body).toEqual({ templates: [], hash: null });
      expect(await vault.readTemplates()).toEqual({ templates: [], hash: null });
      const activePath = switched.body.vault.path;
      expect((await json(base, '/api/templates', 'PUT', { templates, baseHash: null, vaultPath: activePath })).status).toBe(200);
      expect(await json(base, '/api/templates', 'PUT', { templates: [], baseHash: null, vaultPath: activePath })).toMatchObject({
        status: 409, body: { error: { code: 'STALE_WRITE' } },
      });
    });
  });

  it('previews and applies note templates through the safe note path allocator', async () => {
    await withApi(async (base, vault) => {
      const now = NOW;
      const template: NoteTemplate = { id: TID, type: 'note', name: 'Daily', title: 'Daily {{day}}', body: '# Notes for {{day}}', tags: ['daily'], aliases: [], frontmatter: {}, variables: [{ name: 'day', type: 'date', required: true }], createdAt: now, updatedAt: now };
      const saved = await json<{ hash: string }>(base, '/api/templates', 'PUT', { templates: [template], baseHash: null, vaultPath: vault.root });
      expect(saved.status).toBe(200);
      const invalid = await json<{ error: { code: string } }>(base, `/api/templates/${TID}/preview`, 'POST', { variables: { day: 'soon' } });
      expect(invalid.status).toBe(422);
      const preview = await json<{ resolved: { title: string } }>(base, `/api/templates/${TID}/preview`, 'POST', { variables: { day: '2026-11-02' } });
      expect(preview.body.resolved.title).toBe('Daily 2026-11-02');
      expect(await vault.listNotes()).toHaveLength(0);
      const first = await json<{ note: { id: string; title: string } }>(base, `/api/templates/${TID}/apply`, 'POST', { variables: { day: '2026-11-02' } });
      const second = await json<{ note: { id: string; path: string } }>(base, `/api/templates/${TID}/apply`, 'POST', { variables: { day: '2026-11-02' } });
      expect(first.status).toBe(201); expect(second.status).toBe(201);
      expect(second.body.note.id).not.toBe(first.body.note.id);
      expect(second.body.note.path).not.toBe('notes/daily-2026-11-02.md');
      expect((await vault.listNotes()).length).toBe(2);
    });
  });

  it('clones database schemas, saved views, and valid starter rows with fresh database identity', async () => {
    await withApi(async (base, vault) => {
      const database = { id: DB, name: 'Tasks', properties: [{ id: PROP, name: 'Priority', type: 'number' as const }] };
      const view = { id: '77777777-7777-4777-8777-777777777777', databaseId: DB, name: 'All tasks', sort: { propertyId: 'title' as const, direction: 'asc' as const }, filters: [], visiblePropertyIds: [PROP] };
      const template: DatabaseTemplate = { id: TID, type: 'database', name: 'Task starter', database, views: [view], starterRows: [{ title: 'Example task', values: { [PROP]: 2 } }], createdAt: NOW, updatedAt: NOW };
      const saved = await json(base, '/api/templates', 'PUT', { templates: [template], baseHash: null, vaultPath: vault.root });
      expect(saved.status).toBe(200);
      const preview = await json(base, `/api/templates/${TID}/preview`, 'POST', {});
      expect(preview.status).toBe(200);
      expect(await vault.listDatabases()).toHaveLength(0);
      expect(await vault.listNotes()).toHaveLength(0);
      const applied = await json<{ databaseId: string; report: { databases: number; notes: number } }>(base, `/api/templates/${TID}/apply`, 'POST', {});
      expect(applied.status).toBe(201);
      expect(applied.body.databaseId).not.toBe(DB);
      expect(applied.body.report).toMatchObject({ databases: 1, notes: 1 });
      expect(await vault.listDatabases()).toHaveLength(1);
      expect(await vault.listNotes()).toHaveLength(1);
      expect(await vault.listDatabaseViews(applied.body.databaseId)).toHaveLength(1);
      const invalid = { ...template, id: '44444444-4444-4444-8444-444444444444', starterRows: [{ title: 'Bad', values: { [PROP]: 'high' } }] };
      const invalidSave = await json<{ error: { code: string } }>(base, '/api/templates', 'PUT', { templates: [invalid], baseHash: (saved.body as { hash: string }).hash, vaultPath: vault.root });
      expect(invalidSave.status).toBe(422);
    });
  });

  it.each(['backup', 'portable'] as const)('applies widths from a template restored through %s', async (kind) => {
    await withApi(async (base, vault) => {
      const source = await FileSystemVault.open(join(vault.root, '..', 'source'));
      const archive = join(vault.root, '..', 'archive');
      const template: DatabaseTemplate = {
        id: TID, type: 'database', name: 'With widths',
        database: { id: DB, name: 'Width table', properties: [{ id: PROP, name: 'Estimate', type: 'number' }] },
        views: [{
          id: '77777777-7777-4777-8777-777777777777', databaseId: DB, name: 'Table',
          type: 'table', settings: { columnWidths: { [PROP]: 288 } },
          sort: { propertyId: 'title', direction: 'asc' }, filters: [], visiblePropertyIds: [PROP],
        }],
        starterRows: [], createdAt: NOW, updatedAt: NOW,
      };
      await source.writeTemplates([template], null);
      if (kind === 'backup') {
        await createBackup(source, archive);
        await restoreBackup(archive, vault.root);
      } else {
        await exportVault(source, archive);
        await applyImport(vault, await planImport(archive));
      }
      const applied = await json<{ databaseId: string }>(base, `/api/templates/${TID}/apply`, 'POST', {});
      expect(applied.status).toBe(201);
      expect(await vault.listDatabaseViews(applied.body.databaseId)).toMatchObject([{
        view: { databaseId: applied.body.databaseId, settings: { columnWidths: { [PROP]: 288 } } },
      }]);
    });
  });

  it('preserves project templates, saved views and linked work items across both archive paths', async () => {
    await withApi(async (base, source) => {
      const [projects, workItems] = projectManagementTemplates(NOW);
      if (!projects || !workItems) throw new Error('Both starter templates are required');
      expect(workItems.database.properties.every(({ type }) => type !== 'relation')).toBe(true);
      expect(workItems.views.every((view) => JSON.parse(serializeDatabaseView(view)).version < 4)).toBe(true);
      const saved = await json(base, '/api/templates', 'PUT', { templates: [projects, workItems], baseHash: null, vaultPath: source.root });
      expect(saved.status).toBe(200);
      const apply = async (id: string) => {
        const result = await json<{ databaseId: string }>(base, `/api/templates/${id}/apply`, 'POST', {});
        expect(result.status).toBe(201);
        return result.body.databaseId;
      };
      const projectDb = await apply(projects.id);
      const workDb = await apply(workItems.id);
      expect(projectDb).not.toBe(projects.database.id);
      expect(workDb).not.toBe(workItems.database.id);
      const schema = await source.readDatabaseWithHash(workDb);
      const relationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const linked = { ...schema.database, properties: [...schema.database.properties, {
        id: relationId, name: 'Project', type: 'relation' as const,
        relation: { databaseId: projectDb, cardinality: 'one' as const },
      }] };
      expect((await json(base, `/api/databases/${workDb}`, 'PUT', { database: linked, baseHash: schema.hash })).status).toBe(200);

      const project = createNote({ id: DB, title: 'Project', path: 'project.md', body: 'Project brief', now: NOW });
      const item = createNote({ id: PROP, title: 'Bug', path: 'bug.md', body: 'Steps to reproduce', now: NOW });
      const addRecord = async (note: typeof project, databaseId: string, values: Record<string, unknown>) => {
        await source.createNote({ ...note, extraFrontmatter: {
          nodus_data: { format: 'nodus-note-properties', version: 1, databases: { [databaseId]: values } },
        } });
      };
      await addRecord(project, projectDb, {});
      const type = workItems.database.properties.find(({ name }) => name === 'Type');
      const bug = type?.options?.find(({ name }) => name === 'Bug');
      if (!type || !bug) throw new Error('Bug type is required');
      const values = { [relationId]: project.id, [type.id]: bug.id };
      await addRecord(item, workDb, values);

      for (const kind of ['backup', 'portable'] as const) {
        const archive = join(source.root, '..', kind);
        const target = await FileSystemVault.open(join(source.root, '..', `${kind}-target`));
        if (kind === 'backup') {
          await createBackup(source, archive);
          await restoreBackup(archive, target.root);
        } else {
          await exportVault(source, archive);
          const plan = await planImport(archive);
          expect(plan.portableManifest?.formats.databaseView).toBe(3);
          await applyImport(target, plan);
        }
        expect((await target.readTemplates()).templates).toEqual((await source.readTemplates()).templates);
        expect(await target.readDatabase(workDb)).toEqual(linked);
        expect((await target.listDatabaseViews(workDb)).map(({ view }) => view)).toEqual(
          (await source.listDatabaseViews(workDb)).map(({ view }) => view),
        );
        const restoredItem = await target.readNote(item.id);
        expect(restoredItem.body).toBe(item.body);
        expect(restoredItem.extraFrontmatter).toMatchObject({ nodus_data: { databases: { [workDb]: values } } });
        expect((await target.readNote(project.id)).body).toBe(project.body);
      }
    });
  });

  it('rolls back a failed database template apply so an explicit retry creates one complete database', async () => {
    await withApi(async (base, vault) => {
      const database = { id: DB, name: 'Tasks', properties: [{ id: PROP, name: 'Priority', type: 'number' as const }] };
      const template: DatabaseTemplate = { id: TID, type: 'database', name: 'Task starter', database, views: [], starterRows: [{ title: 'Example task', values: { [PROP]: 2 } }], createdAt: NOW, updatedAt: NOW };
      expect((await json(base, '/api/templates', 'PUT', { templates: [template], baseHash: null, vaultPath: vault.root })).status).toBe(200);

      const prototype = FileSystemVault.prototype as unknown as {
        publishTemplateTransactionFile(this: FileSystemVault, staged: string, target: string, relativePath: string): Promise<void>;
      };
      const original = prototype.publishTemplateTransactionFile;
      let calls = 0;
      const spy = vi.spyOn(prototype, 'publishTemplateTransactionFile').mockImplementation(async function (this: FileSystemVault, staged: string, target: string, relativePath: string) {
        calls += 1;
        if (calls === 2) throw Object.assign(new Error('injected second file failure'), { code: 'EIO' });
        return original.call(this, staged, target, relativePath);
      });
      try {
        const failed = await json<{ error: { code: string } }>(base, `/api/templates/${TID}/apply`, 'POST', {});
        expect(failed.status).toBe(500);
        expect(await vault.listDatabases()).toEqual([]);
        expect(await vault.listNotes()).toEqual([]);
        expect((await vault.checkHealth()).issues).toEqual([]);
      } finally { spy.mockRestore(); }

      const retry = await json<{ databaseId: string }>(base, `/api/templates/${TID}/apply`, 'POST', {});
      expect(retry.status).toBe(201);
      expect(await vault.listDatabases()).toHaveLength(1);
      expect(await vault.listNotes()).toHaveLength(1);
    });
  });
});
