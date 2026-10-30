import { describe, expect, it } from 'vitest';
import { IndexedDbDraftJournal, canWriteDraftRevision } from '../ui/src/draftRecoveryJournal.js';

describe('draft recovery journal revision guard', () => {
  it('allows a newer dirty revision but rejects delayed writes already saved or superseded', () => {
    expect(canWriteDraftRevision(8, 7, 7)).toBe(true);
    expect(canWriteDraftRevision(7, 7, -1)).toBe(false);
    expect(canWriteDraftRevision(6, 4, 7)).toBe(false);
  });

  it('keeps drafts scoped by vault, stable note ID, and writer identity', () => {
    const entry = { vaultIdentity: '/vault-a', noteId: 'stable-id', writerId: 'tab-a', revision: 3 };
    const key = (value: typeof entry) => JSON.stringify([value.vaultIdentity, value.noteId, value.writerId]);
    expect(key(entry)).not.toBe(key({ ...entry, vaultIdentity: '/vault-b' }));
    expect(key(entry)).not.toBe(key({ ...entry, noteId: 'another-id' }));
    expect(key(entry)).not.toBe(key({ ...entry, writerId: 'tab-b' }));
  });

  it('reports IndexedDB initialization failure without throwing from construction', async () => {
    const unavailable = { open: () => { throw new Error('storage denied'); } } as never;
    const journal = new IndexedDbDraftJournal(unavailable);
    await expect(journal.list('/vault', 'note-id')).rejects.toThrow('storage denied');
  });
});
