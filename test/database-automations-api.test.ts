import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNote } from '../src/domain/note.js';
import { FileSystemVault } from '../src/storage/fs/vault.js';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';
import { createBackup, exportVault, planImport, restoreBackup, validateBackup } from '../src/storage/index.js';
import type { DatabaseAutomation } from '../src/database/automations.js';

const DB = '11111111-1111-4111-8111-111111111111';
const NOTE = '22222222-2222-4222-8222-222222222222';
const TITLE = '33333333-3333-4333-8333-333333333333';
const STATE = '44444444-4444-4444-8444-444444444444';
const DONE = '55555555-5555-4555-8555-555555555555';
const DUE = '66666666-6666-4666-8666-666666666666';
const NOW = '2026-10-25T12:00:00Z';

async function withApi(fn: (base: string, vault: FileSystemVault) => Promise<void>) {
  const parent = await mkdtemp(join(tmpdir(), 'nodus-automation-api-'));
  const vaultPath = join(parent, 'vault'); const vault = await FileSystemVault.open(vaultPath);
  const middleware = createLocalApiMiddleware({ vaultPath, now: () => NOW });
  const server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (typeof address !== 'object' || !address) throw new Error('No port');
  try { await fn(`http://127.0.0.1:${address.port}`, vault); }
  finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((e) => e ? reject(e) : resolve())); await rm(parent, { recursive: true, force: true }); }
}
async function json<T>(base: string, path: string, method = 'GET', body?: unknown) {
  const response = await fetch(base + path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() as T };
}
function makeAutomation(id: string, trigger: DatabaseAutomation['trigger'], actions: DatabaseAutomation['actions'], extra: Partial<DatabaseAutomation> = {}): DatabaseAutomation {
  return { id, databaseId: DB, name: `Flow ${id.slice(0, 4)}`, enabled: true, trigger, ...(trigger === 'property-updated' ? { triggerPropertyId: STATE } : {}), conditions: [], actions, createdAt: NOW, updatedAt: NOW, ...extra };
}
async function setup(vault: FileSystemVault, initial: Record<string, unknown> = { [TITLE]: 'Task', [STATE]: 0, [DONE]: false, [DUE]: '2026-10-25' }) {
  await vault.createDatabase({ id: DB, name: 'Tasks', properties: [
    { id: TITLE, name: 'Title', type: 'text' }, { id: STATE, name: 'Score', type: 'number' },
    { id: DONE, name: 'Done', type: 'checkbox' }, { id: DUE, name: 'Due', type: 'date' },
  ] });
  const note = { ...createNote({ id: NOTE, title: 'Task', path: 'tasks/task.md', body: '', now: NOW }), extraFrontmatter: { nodus_data: { format: 'nodus-note-properties', version: 1, databases: { [DB]: initial } } } };
  await vault.createNote(note);
  return await vault.readNoteWithHash(NOTE);
}

describe('database automation API and execution', () => {
  it('persists definitions across reopen, conditionally replaces them, and reports stale writes', async () => {
    await withApi(async (base, vault) => {
      await setup(vault);
      const automation = makeAutomation('77777777-7777-4777-8777-777777777777', 'record-created', [{ type: 'set-checkbox', propertyId: DONE, value: true }]);
      const created = await json<{ contentHash: string }>(base, `/api/databases/${DB}/automations`, 'PUT', { automations: [automation], baseHash: null });
      expect(created.status).toBe(200);
      expect((await json<{ automations: DatabaseAutomation[] }>(base, `/api/databases/${DB}/automations`)).body.automations).toEqual([automation]);
      const stale = await json<{ error: { code: string } }>(base, `/api/databases/${DB}/automations`, 'PUT', { automations: [], baseHash: null });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('STALE_WRITE');
      const reopened = await FileSystemVault.open(vault.root);
      expect((await reopened.readDatabaseAutomations()).automations).toEqual([automation]);
      expect(await readFile(join(vault.root, '.nodus-automations/automations.json'), 'utf8')).toContain('record-created');
      reopened.dispose();
    });
  });

  it('runs property-updated actions in declaration order with one history record and no recursive execution', async () => {
    await withApi(async (base, vault) => {
      const note = await setup(vault);
      const automation = makeAutomation('77777777-7777-4777-8777-777777777777', 'property-updated', [
        { type: 'set-checkbox', propertyId: DONE, value: true },
        { type: 'update-date', propertyId: DUE, value: '2026-12-01' },
        { type: 'clear-property', propertyId: TITLE },
        { type: 'set-property', propertyId: TITLE, value: 'Updated by workflow' },
      ]);
      const second = makeAutomation('88888888-8888-4888-8888-888888888888', 'property-updated', [{ type: 'set-property', propertyId: TITLE, value: 'Later matching workflow' }]);
      const config = await json<{ contentHash: string }>(base, `/api/databases/${DB}/automations`, 'PUT', { automations: [second, automation], baseHash: null });
      const result = await json<{ rows: Array<{ values: Record<string, unknown> }> }>(base, `/api/notes/${NOTE}/properties`, 'PUT', { databaseId: DB, propertyId: STATE, value: 4, baseHash: note.hash });
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      const stored = await vault.readNoteWithHash(NOTE);
      const values = (stored.note.extraFrontmatter.nodus_data as { databases: Record<string, Record<string, unknown>> }).databases[DB]!;
      expect(values).toEqual({ [TITLE]: 'Later matching workflow', [STATE]: 4, [DONE]: true, [DUE]: '2026-12-01' });
      const history = (await json<{ executions: Array<{ status: string; completedActions: number }> }>(base, `/api/automations/history?databaseId=${DB}`)).body.executions;
      expect(history).toHaveLength(2);
      expect(history.map((entry) => entry.completedActions)).toEqual([1, 4]);
      expect(config.body.contentHash).toMatch(/^[a-f\d]{64}$/);
    });
  });

  it('supports row creation, condition entry, deletion failure visibility, and invalid configuration rejection', async () => {
    await withApi(async (base, vault) => {
      const note = await setup(vault, {});
      const flows = [
        makeAutomation('77777777-7777-4777-8777-777777777777', 'record-created', [{ type: 'set-checkbox', propertyId: DONE, value: true }]),
        makeAutomation('88888888-8888-4888-8888-888888888888', 'condition-entered', [{ type: 'update-date', propertyId: DUE, value: '2026-11-01' }], { conditions: [{ propertyId: STATE, operator: 'greater', value: 5 }] }),
        makeAutomation('99999999-9999-4999-8999-999999999999', 'record-deleted', [{ type: 'clear-property', propertyId: TITLE }]),
      ];
      const saved = await json(base, `/api/databases/${DB}/automations`, 'PUT', { automations: flows, baseHash: null });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      const invalid = await json<{ error: { code: string } }>(base, `/api/databases/${DB}/automations`, 'PUT', { automations: [makeAutomation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'record-created', [{ type: 'update-date', propertyId: TITLE, value: '2026-11-01' }])], baseHash: (saved.body as { contentHash: string }).contentHash });
      expect(invalid.status).toBe(422);
      expect(invalid.body.error.code).toBe('INVALID_AUTOMATION');

      const member = await json(base, `/api/databases/${DB}/rows`, 'POST', { noteId: NOTE, baseHash: note.hash, confirmCreate: true });
      expect(member.status).toBe(200);
      const afterCreate = await vault.readNoteWithHash(NOTE);
      const changed = await json(base, `/api/notes/${NOTE}/properties`, 'PUT', { databaseId: DB, propertyId: STATE, value: 6, baseHash: afterCreate.hash });
      expect(changed.status).toBe(200);
      const afterActions = await vault.readNoteWithHash(NOTE);
      expect((afterActions.note.extraFrontmatter.nodus_data as { databases: Record<string, Record<string, unknown>> }).databases[DB]).toMatchObject({ [DONE]: true, [DUE]: '2026-11-01' });
      const deletion = await json(base, `/api/notes/${NOTE}`, 'DELETE', { baseHash: afterActions.hash });
      expect(deletion.status).toBe(200);
      const history = (await vault.listAutomationHistory()).filter((entry) => entry.databaseId === DB);
      expect(history.map((entry) => entry.status)).toContain('failure');
      expect(history.find((entry) => entry.trigger === 'record-deleted')).toMatchObject({ status: 'failure', completedActions: 0 });
    });
  });

  it('claims a repeated event only once under the root lock', async () => {
    await withApi(async (_base, vault) => {
      const execution = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', eventId: 'same-event', automationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', databaseId: DB, recordId: NOTE, trigger: 'record-created' as const, status: 'running' as const, startedAt: NOW, finishedAt: NOW, completedActions: 0 };
      const claims = await Promise.all([vault.claimAutomationEvent('same-event', execution), vault.claimAutomationEvent('same-event', { ...execution, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })]);
      expect(claims.sort()).toEqual([false, true]);
      expect(await vault.listAutomationHistory()).toHaveLength(1);
    });
  });

  it('round-trips definitions and execution history through portable export and backup restore', async () => {
    await withApi(async (_base, vault) => {
      await setup(vault);
      const flow = makeAutomation('77777777-7777-4777-8777-777777777777', 'record-created', [{ type: 'set-checkbox', propertyId: DONE, value: true }]);
      await vault.writeDatabaseAutomations([flow], null);
      const claim = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', eventId: 'backup-event', automationId: flow.id, databaseId: DB, recordId: NOTE, trigger: 'record-created' as const, status: 'running' as const, startedAt: NOW, finishedAt: NOW, completedActions: 0 };
      expect(await vault.claimAutomationEvent(claim.eventId, claim)).toBe(true);
      await vault.finishAutomationExecution({ ...claim, status: 'success', completedActions: 1 });

      const backupDir = join(vault.root, '..', 'backup');
      const report = await createBackup(vault, backupDir, { now: NOW });
      expect(report.automationFiles).toBe(2);
      const checked = await validateBackup(backupDir);
      expect(checked.entries.filter((entry) => entry.kind.startsWith('automation-'))).toHaveLength(2);
      const restoreRoot = join(vault.root, '..', 'restored');
      await restoreBackup(backupDir, restoreRoot);
      const restored = await FileSystemVault.open(restoreRoot);
      expect((await restored.readDatabaseAutomations()).automations).toEqual([flow]);
      expect(await restored.listAutomationHistory()).toMatchObject([{ eventId: 'backup-event', status: 'success' }]);

      const exportDir = join(vault.root, '..', 'portable');
      expect((await exportVault(vault, exportDir)).automationFiles).toBe(2);
      const importPlan = await planImport(exportDir);
      const importRoot = join(vault.root, '..', 'imported');
      const imported = await FileSystemVault.open(importRoot);
      await imported.applyImport(importPlan);
      expect((await imported.readDatabaseAutomations()).automations).toEqual([flow]);
      expect(await imported.listAutomationHistory()).toMatchObject([{ eventId: 'backup-event', status: 'success' }]);
      restored.dispose(); imported.dispose();
    });
  });
});
