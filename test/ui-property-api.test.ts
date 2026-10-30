import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { serializeNote } from '../src/format/note-format.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';

const NOW = '2026-10-25T12:00:00Z';
const LATER = '2026-10-26T12:00:00Z';
const NOTE_ID = '11111111-1111-4111-8111-111111111111';
const TEXT_ID = '22222222-2222-4222-8222-222222222222';
const BOOL_ID = '33333333-3333-4333-8333-333333333333';
const SELECT_ID = '44444444-4444-4444-8444-444444444444';
const OPTION_ID = '55555555-5555-4555-8555-555555555555';
const OPTION2_ID = '66666666-6666-4666-8666-666666666666';

interface StartedApi { server: Server; base: string }

async function withApi(fn: (base: string, vault: FileSystemVault, vaultPath: string) => Promise<void>): Promise<void> {
  const parent = await mkdtemp(join(tmpdir(), 'nodus-property-api-'));
  const vaultPath = join(parent, 'vault');
  const vault = await FileSystemVault.open(vaultPath);
  const middleware = createLocalApiMiddleware({ vaultPath, now: () => LATER });
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end('not found'); }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('No test port');
  const started: StartedApi = { server, base: `http://127.0.0.1:${address.port}` };
  try { await fn(started.base, vault, vaultPath); }
  finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(parent, { recursive: true, force: true });
  }
}

async function json<T>(base: string, path: string, method = 'GET', body?: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() as T };
}

function baseNote() {
  return {
    ...createNote({ id: NOTE_ID, title: 'Keep metadata', path: 'notes/metadata.md', body: '# Body stays\n', now: NOW, tags: ['existing'], aliases: ['Old title'] }),
    extraFrontmatter: { icon: '📘', project: { owner: 'Nodus' }, custom: ['keep'], nodus_data: { format: 'nodus-note-properties', version: 1, databases: {} } },
  };
}

describe('property catalog API', () => {
  it('reads missing catalogs without creating a file, creates definitions, and rejects duplicate keys', async () => {
    await withApi(async (base, vault, vaultPath) => {
      const initial = await json<{ catalog: { properties: unknown[] }; contentHash: string | null }>(base, '/api/properties');
      expect(initial).toMatchObject({ status: 200, body: { catalog: { properties: [] }, contentHash: null } });
      const created = await json<{ catalog: { properties: Array<{ id: string; key: string }> }; contentHash: string }>(base, '/api/properties', 'POST', {
        baseHash: null,
        mutation: { type: 'create-property', property: { id: TEXT_ID, key: 'summary', name: 'Summary', type: 'text' } },
      });
      expect(created.status).toBe(200);
      expect(created.body.catalog.properties).toEqual([{ id: TEXT_ID, key: 'summary', name: 'Summary', type: 'text' }]);
      expect(created.body.contentHash).toMatch(/^[0-9a-f]{64}$/);
      const duplicate = await json<{ error: { code: string } }>(base, '/api/properties', 'POST', {
        baseHash: created.body.contentHash,
        mutation: { type: 'create-property', property: { id: BOOL_ID, key: 'summary', name: 'Other', type: 'checkbox' } },
      });
      expect(duplicate.status).toBe(400);
      expect(duplicate.body.error.code).toBe('INVALID_INPUT');
      await expect(readFile(join(vaultPath, 'properties/catalog.json'), 'utf8')).resolves.toContain('"key": "summary"');
      expect(await vault.readPropertyCatalogWithHash()).toMatchObject({ hash: created.body.contentHash });
    });
  });

  it('renames definitions and options without changing keys or stored note values', async () => {
    await withApi(async (base, vault) => {
      const note = { ...baseNote(), extraFrontmatter: { ...baseNote().extraFrontmatter, status: 'Open' } };
      await vault.createNote(note);
      let catalog = await json<{ catalog: { properties: Array<{ id: string; key: string; name: string }> }; contentHash: string | null }>(base, '/api/properties');
      const select = await json<{ contentHash: string }>(base, '/api/properties', 'POST', {
        baseHash: catalog.body.contentHash,
        mutation: { type: 'create-property', property: { id: SELECT_ID, key: 'status', name: 'Status', type: 'select', options: [{ id: OPTION_ID, label: 'Open' }] } },
      });
      let hash = select.body.contentHash;
      const renamed = await json<{ catalog: { properties: Array<{ id: string; key: string; name: string }> }; contentHash: string }>(base, '/api/properties', 'POST', {
        baseHash: hash, mutation: { type: 'rename-property', propertyId: SELECT_ID, name: 'Workflow state' },
      });
      expect(renamed.body.catalog.properties).toContainEqual({ id: SELECT_ID, key: 'status', name: 'Workflow state', type: 'select', options: [{ id: OPTION_ID, label: 'Open' }] });
      hash = renamed.body.contentHash;
      const added = await json<{ contentHash: string }>(base, '/api/properties', 'POST', {
        baseHash: hash, mutation: { type: 'add-option', propertyId: SELECT_ID, option: { id: OPTION2_ID, label: 'Done' } },
      });
      hash = added.body.contentHash;
      const labelChanged = await json<{ catalog: { properties: Array<{ options?: Array<{ id: string; label: string; aliases?: string[] }> }> }; contentHash: string }>(base, '/api/properties', 'POST', {
        baseHash: hash, mutation: { type: 'rename-option', propertyId: SELECT_ID, optionId: OPTION_ID, label: 'In progress' },
      });
      expect(labelChanged.body.catalog.properties[0]?.options).toContainEqual({ id: OPTION_ID, label: 'In progress', aliases: ['Open'] });
      const stored = await vault.readNoteWithHash(NOTE_ID);
      expect(stored.note.extraFrontmatter.status).toBe('Open');
      expect(stored.note.id).toBe(NOTE_ID);
    });
  });

  it('requires explicit confirmation for option/property removal and preserves note frontmatter', async () => {
    await withApi(async (base, vault) => {
      const note = { ...baseNote(), extraFrontmatter: { ...baseNote().extraFrontmatter, status: 'Open', summary: 'kept' } };
      await vault.createNote(note);
      const created = await json<{ contentHash: string }>(base, '/api/properties', 'POST', {
        baseHash: null,
        mutation: { type: 'create-property', property: { id: SELECT_ID, key: 'status', name: 'Status', type: 'select', options: [{ id: OPTION_ID, label: 'Open' }] } },
      });
      const selectDeleteDenied = await json<{ error: { code: string } }>(base, '/api/properties', 'POST', {
        baseHash: created.body.contentHash,
        mutation: { type: 'remove-option', propertyId: SELECT_ID, optionId: OPTION_ID },
      });
      expect(selectDeleteDenied.status).toBe(400);
      const optionRemoved = await json<{ contentHash: string; catalog: { properties: Array<{ options: unknown[] }> } }>(base, '/api/properties', 'POST', {
        baseHash: created.body.contentHash,
        mutation: { type: 'remove-option', propertyId: SELECT_ID, optionId: OPTION_ID, confirmUnregisterValues: true },
      });
      expect(optionRemoved.body.catalog.properties[0]?.options).toEqual([]);
      const denied = await json<{ error: { code: string } }>(base, '/api/properties', 'POST', {
        baseHash: optionRemoved.body.contentHash,
        mutation: { type: 'delete-property', propertyId: SELECT_ID },
      });
      expect(denied.status).toBe(400);
      const deleted = await json<{ catalog: { properties: Array<{ id: string }> }; contentHash: string }>(base, '/api/properties', 'POST', {
        baseHash: optionRemoved.body.contentHash,
        mutation: { type: 'delete-property', propertyId: SELECT_ID, confirmUnregisterValues: true },
      });
      expect(deleted.body.catalog.properties).toEqual([]);
      const stored = await vault.readNote(NOTE_ID);
      expect(stored.extraFrontmatter).toMatchObject({ status: 'Open', summary: 'kept' });
    });
  });

  it('returns a 409 stale catalog response with the current hash and rejects full replacement', async () => {
    await withApi(async (base) => {
      const first = await json<{ contentHash: string }>(base, '/api/properties', 'POST', {
        baseHash: null,
        mutation: { type: 'create-property', property: { id: TEXT_ID, key: 'summary', name: 'Summary', type: 'text' } },
      });
      const second = await json<{ contentHash: string }>(base, '/api/properties', 'POST', {
        baseHash: first.body.contentHash,
        mutation: { type: 'rename-property', propertyId: TEXT_ID, name: 'Description' },
      });
      const stale = await json<{ error: { code: string; currentHash?: string } }>(base, '/api/properties', 'POST', {
        baseHash: first.body.contentHash,
        mutation: { type: 'rename-property', propertyId: TEXT_ID, name: 'Stale name' },
      });
      expect(stale.status).toBe(409);
      expect(stale.body.error).toMatchObject({ code: 'STALE_WRITE', currentHash: second.body.contentHash });
      const arbitrary = await json<{ error: { code: string } }>(base, '/api/properties', 'POST', {
        baseHash: second.body.contentHash,
        catalog: { properties: [] },
      });
      expect(arbitrary.status).toBe(400);
      expect(arbitrary.body.error.code).toBe('INVALID_INPUT');
    });
  });

  it('rejects arbitrary frontmatter replacement on the single-property endpoint', async () => {
    await withApi(async (base, vault) => {
      const note = baseNote();
      await vault.createNote(note);
      const opened = await vault.readNoteWithHash(NOTE_ID);
      const response = await json<{ error: { code: string } }>(base, `/api/notes/${NOTE_ID}/properties/${TEXT_ID}`, 'PUT', {
        baseHash: opened.hash,
        frontmatter: { title: 'replaced', project: null },
      });
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_INPUT');
      expect((await vault.readNoteWithHash(NOTE_ID)).hash).toBe(opened.hash);
    });
  });

  it('conditionally writes one frontmatter property and supports explicit unset', async () => {
    await withApi(async (base, vault) => {
      await vault.createNote(baseNote());
      let catalog = await json<{ contentHash: string | null }>(base, '/api/properties');
      for (const property of [
        { id: TEXT_ID, key: 'summary', name: 'Summary', type: 'text' },
        { id: BOOL_ID, key: 'reviewed', name: 'Reviewed', type: 'checkbox' },
      ]) {
        const created = await json<{ contentHash: string }>(base, '/api/properties', 'POST', {
          baseHash: catalog.body.contentHash,
          mutation: { type: 'create-property', property },
        });
        catalog = { body: { contentHash: created.body.contentHash } } as typeof catalog;
      }
      let opened = await vault.readNoteWithHash(NOTE_ID);
      const empty = await json<{ note: { contentHash: string; body: string; tags: string[] }; value: string; key: string }>(base, `/api/notes/${NOTE_ID}/properties/${TEXT_ID}`, 'PUT', { baseHash: opened.hash, value: '' });
      expect(empty.status).toBe(200);
      expect(empty.body).toMatchObject({ key: 'summary', value: '', note: { body: baseNote().body, tags: ['existing'] } });
      opened = await vault.readNoteWithHash(NOTE_ID);
      const unchecked = await json<{ value: boolean; note: { contentHash: string } }>(base, `/api/notes/${NOTE_ID}/properties/${BOOL_ID}`, 'PUT', { baseHash: opened.hash, value: false });
      expect(unchecked.status).toBe(200);
      expect(unchecked.body.value).toBe(false);
      opened = await vault.readNoteWithHash(NOTE_ID);
      const unset = await json<{ value?: unknown; note: { contentHash: string } }>(base, `/api/notes/${NOTE_ID}/properties/${TEXT_ID}`, 'PUT', { baseHash: opened.hash, unset: true });
      expect(unset.status).toBe(200);
      expect(Object.hasOwn(unset.body, 'value')).toBe(false);
      const note = await vault.readNote(NOTE_ID);
      expect(note.extraFrontmatter).toMatchObject({ reviewed: false });
      expect(Object.hasOwn(note.extraFrontmatter, 'summary')).toBe(false);
      expect(note.extraFrontmatter.project).toEqual({ owner: 'Nodus' });
    });
  });

  it('rejects null, stale note revisions, missing properties/notes, and leaves bytes unchanged on invalid values', async () => {
    await withApi(async (base, vault, vaultPath) => {
      await vault.createNote(baseNote());
      const created = await json<{ contentHash: string }>(base, '/api/properties', 'POST', {
        baseHash: null,
        mutation: { type: 'create-property', property: { id: TEXT_ID, key: 'summary', name: 'Summary', type: 'text' } },
      });
      const opened = await vault.readNoteWithHash(NOTE_ID);
      const file = join(vaultPath, opened.note.path);
      const before = await readFile(file);
      const invalid = await json<{ error: { code: string } }>(base, `/api/notes/${NOTE_ID}/properties/${TEXT_ID}`, 'PUT', { baseHash: opened.hash, value: null });
      expect(invalid.status).toBe(422);
      expect(invalid.body.error.code).toBe('PROPERTY_VALUE_INVALID');
      expect(await readFile(file)).toEqual(before);
      const missingProperty = await json<{ error: { code: string } }>(base, `/api/notes/${NOTE_ID}/properties/${OPTION2_ID}`, 'PUT', { baseHash: opened.hash, value: 'x' });
      expect(missingProperty.status).toBe(404);
      const missingNote = await json<{ error: { code: string } }>(base, `/api/notes/${OPTION2_ID}/properties/${TEXT_ID}`, 'PUT', { baseHash: opened.hash, value: 'x' });
      expect(missingNote.status).toBe(404);
      const external = { ...opened.note, body: 'External content\n' };
      await writeFile(file, serializeNote(external), 'utf8');
      const stale = await json<{ error: { code: string; currentHash?: string } }>(base, `/api/notes/${NOTE_ID}/properties/${TEXT_ID}`, 'PUT', { baseHash: opened.hash, value: 'x' });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('STALE_WRITE');
      expect(stale.body.error.currentHash).toBeDefined();
      expect((await vault.readPropertyCatalogWithHash()).hash).toBe(created.body.contentHash);
    });
  });
});
