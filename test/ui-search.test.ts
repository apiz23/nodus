import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import type { UiSearchResult } from '../src/ui-server/dto.js';
import { withTempDir } from './tmp.js';

const NOW = '2026-10-25T12:00:00Z';
const EXACT = 'aaaaaaaa-1111-4111-8111-111111111111';
const PREFIX = 'bbbbbbbb-2222-4222-8222-222222222222';
const CONTAINS = 'cccccccc-3333-4333-8333-333333333333';
const BODY = 'dddddddd-4444-4444-8444-444444444444';

interface StartedApi {
  server: Server;
  base: string;
}

async function startApi(vaultPath: string): Promise<StartedApi> {
  const middleware = createLocalApiMiddleware({ vaultPath, now: () => NOW });
  const server = createServer((req, res) => {
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end('not found');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('No test port');
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function stopApi(started: StartedApi): Promise<void> {
  started.server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    started.server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function search(base: string, q: string): Promise<{ status: number; results: UiSearchResult[] }> {
  const response = await fetch(`${base}/api/search?q=${encodeURIComponent(q)}`);
  const body = (await response.json()) as { results: UiSearchResult[] };
  return { status: response.status, results: body.results };
}

async function seedRankedVault(vaultPath: string): Promise<void> {
  const vault = await FileSystemVault.open(vaultPath);
  const titles: Array<[string, string, string]> = [
    [EXACT, 'Planning', 'Unrelated body.'],
    [PREFIX, 'Planning board', 'Unrelated body.'],
    [CONTAINS, 'Board planning notes', 'Unrelated body.'],
    [BODY, 'Something else', 'A body that mentions planning in passing.'],
  ];
  for (const [id, title, body] of titles) {
    await vault.createNote(createNote({ id, title, path: `notes/${id.slice(0, 8)}.md`, body, now: NOW }));
  }
}

describe('search ranking', () => {
  it('ranks exact title, then prefix, then contains, then body-only', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedRankedVault(vaultPath);
      const started = await startApi(vaultPath);
      try {
        const { status, results } = await search(started.base, 'planning');
        expect(status).toBe(200);
        expect(results.map((result) => result.id)).toEqual([EXACT, PREFIX, CONTAINS, BODY]);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('ranks case-insensitively and ignores surrounding whitespace', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedRankedVault(vaultPath);
      const started = await startApi(vaultPath);
      try {
        const { results } = await search(started.base, '  PLANNING  ');
        expect(results[0]?.id).toBe(EXACT);
        expect(results.map((result) => result.id)).toEqual([EXACT, PREFIX, CONTAINS, BODY]);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('returns an empty list for an empty query and for no matches', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedRankedVault(vaultPath);
      const started = await startApi(vaultPath);
      try {
        const empty = await search(started.base, '   ');
        expect(empty.status).toBe(200);
        expect(empty.results).toEqual([]);

        const none = await search(started.base, 'definitely-absent-term');
        expect(none.status).toBe(200);
        expect(none.results).toEqual([]);
      } finally {
        await stopApi(started);
      }
    });
  });

  it('includes a body snippet on body-only matches and the title on every result', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedRankedVault(vaultPath);
      const started = await startApi(vaultPath);
      try {
        const { results } = await search(started.base, 'planning');
        for (const result of results) {
          expect(result.title.length).toBeGreaterThan(0);
          expect(result.snippet.length).toBeGreaterThan(0);
        }
        const bodyOnly = results.find((result) => result.id === BODY);
        expect(bodyOnly?.snippet).toContain('planning');
      } finally {
        await stopApi(started);
      }
    });
  });

  it('searches paths and shows a snippet from the field that matched', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedRankedVault(vaultPath);
      const started = await startApi(vaultPath);
      try {
        const titleMatch = await search(started.base, 'planning');
        expect(titleMatch.results[0]?.snippet).toBe('Title: Planning');

        const pathMatch = await search(started.base, 'aaaaaaaa');
        expect(pathMatch.results.map((result) => result.id)).toEqual([EXACT]);
        expect(pathMatch.results[0]?.snippet).toBe('Path: notes/aaaaaaaa.md');
      } finally {
        await stopApi(started);
      }
    });
  });

  it('returns stable IDs independent of the note path', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedRankedVault(vaultPath);
      const vault = await FileSystemVault.open(vaultPath);
      await vault.moveNote(EXACT, 'notes/renamed/location.md');

      const started = await startApi(vaultPath);
      try {
        const { results } = await search(started.base, 'planning');
        const exact = results.find((result) => result.id === EXACT);
        expect(exact).toBeDefined();
        expect(exact?.path).toBe('notes/renamed/location.md');
      } finally {
        await stopApi(started);
      }
    });
  });
});
