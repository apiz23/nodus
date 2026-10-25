import { NodusError } from '../domain/errors.js';

/**
 * One step between two adjacent format versions.
 *
 * A migration is a pure function: it must return new data and must not modify
 * the input.
 */
export interface Migration<TFrom = unknown, TTo = unknown> {
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(data: TFrom): TTo;
}

/**
 * Runs a single migration step and normalizes its failure behavior.
 *
 * - Only adjacent steps are accepted (`toVersion === fromVersion + 1`).
 * - A `NodusError` thrown by the step keeps its code.
 * - Any other error becomes `MIGRATION_FAILED`, with the original error as `cause`.
 *
 * This is a contract, not an engine: there is no chain, no file access, and no
 * version detection. Callers select the step.
 */
export function applyMigration<TFrom, TTo>(migration: Migration<TFrom, TTo>, data: TFrom): TTo {
  const { fromVersion, toVersion, migrate } = migration;

  if (!isPositiveInteger(fromVersion) || !isPositiveInteger(toVersion)) {
    throw invalidField('Migration versions must be positive integers');
  }
  if (toVersion !== fromVersion + 1) {
    throw invalidField(
      `Migration must move exactly one version forward, got ${fromVersion} to ${toVersion}`,
    );
  }
  if (typeof migrate !== 'function') {
    throw invalidField('Migration must provide a migrate function');
  }

  try {
    return migrate(data);
  } catch (error) {
    if (error instanceof NodusError) throw error;
    throw new NodusError(
      'MIGRATION_FAILED',
      `Migration from version ${fromVersion} to ${toVersion} failed: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invalidField(message: string): NodusError {
  return new NodusError('INVALID_FIELD', message);
}
