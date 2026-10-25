/**
 * Deterministic conflict-copy construction.
 *
 * Conflict copies are ordinary Nodus documents with fresh UUIDs, so they remain
 * portable and can be edited without special tooling.
 */

import { randomUUID } from 'node:crypto';
import type { DatabaseDefinition } from '../database/schema.js';
import type { Note } from '../domain/note.js';
import { foldPath } from './paths.js';

export interface ConflictCopy<T> {
  document: T;
  path: string;
}

export function conflictSuffix(now: string, deviceId: string): string {
  const stamp = now.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const device = deviceId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'device';
  return `${stamp}-${device}`;
}

export function makeConflictNote(
  note: Note,
  suffix: string,
  existingPaths: Set<string>,
  now: string,
): ConflictCopy<Note> {
  const path = uniqueNotePath(note.path, suffix, existingPaths);
  return {
    document: {
      ...note,
      id: randomUUID(),
      title: `${note.title} (conflict ${suffix})`,
      path,
      createdAt: now,
      updatedAt: now,
    },
    path,
  };
}

export function makeConflictDatabase(
  database: DatabaseDefinition,
  suffix: string,
): ConflictCopy<DatabaseDefinition> {
  const id = randomUUID();
  return {
    document: {
      ...database,
      id,
      name: `${database.name} (conflict ${suffix})`,
    },
    path: `databases/${id}.json`,
  };
}

export function uniqueNotePath(
  originalPath: string,
  suffix: string,
  existingPaths: Set<string>,
): string {
  const stem = originalPath.endsWith('.md') ? originalPath.slice(0, -3) : originalPath;
  for (let index = 1; index < 10_000; index += 1) {
    const numeric = index === 1 ? '' : `-${index}`;
    const candidate = `${stem} (conflict ${suffix})${numeric}.md`;
    if (!existingPaths.has(foldPath(candidate))) {
      existingPaths.add(foldPath(candidate));
      return candidate;
    }
  }
  throw new Error('Could not allocate a conflict-copy path');
}
