import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import type {
  UiBacklinksResponse,
  UiDiscoveryResponse,
  UiNote,
  UiRepairWikiLinkResponse,
  UiSaveNoteResponse,
} from '../src/ui-server/dto.js';
import { withTempDir } from './tmp.js';

const NOW = '2026-11-02T12:00:00Z';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

interface StartedApi { server: Server; base: string }

async function startApi(vaultPath: string): Promise<StartedApi> {
  const middleware = createLocalApiMiddleware({ vaultPath, now: () => NOW });
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end('not found'); }));
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('No test port');
  return { server, base: `http://127.0.0.1:${address.port}` };
}

async function stopApi(started: StartedApi): Promise<void> {
  started.server.closeAllConnections();
  await new Promise<void>((resolve, reject) => started.server.close((error) => error ? reject(error) : resolve()));
}

async function json<T>(base: string, path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; body: T }> {
  const response = await fetch(`${base}${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  return { status: response.status, body: (await response.json()) as T };
}

function note(id: string, title: string, body = '', aliases: string[] = [], path = `notes/${id.slice(0, 8)}.md`) {
  return createNote({ id, title, path, body, aliases, now: NOW });
}

async function seedVault(vaultPath: string, notes: ReturnType<typeof note>[]): Promise<void> {
  const vault = await FileSystemVault.open(vaultPath);
  for (const entry of notes) await vault.createNote(entry);
}

describe('wiki-link repair API', () => {
  it('suggests similar notes, pins a repaired link, and disambiguates a duplicate target', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedVault(vaultPath, [
        note(A, 'Source', 'See [[Projct roadmap|the plan]] and [[Shared]].'),
        note(B, 'Project roadmap', '', [], 'planning/roadmap.md'),
        note(C, 'Shared', '', [], 'notes/shared-one.md'),
        note(D, 'Shared', '', [], 'notes/shared-two.md'),
      ]);
      const started = await startApi(vaultPath);
      try {
        const discovery = await json<UiDiscoveryResponse>(started.base, '/api/discovery');
        expect(discovery.status).toBe(200);
        expect(discovery.body.unresolved).toHaveLength(1);
        expect(discovery.body.unresolved[0]?.suggestions[0]).toMatchObject({
          noteId: B, title: 'Project roadmap',
        });
        expect(['title-similar', 'title-words']).toContain(discovery.body.unresolved[0]?.suggestions[0]?.reason);
        expect(discovery.body.ambiguous).toHaveLength(1);
        expect(discovery.body.ambiguous[0]?.suggestions.map((suggestion) => suggestion.noteId)).toEqual([C, D]);

        const unresolved = discovery.body.unresolved[0]!;
        const source = await json<{ note: UiNote }>(started.base, `/api/notes/${A}`);
        const repaired = await json<UiRepairWikiLinkResponse>(started.base, `/api/notes/${A}/links/repair`, {
          method: 'POST',
          body: {
            baseHash: source.body.note.contentHash,
            start: unresolved.start,
            end: unresolved.end,
            target: unresolved.target,
            display: unresolved.display,
            replacementNoteId: B,
          },
        });
        expect(repaired.status).toBe(200);
        expect(repaired.body).toMatchObject({ changed: true, pinned: true });
        expect(repaired.body.note.body).toContain(`[[${B}|the plan]]`);

        const afterFirst = await json<UiDiscoveryResponse>(started.base, '/api/discovery?refresh=true');
        expect(afterFirst.body.unresolved).toEqual([]);
        expect(afterFirst.body.ambiguous).toHaveLength(1);
        const ambiguous = afterFirst.body.ambiguous[0]!;
        const sourceAfterFirst = await json<{ note: UiNote }>(started.base, `/api/notes/${A}`);
        const chosen = await json<UiRepairWikiLinkResponse>(started.base, `/api/notes/${A}/links/repair`, {
          method: 'POST',
          body: {
            baseHash: sourceAfterFirst.body.note.contentHash,
            start: ambiguous.start,
            end: ambiguous.end,
            target: ambiguous.target,
            replacementNoteId: C,
          },
        });
        expect(chosen.status).toBe(200);
        expect(chosen.body.note.body).toContain(`[[${C}|Shared]]`);
        const afterSecond = await json<UiDiscoveryResponse>(started.base, '/api/discovery?refresh=true');
        expect(afterSecond.body.ambiguous).toEqual([]);
        const backlinks = await json<UiBacklinksResponse>(started.base, `/api/notes/${C}/backlinks`);
        expect(backlinks.body.backlinks).toContainEqual(expect.objectContaining({ sourceId: A }));
      } finally {
        await stopApi(started);
      }
    });
  });

  it('rejects stale, malformed, missing, and self-target repairs without writing', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedVault(vaultPath, [
        note(A, 'Source', 'See [[Missing|plan]].'),
        note(B, 'Target', ''),
      ]);
      const started = await startApi(vaultPath);
      try {
        const discovery = await json<UiDiscoveryResponse>(started.base, '/api/discovery');
        const link = discovery.body.unresolved[0]!;
        const source = await json<{ note: UiNote }>(started.base, `/api/notes/${A}`);
        const base = {
          start: link.start,
          end: link.end,
          target: link.target,
          replacementNoteId: B,
        };
        const stale = await json(started.base, `/api/notes/${A}/links/repair`, {
          method: 'POST',
          body: { ...base, baseHash: '0'.repeat(64) },
        });
        expect(stale.status).toBe(409);

        const badOffsets = await json(started.base, `/api/notes/${A}/links/repair`, {
          method: 'POST',
          body: { ...base, start: link.start + 1, baseHash: source.body.note.contentHash },
        });
        expect(badOffsets.status).toBe(400);

        const badTarget = await json(started.base, `/api/notes/${A}/links/repair`, {
          method: 'POST',
          body: { ...base, target: 'Other', baseHash: source.body.note.contentHash },
        });
        expect(badTarget.status).toBe(400);

        const selfTarget = await json(started.base, `/api/notes/${A}/links/repair`, {
          method: 'POST',
          body: { ...base, replacementNoteId: A, baseHash: source.body.note.contentHash },
        });
        expect(selfTarget.status).toBe(400);

        const missing = await json(started.base, `/api/notes/${A}/links/repair`, {
          method: 'POST',
          body: { ...base, replacementNoteId: D, baseHash: source.body.note.contentHash },
        });
        expect(missing.status).toBe(404);

        const stillThere = await json<{ note: UiNote }>(started.base, `/api/notes/${A}`);
        expect(stillThere.body.note.body).toBe('See [[Missing|plan]].');
      } finally {
        await stopApi(started);
      }
    });
  });
});

describe('title rename link preservation', () => {
  it('retains the previous title as an alias only when confirmed title links exist', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedVault(vaultPath, [
        note(A, 'Source', 'See [[Old title]] and [[Old title|again]].'),
        note(B, 'Old title', '', [], 'notes/old-title.md'),
        note(C, 'No incoming links', '', [], 'notes/no-incoming.md'),
      ]);
      const started = await startApi(vaultPath);
      try {
        const target = await json<{ note: UiNote }>(started.base, `/api/notes/${B}`);
        const saved = await json<UiSaveNoteResponse>(started.base, `/api/notes/${B}`, {
          method: 'PUT',
          body: { title: 'New title', body: target.body.note.body, baseHash: target.body.note.contentHash },
        });
        expect(saved.status).toBe(200);
        expect(saved.body.preservedLinks).toEqual({ alias: 'Old title', linkCount: 2 });
        expect(saved.body.note.aliases).toContain('Old title');

        const discovery = await json<UiDiscoveryResponse>(started.base, '/api/discovery?refresh=true');
        expect(discovery.body.unresolved).toEqual([]);
        const backlinks = await json<UiBacklinksResponse>(started.base, `/api/notes/${B}/backlinks`);
        expect(backlinks.body.backlinks[0]).toMatchObject({ sourceId: A, count: 2, ambiguous: false });

        const withoutLinks = await json<{ note: UiNote }>(started.base, `/api/notes/${C}`);
        const renamed = await json<UiSaveNoteResponse>(started.base, `/api/notes/${C}`, {
          method: 'PUT',
          body: { title: 'Renamed without links', body: withoutLinks.body.note.body, baseHash: withoutLinks.body.note.contentHash },
        });
        expect(renamed.body.preservedLinks).toBeUndefined();
        expect(renamed.body.note.aliases).not.toContain('No incoming links');
      } finally {
        await stopApi(started);
      }
    });
  });

  it('does not add an alias for ID-pinned-only links or a case-only title change', async () => {
    await withTempDir(async (dir) => {
      const vaultPath = join(dir, 'vault');
      await seedVault(vaultPath, [
        note(A, 'Source', `See [[${B}|pinned]] and [[Cased]].`),
        note(B, 'Pinned target', '', [], 'notes/pinned.md'),
        note(C, 'Cased', '', [], 'notes/cased.md'),
      ]);
      const started = await startApi(vaultPath);
      try {
        const pinned = await json<{ note: UiNote }>(started.base, `/api/notes/${B}`);
        const saved = await json<UiSaveNoteResponse>(started.base, `/api/notes/${B}`, {
          method: 'PUT',
          body: { title: 'Renamed pinned target', body: pinned.body.note.body, baseHash: pinned.body.note.contentHash },
        });
        expect(saved.body.preservedLinks).toBeUndefined();
        expect(saved.body.note.aliases).toEqual([]);

        const cased = await json<{ note: UiNote }>(started.base, `/api/notes/${C}`);
        const recased = await json<UiSaveNoteResponse>(started.base, `/api/notes/${C}`, {
          method: 'PUT',
          body: { title: 'cased', body: cased.body.note.body, baseHash: cased.body.note.contentHash },
        });
        expect(recased.body.preservedLinks).toBeUndefined();
        expect(recased.body.note.aliases).toEqual([]);
        const discovery = await json<UiDiscoveryResponse>(started.base, '/api/discovery?refresh=true');
        expect(discovery.body.unresolved).toEqual([]);
      } finally {
        await stopApi(started);
      }
    });
  });
});
