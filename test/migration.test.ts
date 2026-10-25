import { describe, expect, it } from 'vitest';
import { NodusError } from '../src/domain/errors.js';
import { applyMigration, type Migration } from '../src/format/migration.js';
import { errorCode } from './helpers.js';

const v1 = { format: 'nodus-note', version: 1, title: 'Old', body: 'Body\n' };

const rename: Migration<typeof v1, Record<string, unknown>> = {
  fromVersion: 1,
  toVersion: 2,
  migrate: (data) => ({ ...data, version: 2, bodyText: data.body }),
};

describe('applyMigration', () => {
  it('runs one step and returns the migrated data', () => {
    expect(applyMigration(rename, v1)).toEqual({
      format: 'nodus-note',
      version: 2,
      title: 'Old',
      body: 'Body\n',
      bodyText: 'Body\n',
    });
  });

  it('does not mutate the input', () => {
    const input = JSON.parse(JSON.stringify(v1)) as typeof v1;
    applyMigration(rename, input);
    expect(input).toEqual(v1);
  });

  it('wraps a thrown error as MIGRATION_FAILED and keeps the original message', () => {
    const failing: Migration<typeof v1, unknown> = {
      fromVersion: 1,
      toVersion: 2,
      migrate: () => {
        throw new Error('unsupported legacy field');
      },
    };

    try {
      applyMigration(failing, v1);
      expect.unreachable('expected applyMigration to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(NodusError);
      expect((error as NodusError).code).toBe('MIGRATION_FAILED');
      expect((error as Error).message).toContain('unsupported legacy field');
      expect((error as Error).cause).toBeInstanceOf(Error);
    }
  });

  it('keeps a NodusError code when the migration throws one', () => {
    const failing: Migration<typeof v1, unknown> = {
      fromVersion: 1,
      toVersion: 2,
      migrate: () => {
        throw new NodusError('INVALID_FIELD', 'title is not a string');
      },
    };
    expect(errorCode(() => applyMigration(failing, v1))).toBe('INVALID_FIELD');
  });

  it.each([
    ['the same version', 1, 1],
    ['a backwards step', 2, 1],
    ['a skipped version', 1, 3],
    ['a non-integer version', 1, 2.5],
    ['a zero version', 0, 1],
    ['a negative version', -1, 0],
  ])('rejects %s', (_label, fromVersion, toVersion) => {
    const invalid = { fromVersion, toVersion, migrate: (data: unknown) => data } as Migration<unknown, unknown>;
    expect(errorCode(() => applyMigration(invalid, v1))).toBe('INVALID_FIELD');
  });

  it('rejects a migration whose migrate property is not a function', () => {
    const invalid = { fromVersion: 1, toVersion: 2, migrate: 'nope' } as unknown as Migration<unknown, unknown>;
    expect(errorCode(() => applyMigration(invalid, v1))).toBe('INVALID_FIELD');
  });

  it('never returns partial output when the step fails', () => {
    const partial: Migration<Record<string, unknown>, Record<string, unknown>> = {
      fromVersion: 1,
      toVersion: 2,
      migrate: (data) => {
        data.title = 'Half-migrated';
        throw new Error('mid-step failure');
      },
    };
    expect(errorCode(() => applyMigration(partial, { ...v1 }))).toBe('MIGRATION_FAILED');
  });
});
