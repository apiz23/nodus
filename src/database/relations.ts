import type { Note } from '../domain/note.js';
import { isUuidV4 } from '../domain/ids.js';
import { projectNoteProperties, type NoteDatabaseRow, type NotePropertyValue, type RelationDiagnostic, type StructuredDataIssue } from './note-properties.js';
import { validateRelationValue, type RelationTargetReference, type RelationWriteDiagnostic } from './relation-contract.js';
import { isDerivedProperty, type DatabaseDefinition, type Property } from './schema.js';
import { evaluateFormula, parseFormula, validateFormula, type FormulaDiagnostic, type FormulaProperty, type FormulaSchema } from './formula-engine.js';
import type { FormulaErrorCode, FormulaExpression, FormulaSourceSpan, FormulaType, FormulaValue } from './formula-contract.js';

/** Backward-compatible name for consumers of the existing relation projection. */
export type RelationReference = RelationTargetReference;
export type { RelationTargetReference } from './relation-contract.js';
export type { RelationDiagnostic };
export interface RelatedRow extends NoteDatabaseRow { relations: Record<string, RelationReference[]>; issues: StructuredDataIssue[] }
export interface IncomingRelationReference {
  sourceId: string;
  sourceTitle: string;
  sourcePath: string;
  sourceDatabaseId: string;
  sourceDatabaseName: string;
  propertyId: string;
  propertyName: string;
  /** Present only when the target schema names a valid derived reciprocal property. */
  reciprocalPropertyId?: string;
  reciprocalPropertyName?: string;
  status: 'resolved' | 'incompatible';
}
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
  projectFormulaValues(notes, rows, schemas, diagnostics);
  return { rows, diagnostics };
}

function projectFormulaValues(notes: readonly Note[], rows: Map<string, Map<string, RelatedRow>>, schemas: ReadonlyMap<string, DatabaseDefinition>, diagnostics: StructuredDataIssue[]): void {
  const compiled = new Map<string, FormulaExpression>();
  const formulaProps = new Map<string, Property>();
  for(const db of schemas.values()) for(const property of db.properties) if(property.type==='formula'){
    const keyRef=key(db.id,property.id); formulaProps.set(keyRef,property); const parsed=parseFormula(property.formula?.expression??''); if(parsed.ok)compiled.set(keyRef,parsed.value);
    else diagnostics.push({noteId:'',path:`databases/${db.id}.json`,databaseId:db.id,propertyId:property.id,code:'FORMULA_ERROR',formulaErrorCode:parsed.diagnostics[0]?.code,formulaErrorSpan:parsed.diagnostics[0]?.span,message:parsed.diagnostics[0]?.message??'Invalid formula syntax'});
  }
  const dependencies=new Map<string,string[]>();
  const refs=(node:FormulaExpression,out:string[])=>{if(node.kind==='property')out.push(node.propertyId);else if(node.kind==='unary')refs(node.operand,out);else if(node.kind==='binary'){refs(node.left,out);refs(node.right,out);}else if(node.kind==='conditional'){refs(node.condition,out);refs(node.whenTrue,out);refs(node.whenFalse,out);}else if(node.kind==='call')for(const a of node.arguments)refs(a,out);};
  for(const [ref,ast] of compiled){const ids:string[]=[];refs(ast,ids);const dbId=ref.slice(0,ref.indexOf(':'));dependencies.set(ref,[...new Set(ids)].map(id=>key(dbId,id)).filter(dep=>formulaProps.has(dep)));}
  const visiting=new Set<string>(),done=new Set<string>(),cyclic=new Set<string>(),order:string[]=[];const visit=(id:string,stack:string[])=>{if(visiting.has(id)){const at=stack.indexOf(id);for(const c of stack.slice(at))cyclic.add(c);return;}if(done.has(id))return;visiting.add(id);for(const dep of dependencies.get(id)??[])visit(dep,[...stack,id]);visiting.delete(id);done.add(id);order.push(id);};for(const id of compiled.keys())visit(id,[]);
  for(const ref of cyclic){const [dbId,propertyId]=ref.split(':');diagnostics.push({noteId:'',path:`databases/${dbId}.json`,databaseId:dbId,propertyId,code:'FORMULA_ERROR',message:'Circular formula dependency'});}
  const inferred=new Map<string,FormulaType>();let changed=true;while(changed){changed=false;for(const ref of order){if(inferred.has(ref)||cyclic.has(ref))continue;const ast=compiled.get(ref);if(!ast)continue;const dbId=ref.slice(0,ref.indexOf(':'));const schema=formulaSchema(schemas.get(dbId)!,inferred);const result=validateFormula(ast,schema);if(result.ok){inferred.set(ref,result.value);changed=true;}}}
  const invalid=new Map<string,FormulaDiagnostic>();for(const [ref,ast] of compiled){if(cyclic.has(ref))continue;const dbId=ref.slice(0,ref.indexOf(':'));const result=validateFormula(ast,formulaSchema(schemas.get(dbId)!,inferred));if(!result.ok){const d=result.diagnostics[0]!;invalid.set(ref,d);const property=formulaProps.get(ref)!;diagnostics.push({noteId:'',path:`databases/${dbId}.json`,databaseId:dbId,propertyId:property.id,code:'FORMULA_ERROR',formulaErrorCode:d.code,formulaErrorSpan:d.span,message:d.message});}}
  for(const note of notes){const membership=rows.get(note.id);if(!membership)continue;for(const row of membership.values()){
    const db=schemas.get(row.databaseId)!;const resolving=new Set<string>(),cache=new Map<string,FormulaValue>();
    const calc=(property:Property):FormulaValue=>{const ref=key(row.databaseId,property.id);const cached=cache.get(ref);if(cached)return cached;if(cyclic.has(ref))return errorValue('CIRCULAR_DEPENDENCY','Circular formula dependency',property.id);if(invalid.has(ref)){const d=invalid.get(ref)!;return errorValue(d.code,d.message,property.id,d.span);}const ast=compiled.get(ref);if(!ast)return errorValue('SYNTAX_ERROR','Formula could not be parsed',property.id);if(resolving.has(ref))return errorValue('CIRCULAR_DEPENDENCY','Circular formula evaluation',property.id);resolving.add(ref);const ctx:Record<string,FormulaValue>={};const referenced:string[]=[];refs(ast,referenced);const required=new Set(referenced);for(const dep of db.properties){if(dep.type==='formula'){if(required.has(dep.id))ctx[dep.id]=calc(dep);continue;}const issue=row.issues.find(x=>x.propertyId===dep.id&&['INVALID_VALUE','TYPE_MISMATCH','MISSING_OPTION'].includes(x.code));if(issue){ctx[dep.id]=errorValue('INVALID_PROPERTY_VALUE',issue.message,dep.id);continue;}const v=row.values[dep.id];ctx[dep.id]=toFormulaValue(dep,v);}
      const result=evaluateFormula(ast,ctx);resolving.delete(ref);cache.set(ref,result);return result;};
    for(const property of db.properties.filter(p=>p.type==='formula')){const result=calc(property);if(result.type==='error'){row.values[property.id]=null;const issue:StructuredDataIssue={noteId:row.noteId,path:row.path,databaseId:row.databaseId,propertyId:property.id,code:'FORMULA_ERROR',formulaErrorCode:result.error.code,formulaErrorSpan:result.error.span,message:result.error.message};row.issues.push(issue);diagnostics.push(issue);}else row.values[property.id]=result.type==='null'?null:result.value;}
  }}
}
function formulaSchema(db:DatabaseDefinition,inferred:ReadonlyMap<string,FormulaType>):FormulaSchema{const map=new Map<string,FormulaProperty>();for(const p of db.properties){const type=p.type==='formula'?'formula':p.type;map.set(p.id,{type:type as FormulaProperty['type'],...(inferred.has(key(db.id,p.id))?{valueType:inferred.get(key(db.id,p.id))}: {})});}return map;}
function toFormulaValue(property:Property,value:NotePropertyValue|undefined):FormulaValue{if(value===undefined||value===null)return {type:'null'};if(property.type==='text'&&typeof value==='string')return {type:'string',value};if(property.type==='date'&&typeof value==='string')return {type:'date',value};if(property.type==='number'&&typeof value==='number')return {type:'number',value};if(property.type==='checkbox'&&typeof value==='boolean')return {type:'boolean',value};if(property.type==='rollup'&&typeof value==='number')return {type:'number',value};return {type:'error',error:{code:'UNSUPPORTED_PROPERTY_TYPE',message:`Property type ${property.type} is not supported by formulas`,propertyId:property.id}};}
function errorValue(code:FormulaErrorCode,message:string,propertyId:string,span?:FormulaSourceSpan):FormulaValue{return {type:'error',error:{code,message,propertyId,...(span?{span}:{})}};}

/**
 * Derives incoming database links from forward note values. This deliberately
 * does not require a reciprocal property: reciprocal configuration only names
 * the matching derived field and never changes which side is authoritative.
 */
export function projectIncomingRelations(notes: readonly Note[], schemas: ReadonlyMap<string, DatabaseDefinition>) {
  const notesById = new Map(notes.map((note) => [note.id, note]));
  const memberships = new Map<string, Map<string, Record<string, NotePropertyValue>>>();
  for (const note of notes) {
    const rows = new Map<string, Record<string, NotePropertyValue>>();
    for (const row of projectNoteProperties(note, schemas).rows) rows.set(row.databaseId, row.values);
    memberships.set(note.id, rows);
  }

  const config = configurationIssues(schemas);
  const byTarget = new Map<string, IncomingRelationReference[]>();
  for (const source of notes) {
    for (const [sourceDatabaseId, values] of memberships.get(source.id) ?? []) {
      const sourceDatabase = schemas.get(sourceDatabaseId);
      if (!sourceDatabase) continue;
      for (const property of sourceDatabase.properties) {
        if (property.type !== 'relation' || isDerivedProperty(property) || !property.relation) continue;
        const stored = values[property.id];
        const targetIds = typeof stored === 'string' ? [stored] : Array.isArray(stored) ? stored : [];
        const targetDatabase = schemas.get(property.relation.databaseId);
        const reciprocal = targetDatabase?.properties.find((candidate) =>
          candidate.type === 'relation' && candidate.relation?.reversePropertyId === property.id &&
          candidate.relation.databaseId === sourceDatabaseId);
        const hasValidReciprocal = !!reciprocal && reciprocal.type === 'relation' &&
          isDerivedProperty(reciprocal) && !config.issues.has(key(targetDatabase!.id, reciprocal.id));

        for (const targetId of targetIds) {
          const target = notesById.get(targetId);
          // Missing UUIDs remain visible on their source field; they cannot
          // appear on a target note that no longer exists.
          if (!target) continue;
          const targetValues = memberships.get(targetId);
          const isMember = !!targetValues?.has(property.relation.databaseId);
          const incoming: IncomingRelationReference = {
            sourceId: source.id,
            sourceTitle: source.title,
            sourcePath: source.path,
            sourceDatabaseId,
            sourceDatabaseName: sourceDatabase.name,
            propertyId: property.id,
            propertyName: property.name,
            ...(hasValidReciprocal && reciprocal
              ? { reciprocalPropertyId: reciprocal.id, reciprocalPropertyName: reciprocal.name }
              : {}),
            status: targetDatabase && isMember ? 'resolved' : 'incompatible',
          };
          const entries = byTarget.get(targetId);
          if (entries) entries.push(incoming); else byTarget.set(targetId, [incoming]);
        }
      }
    }
  }

  for (const entries of byTarget.values()) entries.sort((left, right) =>
    left.sourceDatabaseName.localeCompare(right.sourceDatabaseName) ||
    left.sourceTitle.localeCompare(right.sourceTitle) || left.sourcePath.localeCompare(right.sourcePath) ||
    left.sourceId.localeCompare(right.sourceId) || left.propertyName.localeCompare(right.propertyName) || left.propertyId.localeCompare(right.propertyId));
  return byTarget;
}

/** Validate only the requested forward edge set. Dangling existing links remain repairable. */
export function relationWriteIssue(property: Property, notes: readonly Note[], schemas: ReadonlyMap<string, DatabaseDefinition>, value: unknown): RelationWriteDiagnostic | undefined {
  if (property.type !== 'relation') return undefined;
  if (!property.relation) return { code: 'INVALID_CONFIGURATION', message: 'Relation property configuration is missing' };
  const validation = validateRelationValue(property.relation, value);
  if (!validation.ok) return { code: validation.code, message: validation.message };
  const ids = idsOf(validation.value);
  // Explicit clears remain possible after target deletion so a dangling value can be repaired.
  if (ids.length === 0) return undefined;
  const database = property.relation.databaseId;
  if (!schemas.has(database)) return { code: 'INVALID_CONFIGURATION', message: 'Relation target database does not exist' };
  const byId = new Map(notes.map((note) => [note.id, note]));
  for (const id of ids) {
    const target = byId.get(id);
    if (!target) return { code: 'MISSING_TARGET', targetId: id, message: `Related note ${id} is missing/deleted` };
    const projection = projectNoteProperties(target, schemas);
    if (!projection.rows.some((row) => row.databaseId === database) || projection.issues.some((issue) => issue.code === 'INVALID_NAMESPACE' && (!issue.databaseId || issue.databaseId === database))) {
      return { code: 'INCOMPATIBLE_TARGET', targetId: id, message: `Related note ${id} is not a valid member of the target database` };
    }
  }
  return undefined;
}
