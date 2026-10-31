import { isUuidV4 } from '../domain/ids.js';

/** Target IDs are Note.id UUIDs, not paths, titles, or database-local row IDs. */
export type RelationTargetId = string;

export type RelationCardinality = 'one' | 'many';

/** `reversePropertyId`, when present, belongs to the configured target database; schema parsing requires many cardinality. */
export interface RelationPropertyConfiguration {
  databaseId: string;
  cardinality: RelationCardinality;
  reversePropertyId?: string;
}

/** A stored relation is one UUID, a unique UUID list, or null to represent no links. */
export type RelationValue = RelationTargetId | RelationTargetId[] | null;

export type RelationTargetStatus = 'resolved' | 'missing' | 'incompatible';

/** Display metadata is a projection; only `id` is persistent identity. */
export interface RelationTargetReference {
  id: RelationTargetId;
  title?: string;
  path?: string;
  status: RelationTargetStatus;
}

export type RelationValueValidationResult =
  | { ok: true; value: RelationValue }
  | { ok: false; code: 'INVALID_VALUE'; message: string };

export interface RelationWriteDiagnostic {
  code: 'INVALID_VALUE' | 'INVALID_CONFIGURATION' | 'MISSING_TARGET' | 'INCOMPATIBLE_TARGET';
  message: string;
  targetId?: RelationTargetId;
}

/** Validates the persisted value shape without resolving target records. */
export function validateRelationValue(
  configuration: Pick<RelationPropertyConfiguration, 'cardinality'>,
  value: unknown,
): RelationValueValidationResult {
  if (value === null) return { ok: true, value: null };

  if (configuration.cardinality === 'one') {
    if (typeof value !== 'string' || !isUuidV4(value)) {
      return { ok: false, code: 'INVALID_VALUE', message: 'must be null or one stable note UUID v4' };
    }
    return { ok: true, value };
  }

  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !isUuidV4(id))) {
    return { ok: false, code: 'INVALID_VALUE', message: 'must be null or an array of stable note UUID v4 values' };
  }
  if (new Set(value).size !== value.length) {
    return { ok: false, code: 'INVALID_VALUE', message: 'must not contain duplicate target note IDs' };
  }
  return { ok: true, value: [...value] as RelationTargetId[] };
}
