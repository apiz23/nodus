import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { serializeNote } from '../src/format/note-format.js';
import type { DatabaseDefinition } from '../src/database/schema.js';
import type { DatabaseView } from '../src/database/database-view.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { exportVault } from '../src/storage/portable/export.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import { withTempDir } from './tmp.js';

const NOW = '2026-11-04T00:00:00Z';
const NOTE_ID = '2a4c6e80-1357-4b9d-8e0f-123456789abc';
const RELATED_NOTE_ID = '3b4c6e80-1357-4b9d-8e0f-123456789abc';
const PATH_COLLISION_TARGET_ID = '4c4c6e80-1357-4b9d-8e0f-123456789abc';
const PATH_COLLISION_SOURCE_ID = '5d4c6e80-1357-4b9d-8e0f-123456789abc';
const NEW_NOTE_ID = '6e4c6e80-1357-4b9d-8e0f-123456789abc';
const DB_ID = '7f4c6e80-1357-4b9d-8e0f-123456789abc';
const DATE_ID = '8a4c6e80-1357-4b9d-8e0f-123456789abc';
const VIEW_ID = '9b4c6e80-1357-4b9d-8e0f-123456789abc';
const DB2_ID = '9a4c6e80-1357-4b9d-8e0f-123456789abc';
const RELATION_ID = 'aa4c6e80-1357-4b9d-8e0f-123456789abc';

async function inventory(root: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await inventory(root, path));
    else result.push(`${path}:${createHash('sha256').update(await readFile(join(root, path))).digest('hex')}`);
  }
  return result.sort();
}

async function request<T>(base: string, dir: string) {
  const response = await fetch(`${base}/api/import/preview`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir }),
  });
  return { status: response.status, body: await response.json() as T };
}

async function execute<T>(base: string, body: unknown) {
  const response = await fetch(`${base}/api/import/execute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as T };
}

describe('POST /api/import/preview', () => {
  it('previews portable, legacy, malformed, missing, disallowed, and invalid sources without importing', async () => {
    await withTempDir(async (root) => {
      const activePath = join(root, 'workspace');
      const active = await FileSystemVault.open(activePath);
      const existing = createNote({ id: NOTE_ID, title: 'Existing', path: 'notes/source.md', body: 'keep me', now: NOW });
      await active.createNote({ ...existing, extraFrontmatter: { nodus_data: { format: 'nodus-note-properties', version: 1, databases: { [DB_ID]: { [DATE_ID]: '2026-11-04', [RELATION_ID]: ['bb4c6e80-1357-4b9d-8e0f-123456789abc'] } } } } });
      const relatedNote = createNote({ id: RELATED_NOTE_ID, title: 'Related row', path: 'notes/related.md', body: 'relation target', now: NOW });
      await active.createNote(relatedNote);
      await active.createNote(createNote({ id: PATH_COLLISION_TARGET_ID, title: 'Existing path owner', path: 'notes/path-collision.md', body: 'keep', now: NOW }));
      const db: DatabaseDefinition = { id: DB_ID, name: 'Calendar data', properties: [{ id: DATE_ID, name: 'Date', type: 'date' }, { id: RELATION_ID, name: 'Related row', type: 'relation', relation: { databaseId: DB2_ID, cardinality: 'many' } }] };
      await active.createDatabase(db);
      await active.createDatabase({ id: DB2_ID, name: 'Related rows', properties: [{ id: 'cc4c6e80-1357-4b9d-8e0f-123456789abc', name: 'Name', type: 'text' }] });
      const view: DatabaseView = { id: VIEW_ID, databaseId: DB_ID, name: 'Calendar', type: 'calendar', settings: { startDatePropertyId: DATE_ID }, sort: { propertyId: 'title', direction: 'asc' }, sorts: [{ propertyId: 'title', direction: 'asc' }], filters: [], visiblePropertyIds: [DATE_ID] };
      await active.createDatabaseView(view);
      await active.mutatePropertyCatalog({ type: 'create-property', property: { id: '7e4c6e80-1357-4b9d-8e0f-123456789abc', key: 'category', name: 'Category', type: 'text' } }, null);
      await active.createAttachment('preview.txt', Buffer.from('attachment bytes'));
      await active.writeTemplates([{ id: '8f4c6e80-1357-4b9d-8e0f-123456789abc', type: 'note', name: 'Seed template', title: 'Template', body: 'Body', tags: [], aliases: [], frontmatter: {}, variables: [], createdAt: NOW, updatedAt: NOW }], null);
      await active.writeDatabaseAutomations([], null);
      const backupPath = join(root, 'local-backup', 'preserve.txt');
      await mkdir(join(root, 'local-backup'));
      await writeFile(backupPath, 'backup stays unchanged');
      const preferencesPath = join(root, 'app-preferences.json');
      await writeFile(preferencesPath, JSON.stringify({ preserve: 'app-level settings' }));

      const source = await FileSystemVault.open(join(root, 'source'));
      await source.createNote(createNote({ id: NOTE_ID, title: 'Incoming', path: 'notes/source.md', body: 'incoming content', now: NOW }));
      await source.createNote(relatedNote);
      await source.createNote(createNote({ id: PATH_COLLISION_SOURCE_ID, title: 'Different ID', path: 'notes/path-collision.md', body: 'incoming path conflict', now: NOW }));
      await source.createNote(createNote({ id: NEW_NOTE_ID, title: 'New note', path: 'notes/new.md', body: 'new resource', now: NOW }));
      await writeFile(join(source.root, 'ignored.csv'), 'a,b\n1,2\n');
      const portableDir = join(root, 'portable');
      await exportVault(source, portableDir, { now: NOW });
      const legacyDir = join(root, 'legacy');
      await mkdir(join(legacyDir, 'notes'), { recursive: true });
      await writeFile(join(legacyDir, 'notes', 'legacy.md'), serializeNote(createNote({ id: '3b4c6e80-1357-4b9d-8e0f-123456789abc', title: 'Legacy', path: 'notes/legacy.md', body: 'old package', now: NOW })));

      const middleware = createLocalApiMiddleware({ vaultPath: activePath, preferencesPath, now: () => NOW });
      const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test API address');
      const base = `http://127.0.0.1:${address.port}`;
      const malformedDir = join(root, 'malformed');
      await mkdir(malformedDir);
      await writeFile(join(malformedDir, 'nodus-export.json'), '{broken');
      const stableTarget = await inventory(activePath);
      const backupBefore = createHash('sha256').update(await readFile(backupPath)).digest('hex');
      const preferencesBefore = createHash('sha256').update(await readFile(preferencesPath)).digest('hex');
      expect(stableTarget.some((item) => item.startsWith('databases/'))).toBe(true);
      expect(stableTarget.some((item) => item.startsWith('database-views/'))).toBe(true);
      expect(stableTarget.some((item) => item.startsWith('properties/'))).toBe(true);
      expect(stableTarget.some((item) => item.startsWith('attachments/'))).toBe(true);
      expect(stableTarget.some((item) => item.startsWith('.nodus-templates/'))).toBe(true);
      expect(stableTarget.some((item) => item.startsWith('.nodus-automations/'))).toBe(true);
      try {
      const portable = await request<{ format: string; manifestVersion: number; previewId: string; expiresAt: string; counts: { notes: number }; resources: Array<{ status: string; safeChoices: string[] }>; conflicts: Array<{ status: string; safeChoices: string[] }>; warnings: string[] }>(base, portableDir);
        expect(portable.status).toBe(200);
        expect(portable.body).toMatchObject({ format: 'nodus-portable-export', manifestVersion: 1, counts: { notes: 4 } });
        expect(portable.body.previewId).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(Date.parse(portable.body.expiresAt)).toBeGreaterThan(Date.parse(NOW));
        expect(portable.body.resources.map((resource) => resource.status).sort()).toEqual(['conflict', 'conflict', 'identical', 'new']);
        expect(portable.body.conflicts.map((resource) => resource.safeChoices).sort((a, b) => a.length - b.length)).toEqual([['skip'], ['skip', 'replace']]);
        expect(portable.body.warnings.some((warning) => warning.includes('ignored.csv') || warning.includes('excluded from source export'))).toBe(true);

        const legacy = await request<{ format: string; counts: { notes: number }; errors: string[] }>(base, legacyDir);
        expect(legacy.status).toBe(200);
        expect(legacy.body).toMatchObject({ format: 'legacy-directory', counts: { notes: 1 }, errors: [] });

        const malformed = await request<{ error: { code: string; message: string; paths?: string[] } }>(base, malformedDir);
        expect(malformed.status).toBe(422);
        expect(malformed.body.error.code).toBe('INVALID_CONTENT');
        expect(malformed.body.error.message).toMatch(/manifest.*malformed/i);

        const missing = await request<{ error: { code: string } }>(base, join(root, 'not-found'));
        expect(missing.status).toBe(404);
        expect(missing.body.error.code).toBe('NOT_FOUND');

        const outside = await request<{ error: { code: string } }>(base, join(tmpdir(), 'nodus-import-preview-outside-allowed-root'));
        expect(outside.status).toBe(403);
        expect(outside.body.error.code).toBe('BACKUP_TARGET_NOT_ALLOWED');

        const invalidPath = await request<{ error: { code: string; message: string } }>(base, 'relative/source');
        expect(invalidPath.status).toBe(400);
        expect(invalidPath.body.error.code).toBe('INVALID_INPUT');
        expect(invalidPath.body.error.message).toMatch(/absolute/i);

        expect(await inventory(activePath)).toEqual(stableTarget);
        expect(createHash('sha256').update(await readFile(backupPath)).digest('hex')).toBe(backupBefore);
        expect(createHash('sha256').update(await readFile(preferencesPath)).digest('hex')).toBe(preferencesBefore);
        expect((await active.readNote(NOTE_ID)).body).toBe('keep me');
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        await middleware.dispose();
        source.dispose();
        active.dispose();
      }
    });
  });

  it('returns structured validation issues for invalid source content', async () => {
    await withTempDir(async (root) => {
      const vaultPath = join(root, 'workspace');
      await FileSystemVault.open(vaultPath);
      const legacyDir = join(root, 'invalid-legacy');
      await mkdir(join(legacyDir, 'databases'), { recursive: true });
      await writeFile(join(legacyDir, 'databases', '33333333-3333-4333-8333-333333333333.json'), '{broken');
      const middleware = createLocalApiMiddleware({ vaultPath, now: () => NOW });
      const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test API address');
      try {
        const response = await request<{ error: { code: string; message: string; issues?: string[]; paths?: string[] } }>(`http://127.0.0.1:${address.port}`, legacyDir);
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe('INVALID_CONTENT');
        expect(response.body.error.message).toBeTruthy();
        expect(response.body.error.paths?.some((path) => path.includes('33333333-3333-4333-8333-333333333333.json'))).toBe(true);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        await middleware.dispose();
      }
    });
  });
});

describe('POST /api/import/execute', () => {
  it('publishes only the explicit choices bound to a fresh preview and rejects handle reuse', async () => {
    await withTempDir(async (root) => {
      const activePath = join(root, 'workspace');
      const active = await FileSystemVault.open(activePath);
      const source = await FileSystemVault.open(join(root, 'source'));
      await source.createNote(createNote({ id: NEW_NOTE_ID, title: 'Incoming item', path: 'notes/new.md', body: 'incoming', now: NOW }));
      const portableDir = join(root, 'portable');
      await exportVault(source, portableDir, { now: NOW });
      const middleware = createLocalApiMiddleware({ vaultPath: activePath, now: () => NOW });
      const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test API address');
      const base = `http://127.0.0.1:${address.port}`;
      try {
        const preview = await request<{ previewId: string; resources: Array<{ kind: string; id: string; path: string; status: string; safeChoices: string[] }> }>(base, portableDir);
        expect(preview.status).toBe(200);
        const resource = preview.body.resources.find((item) => item.id === NEW_NOTE_ID)!;
        expect(resource.status).toBe('new');
        const decisions = preview.body.resources.map((item) => ({ kind: item.kind, id: item.id, path: item.path, choice: item.id === NEW_NOTE_ID ? 'add' : 'skip' }));
        const response = await execute<{ state: string; operationId: string; resources: Array<{ path: string; status: string }> }>(base, { previewId: preview.body.previewId, confirm: true, decisions });
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ state: 'completed' });
        expect(response.body.operationId).toMatch(/^[0-9a-f-]{36}$/);
        expect(response.body.resources.find((item) => item.path === resource.path)?.status).toBe('published');
        expect((await active.readNote(NEW_NOTE_ID)).body).toBe('incoming');
        const listed = await fetch(`${base}/api/import/operations`);
        expect(listed.status).toBe(200);
        const listing = await listed.json() as { operations: Array<{ operationId: string; state: string }> };
        expect(listing.operations).toContainEqual(expect.objectContaining({ operationId: response.body.operationId, state: 'committed' }));
        const status = await fetch(`${base}/api/import/operations/${response.body.operationId}`);
        expect(status.status).toBe(200);
        expect(await status.json()).toMatchObject({ operationId: response.body.operationId, state: 'committed' });
        const retryCompleted = await fetch(`${base}/api/import/operations/${response.body.operationId}/retry`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
        expect(retryCompleted.status).toBe(409);
        const reused = await execute<{ error: { code: string } }>(base, { previewId: preview.body.previewId, confirm: true, decisions });
        expect(reused.status).toBe(409);
        expect(reused.body.error.code).toBe('STALE_PREVIEW');
        const unconfirmed = await execute<{ error: { code: string } }>(base, { previewId: 'unused', confirm: false, decisions: [] });
        expect(unconfirmed.status).toBe(400);
        expect(unconfirmed.body.error.code).toBe('CONFIRMATION_REQUIRED');
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        await middleware.dispose();
        source.dispose();
        active.dispose();
      }
    });
  });

  it('rejects a package changed after preview without modifying the destination', async () => {
    await withTempDir(async (root) => {
      const activePath = join(root, 'workspace');
      const active = await FileSystemVault.open(activePath);
      const source = await FileSystemVault.open(join(root, 'source'));
      await source.createNote(createNote({ id: NEW_NOTE_ID, title: 'Incoming item', path: 'notes/new.md', body: 'incoming', now: NOW }));
      const portableDir = join(root, 'portable');
      await exportVault(source, portableDir, { now: NOW });
      const middleware = createLocalApiMiddleware({ vaultPath: activePath, now: () => NOW });
      const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test API address');
      const base = `http://127.0.0.1:${address.port}`;
      try {
        const preview = await request<{ previewId: string; resources: Array<{ kind: string; id: string; path: string }> }>(base, portableDir);
        expect(preview.status).toBe(200);
        await writeFile(join(portableDir, 'notes', 'new.md'), serializeNote(createNote({ id: NEW_NOTE_ID, title: 'Edited after review', path: 'notes/new.md', body: 'external change', now: NOW })), 'utf8');
        const decisions = preview.body.resources.map((item) => ({ ...item, choice: 'add' }));
        const response = await execute<{ error: { code: string; message: string } }>(base, { previewId: preview.body.previewId, confirm: true, decisions });
        expect(response.status).toBe(409);
        expect(response.body.error).toMatchObject({ code: 'STALE_PREVIEW' });
        expect(response.body.error.message).toMatch(/fresh preview/i);
        await expect(active.readNote(NEW_NOTE_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        await middleware.dispose();
        source.dispose();
        active.dispose();
      }
    });
  });

  it('reports a source removed after preview as stale without touching the destination', async () => {
    await withTempDir(async (root) => {
      const activePath = join(root, 'workspace');
      const active = await FileSystemVault.open(activePath);
      const source = await FileSystemVault.open(join(root, 'source'));
      await source.createNote(createNote({ id: NEW_NOTE_ID, title: 'Incoming item', path: 'notes/new.md', body: 'incoming', now: NOW }));
      const portableDir = join(root, 'portable');
      await exportVault(source, portableDir, { now: NOW });
      const middleware = createLocalApiMiddleware({ vaultPath: activePath, now: () => NOW });
      const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing test API address');
      const base = `http://127.0.0.1:${address.port}`;
      try {
        const preview = await request<{ previewId: string; resources: Array<{ kind: string; id: string; path: string }> }>(base, portableDir);
        expect(preview.status).toBe(200);
        await rm(portableDir, { recursive: true });
        const decisions = preview.body.resources.map((item) => ({ ...item, choice: 'add' }));
        const response = await execute<{ error: { code: string } }>(base, { previewId: preview.body.previewId, confirm: true, decisions });
        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('STALE_PREVIEW');
        await expect(active.readNote(NEW_NOTE_ID)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        await middleware.dispose();
        source.dispose();
        active.dispose();
      }
    });
  });
});
