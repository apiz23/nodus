import type { Note } from '../domain/note.js';
import { isUuidV4 } from '../domain/ids.js';
import { projectNoteProperties, type NoteDatabaseRow, type NotePropertyValue, type StructuredDataIssue } from './note-properties.js';
import { isDerivedProperty, type DatabaseDefinition, type Property } from './schema.js';

export interface RelationReference { id: string; title?: string; path?: string; status: 'resolved' | 'missing' | 'incompatible' }
export interface RelatedRow extends NoteDatabaseRow { relations: Record<string, RelationReference[]>; issues: StructuredDataIssue[] }
export function compatibleRelationTarget(row: RelatedRow | undefined): boolean {
  return !!row && !row.issues.some((issue) => issue.code === 'INVALID_NAMESPACE' && (!issue.databaseId || issue.databaseId === row.databaseId));
}
const idsOf = (value: unknown): string[] => typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
const key = (databaseId: string, propertyId: string) => `${databaseId}:${propertyId}`;

/** Cross-schema references are diagnostics, never an excuse to discard portable source data. */
export function configurationIssues(schemas: ReadonlyMap<string, DatabaseDefinition>) {
  const issues = new Map<string, string>();
  const dependencies = new Map<string, string>();
  for (const database of schemas.values()) for (const property of database.properties) {
    const ref = key(database.id, property.id);
    if (property.type === 'relation') {
      const target = schemas.get(property.relation!.databaseId);
      if (!target) issues.set(ref, 'Relation target database is missing');
      const reverse = property.relation!.reversePropertyId;
      if (reverse) {
        const forward = target?.properties.find((item) => item.id === reverse);
        if (forward?.type !== 'relation' || forward.relation?.reversePropertyId || forward.relation?.databaseId !== database.id) issues.set(ref, 'Reverse relation must reference a forward relation targeting this database');
      }
    }
    if (property.type !== 'rollup') continue;
    const config = property.rollup!;
    const relation = database.properties.find((item) => item.id === config.relationPropertyId);
    const target = relation?.type === 'relation' ? schemas.get(relation.relation!.databaseId) : undefined;
    if (!target) { issues.set(ref, 'Rollup requires an existing relation and target database'); continue; }
    const field = target.properties.find((item) => item.id === (config.targetPropertyId ?? config.condition?.propertyId));
    if (config.operation === 'sum' && field?.type !== 'number' && field?.type !== 'rollup') issues.set(ref, 'Sum requires a numeric target property');
    if (['completed-task-count', 'completion-percentage'].includes(config.operation) && field?.type !== 'checkbox') issues.set(ref, 'Completion requires a Checkbox target property');
    if (config.operation === 'conditional-count' && (!field || !conditionFits(field, config.condition!.value))) issues.set(ref, 'Conditional count requires a compatible target property/value');
    if (field?.type === 'rollup') dependencies.set(ref, key(target.id, field.id));
  }
  const circular = new Set<string>();
  for (const ref of dependencies.keys()) {
    const chain: string[] = [];
    let current: string | undefined = ref;
    while (current && !issues.has(current)) {
      if (chain.includes(current)) { for (const item of chain) circular.add(item); break; }
      chain.push(current); current = dependencies.get(current);
    }
  }
  return { issues, circular };
}

function conditionFits(property: Property, value: unknown): boolean {
  if (property.type === 'number' || property.type === 'rollup') return typeof value === 'number' && Number.isFinite(value);
  if (property.type === 'checkbox') return typeof value === 'boolean';
  if (property.type === 'select' || property.type === 'multi-select') return property.options?.some((option) => option.id === value) ?? false;
  if (property.type === 'relation') return typeof value === 'string' && isUuidV4(value);
  if (property.type === 'date') return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  return property.type === 'text' && typeof value === 'string';
}

/** A whole-vault, read-only projection. No reverse IDs or rollup results are persisted. */
export function projectRelations(notes: readonly Note[], schemas: ReadonlyMap<string, DatabaseDefinition>) {
  const byNote = new Map(notes.map((note) => [note.id, note]));
  const rows = new Map<string, Map<string, RelatedRow>>();
  const diagnostics: StructuredDataIssue[] = [];
  const config = configurationIssues(schemas);
  for (const note of notes) {
    const projection = projectNoteProperties(note, schemas);
    diagnostics.push(...projection.issues);
    const memberships = new Map<string, RelatedRow>();
    for (const row of projection.rows) memberships.set(row.databaseId, { ...row, values: { ...row.values }, relations: {}, issues: projection.issues.slice() });
    rows.set(note.id, memberships);
  }
  const report = (row: RelatedRow, property: Property, code: StructuredDataIssue['code'], message: string) => {
    const issue: StructuredDataIssue = { noteId: row.noteId, path: row.path, databaseId: row.databaseId, propertyId: property.id, code, message };
    row.issues.push(issue); diagnostics.push(issue);
  };
  for (const database of schemas.values()) for (const property of database.properties) {
    const ref = key(database.id, property.id);
    const message = config.issues.get(ref) ?? (config.circular.has(ref) ? 'Circular rollup configuration; result is unavailable' : undefined);
    if (message) diagnostics.push({ noteId: '', path: `databases/${database.id}.json`, databaseId: database.id, propertyId: property.id, code: config.circular.has(ref) ? 'CIRCULAR_ROLLUP' : 'INVALID_CONFIGURATION', message });
  }
  const reverse = new Map<string, string[]>();
  for (const memberships of rows.values()) for (const row of memberships.values()) {
    for (const property of schemas.get(row.databaseId)!.properties.filter((item) => item.type === 'relation' && !isDerivedProperty(item))) {
      const references = idsOf(row.values[property.id]).map((id): RelationReference => {
        const note = byNote.get(id);
        const status = !note ? 'missing' : !compatibleRelationTarget(rows.get(id)?.get(property.relation!.databaseId)) ? 'incompatible' : 'resolved';
        if (status !== 'resolved') report(row, property, status === 'missing' ? 'MISSING_TARGET' : 'INCOMPATIBLE_TARGET', `Related note ${id} ${status === 'missing' ? 'is missing/deleted' : 'is not a member of the target database'}; reference preserved`);
        else {
          const ref = `${key(row.databaseId, property.id)}:${id}`;
          const incoming = reverse.get(ref);
          if (incoming) incoming.push(row.noteId); else reverse.set(ref, [row.noteId]);
        }
        return { id, ...(note ? { title: note.title, path: note.path } : {}), status };
      });
      row.relations[property.id] = references;
    }
  }
  for (const memberships of rows.values()) for (const row of memberships.values()) {
    for (const property of schemas.get(row.databaseId)!.properties) {
      const ref = key(row.databaseId, property.id);
      if (config.issues.has(ref)) { report(row, property, 'INVALID_CONFIGURATION', config.issues.get(ref)!); if (property.type !== 'relation' || isDerivedProperty(property)) delete row.values[property.id]; continue; }
      if (config.circular.has(ref)) report(row, property, 'CIRCULAR_ROLLUP', 'Circular rollup configuration; result is unavailable');
      if (property.type === 'relation' && property.relation?.reversePropertyId) {
        const ids = reverse.get(`${key(property.relation.databaseId, property.relation.reversePropertyId)}:${row.noteId}`) ?? [];
        ids.sort();
        row.values[property.id] = ids;
        row.relations[property.id] = ids.map((id) => ({ id, title: byNote.get(id)!.title, path: byNote.get(id)!.path, status: 'resolved' }));
      }
    }
  }
  const evaluated = new Set<string>();
  const evaluating = new Set<string>();
  const evaluate = (row: RelatedRow, property: Property): NotePropertyValue | undefined => {
    if (property.type !== 'rollup') return row.values[property.id];
    const ref = key(row.databaseId, property.id);
    const cell = `${row.noteId}:${ref}`;
    if (config.issues.has(ref) || config.circular.has(ref)) return undefined;
    if (evaluated.has(cell)) return row.values[property.id];
    if (evaluating.size >= 128) { report(row, property, 'INVALID_CONFIGURATION', 'Rollup dependency depth exceeds 128'); return undefined; }
    if (evaluating.has(cell)) { report(row, property, 'CIRCULAR_ROLLUP', 'Circular rollup evaluation; result is unavailable'); return undefined; }
    evaluating.add(cell);
    const calculate = (): number | null | undefined => {
      const setting = property.rollup!;
      const relation = schemas.get(row.databaseId)!.properties.find((item) => item.id === setting.relationPropertyId)!;
      if (config.issues.has(key(row.databaseId, relation.id)) || row.issues.some((issue) => issue.propertyId === relation.id && ['INVALID_VALUE', 'TYPE_MISMATCH'].includes(issue.code))) return undefined;
      const targets = (row.relations[relation.id] ?? []).filter((item) => item.status === 'resolved').map((item) => rows.get(item.id)!.get(relation.relation!.databaseId)!);
      if (setting.operation === 'count') return targets.length;
      const targetProperty = schemas.get(relation.relation!.databaseId)!.properties.find((item) => item.id === (setting.targetPropertyId ?? setting.condition?.propertyId))!;
      if (targets.some((target) => target.issues.some((issue) => issue.databaseId === target.databaseId && issue.propertyId === targetProperty.id && ['TYPE_MISMATCH', 'INVALID_VALUE', 'MISSING_OPTION'].includes(issue.code)))) {
        report(row, property, 'ROLLUP_ERROR', 'A related record has an invalid target value; repair that record before computing this rollup');
        return undefined;
      }
      const values = targets.map((target) => evaluate(target, targetProperty));
      if (targetProperty.type === 'rollup' && values.some((value) => value === undefined)) return undefined;
      if (setting.operation === 'conditional-count') return values.filter((value) => Array.isArray(value) ? value.includes(setting.condition!.value as string) : value === setting.condition!.value).length;
      if (setting.operation === 'sum') {
        const sum = values.reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0);
        if (!Number.isFinite(sum)) { report(row, property, 'ROLLUP_ERROR', 'Rollup sum exceeds the finite numeric range'); return undefined; }
        return sum;
      }
      const completed = values.filter((value) => value === true).length;
      return setting.operation === 'completed-task-count' ? completed : targets.length ? 100 * completed / targets.length : null;
    };
    const value = calculate();
    evaluating.delete(cell); evaluated.add(cell);
    if (value !== undefined) row.values[property.id] = value;
    return value;
  };
  for (const memberships of rows.values()) for (const row of memberships.values()) for (const property of schemas.get(row.databaseId)!.properties) evaluate(row, property);
  return { rows, diagnostics };
}

/** Validate only the requested forward edge set. Dangling existing links remain repairable. */
export function relationWriteIssue(property: Property, notes: readonly Note[], schemas: ReadonlyMap<string, DatabaseDefinition>, value: unknown): string | undefined {
  if (property.type !== 'relation') return undefined;
  if (idsOf(value).length === 0) return undefined;
  const database = property.relation!.databaseId;
  if (!schemas.has(database)) return 'Relation target database does not exist';
  const byId = new Map(notes.map((note) => [note.id, note]));
  for (const id of idsOf(value)) {
    const target = byId.get(id);
    if (!target) return `Related note ${id} is missing/deleted`;
    const projection = projectNoteProperties(target, schemas);
    if (!projection.rows.some((row) => row.databaseId === database) || projection.issues.some((issue) => issue.code === 'INVALID_NAMESPACE' && (!issue.databaseId || issue.databaseId === database))) return `Related note ${id} is not a valid member of the target database`;
  }
  return undefined;
}
