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

async function startApi(root: string) {
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

async function response<T>(base: string, path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const result = await fetch(`${base}${path}`, init);
  return { status: result.status, body: await result.json() as T };
}

function putTask(base: string, noteId: string, value: { taskId: string; checked: boolean; baseHash: string }) {
  return response<{ task?: UiToggleTaskResponse['task']; note?: UiToggleTaskResponse['note']; error?: { code: string } }>(
    base,
    `/api/notes/${noteId}/tasks/toggle`,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) },
  );
}

function scheduleTask(base: string, noteId: string, value: { taskId: string; scheduledDate: string; baseHash: string }) {
  return response<{ task?: UiToggleTaskResponse['task']; projection?: UiTasksResponse; error?: { code: string } }>(base, `/api/notes/${noteId}/tasks/schedule`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
}

describe('Phase 27 task API with Phase 28 temporal metadata', () => {
  it('schedules and reschedules a current task without changing its due date or completion', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createNote(createNote({ id: FIRST, title: 'Task', path: 'task.md', body: '- [x] Release [due:2026-11-29]\n  continuation\n', now: NOW }));
      const api = await startApi(root);
      try {
        const listed = await response<UiTasksResponse>(api.base, '/api/tasks');
        const task = listed.body.tasks[0]!;
        const saved = await scheduleTask(api.base, FIRST, { taskId: task.id, scheduledDate: '2026-11-20', baseHash: task.noteContentHash });
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
        expect((await vault.readNote(FIRST)).body).toContain('[scheduled:2026-11-20]');
        expect(saved.body.task).toMatchObject({ checked: true, dueDate: '2026-11-29', scheduledDate: '2026-11-20', id: task.id });
        expect(saved.body.projection?.tasks.find((item) => item.id === task.id)).toMatchObject({ dueDate: '2026-11-29', scheduledDate: '2026-11-20', checked: true });
        const note = await vault.readNote(FIRST);
        expect(note.body).toContain('- [x] Release [due:2026-11-29] [scheduled:2026-11-20]');
        expect(note.body).toContain('continuation');
        const moved = await scheduleTask(api.base, FIRST, { taskId: task.id, scheduledDate: '2026-11-21', baseHash: (await vault.readNoteWithHash(FIRST)).hash });
        expect(moved.body.task).toMatchObject({ id: task.id, scheduledDate: '2026-11-21', dueDate: '2026-11-29', checked: true });
      } finally { await api.close(); }
    });
  });
  it('lists the compatible task DTO and keeps scheduled date separate from due date', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      const body = [
        '# Work',
        '- [ ] Ship report [due:2026-11-10] [scheduled:2026-11-08] [priority:high]',
        '- [x] Due only [due:2026-11-12]',
        '- [ ] Duplicate [scheduled:2026-11-14] [scheduled:2026-11-15] [due:2026-11-16] [due:2026-11-17]',
        '- [ ] Repeated task',
        '- [ ] Repeated task',
      ].join('\n');
      await vault.createNote(createNote({ id: FIRST, title: 'Project', path: 'project.md', body, now: NOW }));
      const api = await startApi(root);
      try {
        const listed = await response<UiTasksResponse>(api.base, '/api/tasks');
        expect(listed.status).toBe(200);
        expect(listed.body.counts).toEqual({ total: 5, open: 4, completed: 1, notesWithTasks: 1 });
        const [scheduled, dueOnly, duplicate, repeatedA, repeatedB] = listed.body.tasks;
        expect(scheduled).toMatchObject({ dueDate: '2026-11-10', dueDateStatus: 'valid', scheduledDate: '2026-11-08', scheduledDateStatus: 'valid', priority: 'high', checked: false });
        expect(dueOnly).toMatchObject({ dueDate: '2026-11-12', scheduledDate: null, scheduledDateStatus: 'missing', checked: true });
        expect(duplicate).toMatchObject({
          text: 'Duplicate [scheduled:2026-11-14] [scheduled:2026-11-15] [due:2026-11-16] [due:2026-11-17]',
          scheduledDate: null, scheduledDateStatus: 'invalid', dueDate: null, dueDateStatus: 'invalid',
        });
        expect(repeatedA?.id).not.toBe(repeatedB?.id);
        expect(scheduled).toHaveProperty('noteContentHash');
        expect(scheduled).toHaveProperty('markerFrom');
        expect(scheduled?.noteContentHash).toMatch(/^[0-9a-f]{64}$/);
        expect(scheduled?.noteContentHash).toBe((await vault.readNoteWithHash(FIRST)).hash);
      } finally {
        await api.close();
        vault.dispose();
      }
    });
  });

  it('toggles and reopens only the selected task marker while preserving temporal Markdown', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      const body = '- [ ] First [due:2026-11-10] [scheduled:2026-11-08]\n- [ ] Second\n';
      await vault.createNote(createNote({ id: FIRST, title: 'Project', path: 'project.md', body, now: NOW }));
      await vault.createNote(createNote({ id: SECOND, title: 'Other', path: 'other.md', body: '- [x] Done\n', now: NOW }));
      const api = await startApi(root);
      try {
        const listed = await response<UiTasksResponse>(api.base, '/api/tasks');
        expect(listed.body.tasks.map((task) => task.noteId)).toEqual([SECOND, FIRST, FIRST]);
        const target = listed.body.tasks.find((task) => task.noteId === FIRST)!;
        const done = await putTask(api.base, FIRST, { taskId: target.id, checked: true, baseHash: target.noteContentHash });
        expect(done.status).toBe(200);
        expect(done.body.task).toMatchObject({ checked: true, dueDate: '2026-11-10', scheduledDate: '2026-11-08' });
        expect((await vault.readNoteWithHash(FIRST)).note.body).toBe('- [x] First [due:2026-11-10] [scheduled:2026-11-08]\n- [ ] Second\n');

        const refreshed = await response<UiTasksResponse>(api.base, '/api/tasks?refresh=true');
        const reopenedTask = refreshed.body.tasks.find((task) => task.noteId === FIRST)!;
        const reopened = await putTask(api.base, FIRST, { taskId: reopenedTask.id, checked: false, baseHash: reopenedTask.noteContentHash });
        expect(reopened.status).toBe(200);
        expect(reopened.body.task?.checked).toBe(false);
        expect((await vault.readNoteWithHash(FIRST)).note.body).toContain('- [ ] First [due:2026-11-10] [scheduled:2026-11-08]');
      } finally {
        await api.close();
        vault.dispose();
      }
    });
  });

  it('keeps task identity across a note move and returns its current navigation path', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createNote(createNote({ id: FIRST, title: 'Project', path: 'project.md', body: '- [ ] Move-safe task\n', now: NOW }));
      const api = await startApi(root);
      try {
        const listed = await response<UiTasksResponse>(api.base, '/api/tasks');
        const task = listed.body.tasks[0]!;
        await vault.moveNote(FIRST, 'archive/project.md');
        const toggled = await putTask(api.base, FIRST, { taskId: task.id, checked: true, baseHash: task.noteContentHash });
        expect(toggled.status).toBe(200);
        expect(toggled.body.note?.path).toBe('archive/project.md');
        expect(toggled.body.task?.checked).toBe(true);
      } finally {
        await api.close();
        vault.dispose();
      }
    });
  });

  it('rejects changed Markdown, missing tasks, and deleted notes without applying stale offsets', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createNote(createNote({ id: FIRST, title: 'Project', path: 'project.md', body: '- [ ] Original task [scheduled:2026-11-08]\n', now: NOW }));
      await vault.createNote(createNote({ id: SECOND, title: 'Deleted', path: 'deleted.md', body: '- [ ] Delete me\n', now: NOW }));
      const api = await startApi(root);
      try {
        const listed = await response<UiTasksResponse>(api.base, '/api/tasks');
        const staleTask = listed.body.tasks.find((task) => task.noteId === FIRST)!;
        const current = await vault.readNoteWithHash(FIRST);
        const changedBody = 'Prefix added\n' + current.note.body;
        await vault.replaceNote({ ...current.note, body: changedBody }, { expectedHash: current.hash });

        const stale = await putTask(api.base, FIRST, { taskId: staleTask.id, checked: true, baseHash: staleTask.noteContentHash });
        expect(stale.status).toBe(409);
        expect(stale.body.error?.code).toBe('STALE_WRITE');
        expect((await vault.readNoteWithHash(FIRST)).note.body).toBe(changedBody);

        const fresh = await response<UiTasksResponse>(api.base, '/api/tasks?refresh=true');
        const currentTask = fresh.body.tasks.find((task) => task.noteId === FIRST)!;
        const missing = await putTask(api.base, FIRST, { taskId: 'f'.repeat(24), checked: true, baseHash: currentTask.noteContentHash });
        expect(missing.status).toBe(409);
        expect(missing.body.error?.code).toBe('STALE_TASK');

        await vault.deleteNote(SECOND);
        const deleted = await putTask(api.base, SECOND, { taskId: 'a'.repeat(24), checked: true, baseHash: 'a'.repeat(64) });
        expect(deleted.status).toBe(404);
      } finally {
        await api.close();
        vault.dispose();
      }
    });
  });

  it('rejects stale and duplicate scheduling metadata without changing Markdown', async () => {
    await withTempDir(async (root) => {
      const vault = await FileSystemVault.open(root);
      await vault.createNote(createNote({ id: FIRST, title: 'Project', path: 'project.md', body: '- [ ] Original [scheduled:2026-11-08] [scheduled:2026-11-09]\n', now: NOW }));
      const api = await startApi(root);
      try {
        const listed = await response<UiTasksResponse>(api.base, '/api/tasks');
        const task = listed.body.tasks[0]!;
        const before = await vault.readNoteWithHash(FIRST);
        const duplicate = await scheduleTask(api.base, FIRST, { taskId: task.id, scheduledDate: '2026-11-12', baseHash: task.noteContentHash });
        expect(duplicate).toMatchObject({ status: 422, body: { error: { code: 'TASK_DATE_INVALID' } } });
        expect((await vault.readNoteWithHash(FIRST)).hash).toBe(before.hash);
        const fresh = await vault.readNoteWithHash(FIRST);
        await vault.replaceNote({ ...fresh.note, body: '- [ ] Concurrent change\n' }, { expectedHash: fresh.hash });
        const stale = await scheduleTask(api.base, FIRST, { taskId: task.id, scheduledDate: '2026-11-12', baseHash: task.noteContentHash });
        expect(stale).toMatchObject({ status: 409, body: { error: { code: 'STALE_WRITE' } } });
        expect((await vault.readNote(FIRST)).body).toBe('- [ ] Concurrent change\n');
      } finally { await api.close(); vault.dispose(); }
    });
  });
});
