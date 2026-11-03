import { describe, expect, it } from 'vitest';
import { readOrganizationStatuses, writeOrganizationStatuses } from '../ui/src/organizationState.js';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('organization suggestion status storage', () => {
  it('is vault scoped and persists only validated status records', () => {
    const storage = new MemoryStorage();
    writeOrganizationStatuses(storage, '/vault/a', { ['a'.repeat(24)]: 'dismissed', ['b'.repeat(24)]: 'reviewed', bad: 'dismissed' as never });
    expect(readOrganizationStatuses(storage, '/vault/a').entries).toEqual({ ['a'.repeat(24)]: 'dismissed', ['b'.repeat(24)]: 'reviewed' });
    expect(readOrganizationStatuses(storage, '/vault/b').entries).toEqual({});
  });

  it('ignores malformed and unsupported state without preventing analysis', () => {
    const storage = new MemoryStorage();
    storage.setItem('nodus:organization-status:v1:/vault', '{broken');
    expect(readOrganizationStatuses(storage, '/vault')).toMatchObject({ entries: {}, issue: expect.any(String) });
    storage.setItem('nodus:organization-status:v1:/vault', JSON.stringify({ version: 2, entries: { ['c'.repeat(24)]: 'dismissed' } }));
    expect(readOrganizationStatuses(storage, '/vault').entries).toEqual({});
  });
});
