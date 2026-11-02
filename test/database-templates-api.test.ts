import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileSystemVault } from '../src/storage/fs/vault.js';
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
  it('previews and applies note templates through the safe note path allocator', async () => {
    await withApi(async (base, vault) => {
      const now = NOW;
      const template: NoteTemplate = { id: TID, type: 'note', name: 'Daily', title: 'Daily {{day}}', body: '# Notes for {{day}}', tags: ['daily'], aliases: [], frontmatter: {}, variables: [{ name: 'day', type: 'date', required: true }], createdAt: now, updatedAt: now };
      const saved = await json<{ hash: string }>(base, '/api/templates', 'PUT', { templates: [template], baseHash: null });
      expect(saved.status).toBe(200);
      const invalid = await json<{ error: { code: string } }>(base, `/api/templates/${TID}/preview`, 'POST', { variables: { day: 'soon' } });
      expect(invalid.status).toBe(422);
      const preview = await json<{ resolved: { title: string } }>(base, `/api/templates/${TID}/preview`, 'POST', { variables: { day: '2026-11-02' } });
      expect(preview.body.resolved.title).toBe('Daily 2026-11-02');
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
      const template: DatabaseTemplate = { id: TID, type: 'database', name: 'Task starter', database, views: [], starterRows: [{ title: 'Example task', values: { [PROP]: 2 } }], createdAt: NOW, updatedAt: NOW };
      const saved = await json(base, '/api/templates', 'PUT', { templates: [template], baseHash: null });
      expect(saved.status).toBe(200);
      const applied = await json<{ databaseId: string; report: { databases: number; notes: number } }>(base, `/api/templates/${TID}/apply`, 'POST', {});
      expect(applied.status).toBe(201);
      expect(applied.body.databaseId).not.toBe(DB);
      expect(applied.body.report).toMatchObject({ databases: 1, notes: 1 });
      expect(await vault.listDatabases()).toHaveLength(1);
      expect(await vault.listNotes()).toHaveLength(1);
      const invalid = { ...template, id: '44444444-4444-4444-8444-444444444444', starterRows: [{ title: 'Bad', values: { [PROP]: 'high' } }] };
      const invalidSave = await json<{ error: { code: string } }>(base, '/api/templates', 'PUT', { templates: [invalid], baseHash: (saved.body as { hash: string }).hash });
      expect(invalidSave.status).toBe(422);
    });
  });
});
