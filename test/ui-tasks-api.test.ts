import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import type { UiTasksResponse, UiToggleTaskResponse } from '../src/ui-server/dto.js';
import { withTempDir } from './tmp.js';

const NOW = '2026-11-03T09:00:00Z';
const FIRST = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';

async function start(root: string) {
  const middleware = createLocalApiMiddleware({ vaultPath: root, now: () => NOW });
  const server = createServer((req, res) => middleware(req, res, () => res.end()));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  return {
    base: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await middleware.dispose();
    },
  };
}

describe('tasks API', () => {
  it('projects Markdown tasks, completes one safely, reopens it, and isolates duplicate text by source line', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      const body = '# Work\n\n- [ ] Duplicate task\n- [ ] Duplicate task\n  - [x] Child task\n';
      await vault.createNote(createNote({ id: FIRST, title: 'Project', path: 'notes/project.md', body, now: NOW }));
      await vault.createNote(createNote({ id: SECOND, title: 'Other', path: 'archive/other.md', body: '- [ ] Other task\n', now: NOW }));
      const api = await start(root);
      try {
        const response = await fetch(`${api.base}/api/tasks`);
        expect(response.status).toBe(200);
        const projection = await response.json() as UiTasksResponse;
        expect(projection.counts).toEqual({ total: 4, open: 3, completed: 1, notesWithTasks: 2 });
        expect(projection.tasks.map((task) => [task.noteTitle, task.text, task.checked, task.line])).toEqual([
          ['Other', 'Other task', false, 1],
          ['Project', 'Duplicate task', false, 3],
          ['Project', 'Duplicate task', false, 4],
          ['Project', 'Child task', true, 5],
        ]);
        const target = projection.tasks.find((task) => task.line === 3)!;
        const toggled = await fetch(`${api.base}/api/notes/${FIRST}/tasks/toggle`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId: target.id, checked: true, baseHash: target.noteContentHash }),
        });
        expect(toggled.status).toBe(200);
        const result = await toggled.json() as UiToggleTaskResponse;
        expect(result.task).toMatchObject({ line: 3, checked: true });
        const stored = await vault.readNoteWithHash(FIRST);
        expect(stored.note.body).toBe('# Work\n\n- [x] Duplicate task\n- [ ] Duplicate task\n  - [x] Child task\n');

        const refreshed = await fetch(`${api.base}/api/tasks?refresh=true`).then((value) => value.json()) as UiTasksResponse;
        expect(refreshed.counts).toEqual({ total: 4, open: 2, completed: 2, notesWithTasks: 2 });
        const reopenedTask = refreshed.tasks.find((task) => task.line === 3)!;
        const reopened = await fetch(`${api.base}/api/notes/${FIRST}/tasks/toggle`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId: reopenedTask.id, checked: false, baseHash: reopenedTask.noteContentHash }),
        });
        expect(reopened.status).toBe(200);
        expect((await vault.readNoteWithHash(FIRST)).note.body).toContain('- [ ] Duplicate task\n- [ ] Duplicate task');
      } finally {
        await api.close();
        vault.dispose();
      }
    });
  });

  it('keeps task identity through a note move and returns the new path', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createNote(createNote({ id: FIRST, title: 'Project', path: 'project.md', body: '- [ ] Move-safe task\n', now: NOW }));
      const api = await start(root);
      try {
        const projection = await fetch(`${api.base}/api/tasks`).then((value) => value.json()) as UiTasksResponse;
        const task = projection.tasks[0]!;
        await vault.moveNote(FIRST, 'archive/project.md');
        const toggled = await fetch(`${api.base}/api/notes/${FIRST}/tasks/toggle`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId: task.id, checked: true, baseHash: task.noteContentHash }),
        });
        expect(toggled.status).toBe(200);
        const result = await toggled.json() as UiToggleTaskResponse;
        expect(result.note.path).toBe('archive/project.md');
        expect(result.task.checked).toBe(true);
      } finally {
        await api.close();
        vault.dispose();
      }
    });
  });

  it('rejects stale hashes, missing tasks, and deleted notes without writing', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      const body = '- [ ] One task\n- [ ] Two task\n';
      await vault.createNote(createNote({ id: FIRST, title: 'Project', path: 'project.md', body, now: NOW }));
      await vault.createNote(createNote({ id: SECOND, title: 'Deleted', path: 'deleted.md', body: '- [ ] Deleted task\n', now: NOW }));
      const api = await start(root);
      try {
        const projection = await fetch(`${api.base}/api/tasks`).then((value) => value.json()) as UiTasksResponse;
        const task = projection.tasks[0]!;
        const current = await vault.readNoteWithHash(FIRST);
        await vault.replaceNote({ ...current.note, body: '- [x] One task\n- [ ] Two task\n' }, { expectedHash: current.hash });
        const stale = await fetch(`${api.base}/api/notes/${FIRST}/tasks/toggle`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId: task.id, checked: true, baseHash: task.noteContentHash }),
        });
        expect(stale.status).toBe(409);
        expect((await stale.json() as { error: { code: string } }).error.code).toBe('STALE_WRITE');
        expect((await vault.readNoteWithHash(FIRST)).note.body).toBe('- [x] One task\n- [ ] Two task\n');

        const fresh = await fetch(`${api.base}/api/tasks?refresh=true`).then((value) => value.json()) as UiTasksResponse;
        const firstTask = fresh.tasks.find((candidate) => candidate.noteId === FIRST)!;
        const missing = await fetch(`${api.base}/api/notes/${FIRST}/tasks/toggle`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId: 'f'.repeat(24), checked: true, baseHash: firstTask.noteContentHash }),
        });
        expect(missing.status).toBe(409);
        expect((await missing.json() as { error: { code: string } }).error.code).toBe('STALE_TASK');

        await vault.deleteNote(SECOND);
        const deleted = await fetch(`${api.base}/api/notes/${SECOND}/tasks/toggle`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ taskId: 'a'.repeat(24), checked: true, baseHash: 'a'.repeat(64) }),
        });
        expect(deleted.status).toBe(404);
      } finally {
        await api.close();
        vault.dispose();
      }
    });
  });
});
