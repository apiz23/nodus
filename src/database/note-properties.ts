import { isUuidV4 } from '../domain/ids.js';
import type { Note } from '../domain/note.js';
import type { DatabaseDefinition, Property, PropertyType } from './schema.js';

export const NOTE_PROPERTIES_FORMAT = 'nodus-note-properties';
export const NOTE_PROPERTIES_VERSION = 1;

export type NotePropertyValue = string | number | boolean | string[];

export type StructuredDataIssueCode =
  | 'INVALID_NAMESPACE'
  | 'UNSUPPORTED_NAMESPACE_VERSION'
  | 'MISSING_DATABASE'
  | 'MISSING_PROPERTY'
  | 'TYPE_MISMATCH'
  | 'INVALID_VALUE'
  | 'MISSING_OPTION';

export interface StructuredDataIssue {
  noteId: string;
  path: string;
  databaseId?: string;
  propertyId?: string;
  code: StructuredDataIssueCode;
  message: string;
}

export interface NoteDatabaseRow {
  noteId: string;
  path: string;
  databaseId: string;
  /** Only schema-valid values are projected. Invalid source values stay in frontmatter. */
  values: Record<string, NotePropertyValue>;
}

export interface NotePropertyProjection {
  rows: NoteDatabaseRow[];
  issues: StructuredDataIssue[];
}

export interface SetNotePropertyInput {
  databaseId: string;
  propertyId: string;
  value?: unknown;
  /** Explicitly remove only this value; existing database membership is retained. */
  remove?: boolean;
  /** Required when this operation creates database membership on the note. */
  confirmCreate?: boolean;
}

export type SetNotePropertyResult =
  | { ok: true; extraFrontmatter: Record<string, unknown> }
  | { ok: false; issues: StructuredDataIssue[] }
  | { ok: false; confirmationRequired: true };

type NoteIdentity = Pick<Note, 'id' | 'path' | 'extraFrontmatter'>;

const NAMESPACE_KEYS = new Set(['format', 'version', 'databases']);

/**
 * Projects a note's opaque `nodus_data` frontmatter against parsed database
 * definitions. This function is read-only: diagnostics never rewrite or
 * discard source values. Unsupported namespace versions remain opaque.
 */
export function projectNoteProperties(
  note: NoteIdentity,
  schemas: ReadonlyMap<string, DatabaseDefinition>,
): NotePropertyProjection {
  const rows: NoteDatabaseRow[] = [];
  const issues: StructuredDataIssue[] = [];
  if (!Object.hasOwn(note.extraFrontmatter, 'nodus_data')) return { rows, issues };

  const namespace = note.extraFrontmatter.nodus_data;
  if (!isRecord(namespace)) {
    issues.push(issue(note, 'INVALID_NAMESPACE', 'nodus_data must be a mapping'));
    return { rows, issues };
  }

  if (namespace.format !== NOTE_PROPERTIES_FORMAT) {
    issues.push(
      issue(note, 'INVALID_NAMESPACE', `nodus_data.format must be "${NOTE_PROPERTIES_FORMAT}"`),
    );
    return { rows, issues };
  }

  const version = namespace.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    issues.push(issue(note, 'INVALID_NAMESPACE', 'nodus_data.version must be a positive integer'));
    return { rows, issues };
  }
  if (version > NOTE_PROPERTIES_VERSION) {
    issues.push(
      issue(
        note,
        'UNSUPPORTED_NAMESPACE_VERSION',
        `nodus_data version ${version} is newer than supported version ${NOTE_PROPERTIES_VERSION}`,
      ),
    );
    return { rows, issues };
  }

  const unknownNamespaceKey = Object.keys(namespace).find((key) => !NAMESPACE_KEYS.has(key));
  if (unknownNamespaceKey !== undefined) {
    issues.push(
      issue(note, 'INVALID_NAMESPACE', `Unknown nodus_data key "${unknownNamespaceKey}"`),
    );
    return { rows, issues };
  }

  if (!isRecord(namespace.databases)) {
    issues.push(issue(note, 'INVALID_NAMESPACE', 'nodus_data.databases must be a mapping'));
    return { rows, issues };
  }

  for (const [databaseId, rawValues] of Object.entries(namespace.databases)) {
    if (!isUuidV4(databaseId)) {
      issues.push(
        issue(note, 'INVALID_NAMESPACE', `Database key "${databaseId}" must be a lowercase UUID v4`),
      );
      continue;
    }

    const schema = schemas.get(databaseId);
    if (schema === undefined) {
      issues.push(
        issue(
          note,
          'MISSING_DATABASE',
          `Database definition "${databaseId}" is missing; stored values were preserved`,
          databaseId,
        ),
      );
      continue;
    }

    const row: NoteDatabaseRow = { noteId: note.id, path: note.path, databaseId, values: {} };
    rows.push(row);
    if (!isRecord(rawValues)) {
      issues.push(
        issue(
          note,
          'INVALID_NAMESPACE',
          `Values for database "${databaseId}" must be a mapping`,
          databaseId,
        ),
      );
      continue;
    }

    for (const [propertyId, value] of Object.entries(rawValues)) {
      if (!isUuidV4(propertyId)) {
        issues.push(
          issue(
            note,
            'INVALID_NAMESPACE',
            `Property key "${propertyId}" must be a lowercase UUID v4`,
            databaseId,
          ),
        );
        continue;
      }

      const property = schema.properties.find((candidate) => candidate.id === propertyId);
      if (property === undefined) {
        issues.push(
          issue(
            note,
            'MISSING_PROPERTY',
            `Property definition "${propertyId}" is missing; stored value was preserved`,
            databaseId,
            propertyId,
          ),
        );
        continue;
      }

      const validation = validatePropertyValue(property, value);
      if (validation.issue !== undefined) {
        issues.push(
          issue(
            note,
            validation.issue.code,
            validation.issue.message,
            databaseId,
            propertyId,
          ),
        );
        continue;
      }
      row.values[propertyId] = validation.value;
    }
  }

  return { rows, issues };
}

/**
 * Builds frontmatter for one explicit property update. Existing namespace
 * issues block mutation, so unknown or invalid data can never be normalized
 * away as a side effect. The caller persists the result with a conditional
 * atomic note write.
 */
export function setNotePropertyValue(
  note: NoteIdentity,
  schemas: ReadonlyMap<string, DatabaseDefinition>,
  input: SetNotePropertyInput,
): SetNotePropertyResult {
  const projection = projectNoteProperties(note, schemas);
  if (projection.issues.length > 0) return { ok: false, issues: projection.issues };

  const schema = schemas.get(input.databaseId);
  if (schema === undefined) {
    return {
      ok: false,
      issues: [
        issue(
          note,
          'MISSING_DATABASE',
          `Database definition "${input.databaseId}" is missing`,
          input.databaseId,
          input.propertyId,
        ),
      ],
    };
  }

  const property = schema.properties.find((candidate) => candidate.id === input.propertyId);
  if (property === undefined) {
    return {
      ok: false,
      issues: [
        issue(
          note,
          'MISSING_PROPERTY',
          `Property definition "${input.propertyId}" is missing`,
          input.databaseId,
          input.propertyId,
        ),
      ],
    };
  }

  const validation = input.remove === true
    ? { value: undefined, issue: undefined }
    : validatePropertyValue(property, input.value);
  if (validation.issue !== undefined) {
    return {
      ok: false,
      issues: [
        issue(
          note,
          validation.issue.code,
          validation.issue.message,
          input.databaseId,
          input.propertyId,
        ),
      ],
    };
  }

  const existingNamespace = note.extraFrontmatter.nodus_data;
  const existingDatabases =
    existingNamespace === undefined
      ? {}
      : (existingNamespace as { databases: Record<string, unknown> }).databases;
  const existingRow = projection.rows.some((row) => row.databaseId === input.databaseId);
  if (input.remove === true && (input.value !== undefined || !existingRow)) {
    return { ok: false, issues: [issue(note, 'INVALID_VALUE', 'Clearing a property requires existing membership and no replacement value', input.databaseId, input.propertyId)] };
  }
  if (!existingRow && input.confirmCreate !== true) {
    return { ok: false, confirmationRequired: true };
  }

  const existingValues = existingDatabases[input.databaseId];
  const nextValues = {
    ...(isRecord(existingValues) ? existingValues : {}),
    ...(input.remove === true ? {} : { [input.propertyId]: validation.value }),
  };
  if (input.remove === true) delete nextValues[input.propertyId];
  const databases = {
    ...existingDatabases,
    [input.databaseId]: nextValues,
  };
  const nodusData = {
    ...(isRecord(existingNamespace) ? existingNamespace : {}),
    format: NOTE_PROPERTIES_FORMAT,
    version: NOTE_PROPERTIES_VERSION,
    databases,
  };

  return {
    ok: true,
    extraFrontmatter: { ...note.extraFrontmatter, nodus_data: nodusData },
  };
}

function validatePropertyValue(
  property: Property,
  value: unknown,
):
  | { value: NotePropertyValue; issue?: never }
  | { issue: { code: 'TYPE_MISMATCH' | 'INVALID_VALUE' | 'MISSING_OPTION'; message: string }; value?: never } {
  switch (property.type satisfies PropertyType) {
    case 'text':
      return typeof value === 'string'
        ? { value }
        : typeMismatch(property, 'a string');
    case 'number':
      if (typeof value !== 'number') return typeMismatch(property, 'a number');
      return Number.isFinite(value)
        ? { value }
        : invalidValue(property, 'must be a finite number');
    case 'checkbox':
      return typeof value === 'boolean'
        ? { value }
        : typeMismatch(property, 'a boolean');
    case 'date':
      if (typeof value !== 'string') return typeMismatch(property, 'a YYYY-MM-DD string');
      return isCalendarDate(value)
        ? { value }
        : invalidValue(property, 'must be a valid YYYY-MM-DD calendar date');
    case 'select':
      if (typeof value !== 'string') return typeMismatch(property, 'an option UUID string');
      if (!isUuidV4(value)) return invalidValue(property, 'must be a lowercase option UUID v4');
      return hasOption(property, value)
        ? { value }
        : missingOption(property, value);
    case 'multi-select':
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        return typeMismatch(property, 'an array of option UUID strings');
      }
      if (value.some((item) => !isUuidV4(item))) {
        return invalidValue(property, 'must contain only lowercase option UUID v4 values');
      }
      if (new Set(value).size !== value.length) {
        return invalidValue(property, 'must not contain duplicate option IDs');
      }
      for (const optionId of value) {
        if (!hasOption(property, optionId)) return missingOption(property, optionId);
      }
      return { value: [...value] };
  }
}

function typeMismatch(
  property: Property,
  expected: string,
): { issue: { code: 'TYPE_MISMATCH'; message: string }; value?: never } {
  return {
    issue: {
      code: 'TYPE_MISMATCH',
      message: `Property "${property.name}" (${property.type}) must be ${expected}`,
    },
  };
}

function invalidValue(
  property: Property,
  reason: string,
): { issue: { code: 'INVALID_VALUE'; message: string }; value?: never } {
  return {
    issue: { code: 'INVALID_VALUE', message: `Property "${property.name}" ${reason}` },
  };
}

function missingOption(
  property: Property,
  optionId: string,
): { issue: { code: 'MISSING_OPTION'; message: string }; value?: never } {
  return {
    issue: {
      code: 'MISSING_OPTION',
      message: `Option "${optionId}" is not defined for property "${property.name}"; stored value was preserved`,
    },
  };
}

function hasOption(property: Property, optionId: string): boolean {
  return property.options?.some((option) => option.id === optionId) ?? false;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function issue(
  note: NoteIdentity,
  code: StructuredDataIssueCode,
  message: string,
  databaseId?: string,
  propertyId?: string,
): StructuredDataIssue {
  return {
    noteId: note.id,
    path: note.path,
    ...(databaseId === undefined ? {} : { databaseId }),
    ...(propertyId === undefined ? {} : { propertyId }),
    code,
    message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
