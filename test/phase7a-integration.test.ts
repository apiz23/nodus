import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import { buildSearchIndex, searchIndex } from '../src/search/search-index.js';
import { validateNoteFilters } from '../src/search/note-filters.js';
import { createBackup, restoreBackup, validateBackup } from '../src/storage/backup/backup.js';
import { withTempDir } from './tmp.js';
import type { UiNote, UiSearchResult } from '../src/ui-server/dto.js';
import type { NotePropertyDefinition, PropertyCatalog } from '../src/properties/catalog.js';

const NOW = '2026-10-30T09:00:00Z';
const LATER = '2026-10-30T10:00:00Z';
const NOTE_ID = '11111111-1111-4111-8111-111111111111';
const TEXT_ID = '22222222-2222-4222-8222-222222222222';
const SELECT_ID = '33333333-3333-4333-8333-333333333333';
const MULTI_ID = '44444444-4444-4444-8444-444444444444';
const OPEN_ID = '55555555-5555-4555-8555-555555555555';
const RESEARCH_ID = '66666666-6666-4666-8666-666666666666';

interface StartedApi { server: Server; base: string }

async function startApi(vaultPath: string): Promise<StartedApi> {
  const middleware = createLocalApiMiddleware({ vaultPath, now: () => LATER });
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end('not found'); }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('No test port');
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function stopApi(started: StartedApi): Promise<void> {
  started.server.closeAllConnections();
  await new Promise<void>((resolve, reject) => started.server.close((error) => error ? reject(error) : resolve()));
}

async function json<T>(base: string, path: string, method = 'GET', body?: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() as T };
}

async function createDefinition(base: string, baseHash: string | null, property: NotePropertyDefinition): Promise<string> {
  const result = await json<{ contentHash: string }>(base, '/api/properties', 'POST', {
    baseHash, mutation: { type: 'create-property', property },
  });
  expect(result.status).toBe(200);
  return result.body.contentHash;
}

async function search(base: string, filters?: unknown[], logic = 'and'): Promise<UiSearchResult[]> {
  const params = new URLSearchParams();
  if (filters !== undefined) {
    params.set('filters', JSON.stringify(filters));
    params.set('logic', logic);
  }
  const result = await json<{ results: UiSearchResult[] }>(base, `/api/search?${params}`);
  expect(result.status).toBe(200);
  return result.body.results;
}

describe('Phase 7A cross-milestone workflows', { timeout: 20_000 }, () => {
  it('keeps search and filters correct after property, option, and tag edits', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      const vault = await FileSystemVault.open(vaultPath);
      await vault.createNote({
        ...createNote({ id: NOTE_ID, title: 'Metadata workflow', path: 'notes/workflow.md', body: '# Body stays\n', tags: ['Field work'], aliases: ['Workflow alias'], now: NOW }),
        extraFrontmatter: { legacy: { keep: true } },
      });
      const started = await startApi(vaultPath);
      try {
        let catalogHash: string | null = null;
        catalogHash = await createDefinition(started.base, catalogHash, { id: TEXT_ID, key: 'summary', name: 'Summary', type: 'text' });
        catalogHash = await createDefinition(started.base, catalogHash, {
          id: SELECT_ID, key: 'status', name: 'Status', type: 'select', options: [{ id: OPEN_ID, label: 'Open' }],
        });
        catalogHash = await createDefinition(started.base, catalogHash, {
          id: MULTI_ID, key: 'topics', name: 'Topics', type: 'multi-select', options: [{ id: RESEARCH_ID, label: 'Research' }],
        });

        let note = (await json<{ note: UiNote }>(started.base, `/api/notes/${NOTE_ID}`)).body.note;
        for (const [propertyId, value] of [[TEXT_ID, 'Local history'], [SELECT_ID, 'Open'], [MULTI_ID, ['Research']]] as const) {
          const updated = await json<{ note: UiNote }>(started.base, `/api/notes/${NOTE_ID}/properties/${propertyId}`, 'PUT', {
            baseHash: note.contentHash, value,
          });
          expect(updated.status).toBe(200);
          note = updated.body.note;
        }
        const tagged = await json<{ note: UiNote }>(started.base, `/api/notes/${NOTE_ID}/tags`, 'PUT', {
          baseHash: note.contentHash, operation: { type: 'add', tag: ' Current ' },
        });
        expect(tagged.status).toBe(200);
        note = tagged.body.note;

        expect((await json<{ results: UiSearchResult[] }>(started.base, '/api/search?q=Local%20history')).body.results[0]?.match).toMatchObject({
          field: 'property', propertyId: TEXT_ID, propertyName: 'Summary',
        });
        expect((await json<{ results: UiSearchResult[] }>(started.base, '/api/search?q=Field%20work')).body.results[0]?.match?.field).toBe('tag');
        expect((await json<{ results: UiSearchResult[] }>(started.base, '/api/search?q=Current')).body.results[0]?.match?.field).toBe('tag');

        const renamedProperty = await json<{ contentHash: string }>(started.base, '/api/properties', 'POST', {
          baseHash: catalogHash, mutation: { type: 'rename-property', propertyId: SELECT_ID, name: 'Workflow state' },
        });
        expect(renamedProperty.status).toBe(200);
        const renamedOption = await json<{ contentHash: string }>(started.base, '/api/properties', 'POST', {
          baseHash: renamedProperty.body.contentHash,
          mutation: { type: 'rename-option', propertyId: SELECT_ID, optionId: OPEN_ID, label: 'In progress' },
        });
        expect(renamedOption.status).toBe(200);

        const propertySearch = await json<{ results: UiSearchResult[] }>(started.base, '/api/search?q=Workflow%20state');
        expect(propertySearch.body.results[0]?.match).toMatchObject({ field: 'property', propertyId: SELECT_ID, propertyName: 'Workflow state' });

        // The option label changed but the stored value and retained alias both
        // must match the same option in filters.
        expect((await search(started.base, [{ type: 'property', propertyId: SELECT_ID, operator: 'is', value: 'Open' }])).map((result) => result.id)).toEqual([NOTE_ID]);
        expect((await search(started.base, [{ type: 'property', propertyId: SELECT_ID, operator: 'is', value: 'In progress' }])).map((result) => result.id)).toEqual([NOTE_ID]);
        expect((await search(started.base, [{ type: 'property', propertyId: MULTI_ID, operator: 'contains', value: 'Research' }])).map((result) => result.id)).toEqual([NOTE_ID]);
        expect((await search(started.base, [{ type: 'tag', operator: 'contains', value: 'current' }])).map((result) => result.id)).toEqual([NOTE_ID]);

        const refreshed = await json<{ results: UiSearchResult[] }>(started.base, '/api/search?q=Local%20history&refresh=true');
        expect(refreshed.body.results[0]?.id).toBe(NOTE_ID);
        const stored = await vault.readNote(NOTE_ID);
        expect(stored).toMatchObject({ body: '# Body stays\n', tags: ['Field work', 'Current'], aliases: ['Workflow alias'], updatedAt: LATER });
        expect(stored.extraFrontmatter).toEqual({ legacy: { keep: true }, summary: 'Local history', status: 'Open', topics: ['Research'] });
      } finally {
        await stopApi(started);
      }
    });
  });

  it('restores a v4 catalog and note metadata, then rebuilds search and filters', async () => {
    await withTempDir(async (dir) => {
      const source = await FileSystemVault.open(join(dir, 'source'));
      await source.mutatePropertyCatalog({
        type: 'create-property',
        property: { id: SELECT_ID, key: 'status', name: 'Status', type: 'select', options: [{ id: OPEN_ID, label: 'Open' }] },
      }, null);
      await source.createNote({
        ...createNote({ id: NOTE_ID, title: 'Restored metadata', path: 'notes/restored.md', body: 'Restored body\n', tags: ['Restored'], now: NOW }),
        extraFrontmatter: { status: 'Open', custom: { keep: true } },
      });
      const backup = join(dir, 'backup');
      await createBackup(source, backup, { now: NOW });
      expect((await validateBackup(backup)).manifest.version).toBe(4);

      const restored = await FileSystemVault.open(join(dir, 'restored'));
      expect(await restoreBackup(backup, restored.root)).toMatchObject({ notes: 1, propertyCatalog: 1 });
      const { catalog, hash } = await restored.readPropertyCatalogWithHash();
      expect(hash).not.toBeNull();
      expect(catalog.properties[0]).toMatchObject({ id: SELECT_ID, key: 'status', name: 'Status' });
      const note = await restored.readNote(NOTE_ID);
      expect(note).toMatchObject({ body: 'Restored body\n', tags: ['Restored'] });
      expect(note.extraFrontmatter).toEqual({ status: 'Open', custom: { keep: true } });

      const index = buildSearchIndex(await restored.snapshotNotes(), catalog);
      expect(searchIndex(index, 'Restored body')[0]?.id).toBe(NOTE_ID);
      const filters = validateNoteFilters([{ type: 'property', propertyId: SELECT_ID, operator: 'is', value: 'Open' }], catalog as PropertyCatalog);
      expect(searchIndex(index, '', 50, filters).map((result) => result.id)).toEqual([NOTE_ID]);
      const tagFilters = validateNoteFilters([{ type: 'tag', operator: 'contains', value: 'restored' }], catalog);
      expect(searchIndex(index, '', 50, tagFilters).map((result) => result.id)).toEqual([NOTE_ID]);
    });
  });
});
