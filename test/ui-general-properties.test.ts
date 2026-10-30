import { createServer, type Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import type { UiGeneralNotePropertiesResponse, UiNote } from '../src/ui-server/dto.js';
import { withTempDir } from './tmp.js';

const NOW = '2026-10-25T12:00:00Z';
const LATER = '2026-10-26T12:00:00Z';
const NOTE_ID = '11111111-1111-4111-8111-111111111111';
const TEXT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHECK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LIST_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

async function startApi(vaultPath: string): Promise<{ server: Server; base: string }> {
  const middleware = createLocalApiMiddleware({ vaultPath, now: () => LATER });
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end('not found'); }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('No test port');
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function json<T>(base: string, path: string, method = 'GET', body?: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() as T };
}

describe('general property read projection API', () => {
  it('returns only registered values, distinguishes false/empty values, and reports invalid stored values', async () => {
    await withTempDir(async (dir) => {
      const vault = await FileSystemVault.open(dir);
      const server = await startApi(dir);
      try {
        await vault.createNote({
          ...createNote({ id: NOTE_ID, title: 'Property projection', path: 'property-projection.md', body: 'Markdown body unchanged.\n', now: NOW }),
          extraFrontmatter: { reviewed: false, summary: '', topics: [], score: null, privateField: 'never expose' },
        });
        let revision: string | null = null;
        for (const property of [
          { id: TEXT_ID, key: 'summary', name: 'Summary', type: 'text' },
          { id: CHECK_ID, key: 'reviewed', name: 'Reviewed', type: 'checkbox' },
          { id: LIST_ID, key: 'topics', name: 'Topics', type: 'multi-select', options: [{ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', label: 'Research' }] },
          { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', key: 'score', name: 'Score', type: 'number' },
        ]) {
          const result: { status: number; body: { contentHash: string } } = await json<{ contentHash: string }>(server.base, '/api/properties', 'POST', {
            baseHash: revision, mutation: { type: 'create-property', property },
          });
          expect(result.status).toBe(200);
          revision = result.body.contentHash;
        }

        const projection = await json<UiGeneralNotePropertiesResponse>(server.base, `/api/notes/${NOTE_ID}/general-properties`);
        expect(projection.status).toBe(200);
        expect(projection.body.values).toEqual({ [TEXT_ID]: '', [CHECK_ID]: false, [LIST_ID]: [] });
        expect(projection.body.issues).toEqual([{ key: 'score', propertyId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', code: 'TYPE_MISMATCH', message: 'Property "Score" (number) must be a number' }]);
        expect(JSON.stringify(projection.body)).not.toContain('privateField');

        const updated = await json<{ note: UiNote }>(server.base, `/api/notes/${NOTE_ID}/properties/${CHECK_ID}`, 'PUT', {
          baseHash: projection.body.contentHash, value: false,
        });
        expect(updated.status).toBe(200);
        expect(updated.body.note.contentHash).not.toBe(projection.body.contentHash);
        const stored = await vault.readNoteWithHash(NOTE_ID);
        expect(stored.note).toMatchObject({ body: 'Markdown body unchanged.\n', updatedAt: LATER });
        expect(stored.note.extraFrontmatter).toEqual({ reviewed: false, summary: '', topics: [], score: null, privateField: 'never expose' });
        const unset = await json<{ note: UiNote }>(server.base, `/api/notes/${NOTE_ID}/properties/${CHECK_ID}`, 'PUT', {
          baseHash: updated.body.note.contentHash, unset: true,
        });
        expect((await vault.readNote(NOTE_ID)).extraFrontmatter).toEqual({ summary: '', topics: [], score: null, privateField: 'never expose' });
        expect(unset.body.note.contentHash).not.toBe(updated.body.note.contentHash);

        const missing = await json(server.base, '/api/notes/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/general-properties');
        expect(missing.status).toBe(404);
      } finally {
        server.server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.server.close((error) => error ? reject(error) : resolve()));
      }
    });
  });
});
