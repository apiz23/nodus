import { DEFAULT_FORMULA_EVALUATION_LIMITS, type FormulaErrorCode, type FormulaEvaluationLimits, type FormulaExpression, type FormulaType, type FormulaValue } from './formula-contract.js';
import { tokenizeFormula, type FormulaParseDiagnostic, type FormulaToken } from './formula-tokenizer.js';
import { isDateOnly } from '../temporal/date.js';

export type FormulaDiagnostic = Omit<FormulaParseDiagnostic, 'code'> & { code: FormulaErrorCode; propertyId?: string; functionName?: string; relatedPropertyIds?: readonly string[] };
export type FormulaResult<T> = { ok: true; value: T } | { ok: false; diagnostics: FormulaDiagnostic[] };
const precedence: Record<string, number> = { or: 2, and: 3, not: 4, '==': 5, '!=': 5, '<': 6, '<=': 6, '>': 6, '>=': 6, '+': 7, '-': 7, '*': 8, '/': 8, '%': 8 };
const err = (message: string, token: FormulaToken, code: FormulaDiagnostic['code'] = 'SYNTAX_ERROR'): FormulaResult<never> => ({ ok: false, diagnostics: [{ code, message, span: token.span }] });

export function parseFormula(source: string, limits: FormulaEvaluationLimits = DEFAULT_FORMULA_EVALUATION_LIMITS): FormulaResult<FormulaExpression> {
  const lex = tokenizeFormula(source, limits); if (!lex.ok) return lex; const ts = lex.value; let i = 0;
  const fail = (m: string, t = ts[i]!) => err(m, t);
  function expr(min = 0, depth = 0): FormulaExpression | undefined {
    if (depth > limits.maxNestingDepth) throw { diagnostic: { code: 'RESOURCE_LIMIT', message: 'Formula nesting limit exceeded', span: ts[i]!.span } };
    let t = ts[i++]!, left: FormulaExpression;
    if (t.kind === 'operator' && (t.text === '-' || t.text === 'not')) { const operand = expr(t.text === 'not' ? 5 : 9, depth + 1); if (!operand) throw { diagnostic: { code: 'SYNTAX_ERROR', message: 'Expected unary operand', span: t.span } }; left = { kind: 'unary', operator: t.text as '-' | 'not', operand, span: { start: t.span.start, end: operand.span?.end ?? t.span.end } }; }
    else if (t.kind === 'leftParen') { const start = t.span.start; const inner = expr(0, depth + 1); if (!inner || ts[i]!.kind !== 'rightParen') throw { diagnostic: { code: 'SYNTAX_ERROR', message: 'Expected closing parenthesis', span: ts[i]!.span } }; t = ts[i++]!; left = { ...inner, span: { start, end: t.span.end } }; }
    else if (t.kind === 'property') left = { kind: 'property', propertyId: String(t.value), span: t.span };
    else if (['string', 'number', 'boolean', 'null'].includes(t.kind)) left = { kind: 'literal', value: { type: t.kind, ...(t.kind === 'null' ? {} : { value: t.value }) } as FormulaExpression & never, span: t.span };
    else if (t.kind === 'identifier' && ts[i]!.kind === 'leftParen') { const name = t.text; i++; const args: FormulaExpression[] = []; if (ts[i]!.kind !== 'rightParen') { do { const a = expr(0, depth + 1); if (!a) throw { diagnostic: { code: 'SYNTAX_ERROR', message: 'Expected function argument', span: ts[i]!.span } }; args.push(a); if (args.length > limits.maxFunctionArguments) throw { diagnostic: { code: 'RESOURCE_LIMIT', message: 'Function argument limit exceeded', span: t.span } }; if (ts[i]!.kind !== 'comma') break; i++; } while (true); } if (ts[i]!.kind !== 'rightParen') throw { diagnostic: { code: 'SYNTAX_ERROR', message: 'Expected closing function parenthesis', span: ts[i]!.span } }; const end = ts[i++]!.span.end; if(name==='if'&&args.length!==3)throw {diagnostic:{code:'ARITY_MISMATCH',message:'if requires exactly three arguments',span:{start:t.span.start,end}}}; left = name === 'if' && args.length === 3 ? { kind: 'conditional', condition: args[0]!, whenTrue: args[1]!, whenFalse: args[2]!, span: { start: t.span.start, end } } : { kind: 'call', name, arguments: args, span: { start: t.span.start, end } }; }
    else throw { diagnostic: { code: 'SYNTAX_ERROR', message: 'Expected expression', span: t.span } };
    while (true) { const op = ts[i]!.text; const p = precedence[op]; if (p === undefined || p < min || ts[i]!.kind !== 'operator') break; const ot = ts[i++]!; if (p >= 5 && p <= 6 && left.kind === 'binary' && (precedence[left.operator] ?? 0) >= 5 && (precedence[left.operator] ?? 0) <= 6) throw { diagnostic: { code: 'SYNTAX_ERROR', message: 'Comparison operators cannot be chained', span: ot.span } }; const right = expr(p + 1, depth); if (!right) throw { diagnostic: { code: 'SYNTAX_ERROR', message: 'Expected right operand', span: ot.span } }; left = { kind: 'binary', operator: ot.text as FormulaExpression & never, left, right, span: { start: left.span?.start ?? ot.span.start, end: right.span?.end ?? ot.span.end } }; }
    return left;
  }
  try { const ast = expr(); if (!ast) return fail('Expected formula'); if (ts[i]!.kind !== 'eof') return fail('Unexpected token'); let count=0;const stack=[ast];while(stack.length){const n=stack.pop()!;if(++count>limits.maxAstNodes)return {ok:false,diagnostics:[{code:'RESOURCE_LIMIT',message:'Formula AST node limit exceeded',span:n.span??{start:0,end:source.length}}]};if(n.kind==='unary')stack.push(n.operand);else if(n.kind==='binary')stack.push(n.left,n.right);else if(n.kind==='conditional')stack.push(n.condition,n.whenTrue,n.whenFalse);else if(n.kind==='call')stack.push(...n.arguments);} return { ok: true, value: ast }; } catch (e) { return { ok: false, diagnostics: [(e as { diagnostic: FormulaDiagnostic }).diagnostic] }; }
}

export interface FormulaProperty { type: 'text' | 'number' | 'checkbox' | 'date' | 'rollup' | 'select' | 'multi-select' | 'relation' | 'formula'; valueType?: FormulaType; relation?: { databaseId: string; cardinality: 'one' | 'many'; properties: FormulaSchema } }
export type FormulaSchema = ReadonlyMap<string, FormulaProperty>;
/** Schema context used by relation-aware formulas and the editor. */
export interface FormulaDatabaseContext {
  id: string;
  name?: string;
  properties: readonly { id: string; type: FormulaProperty['type']; formula?: { expression: string }; relation?: { databaseId: string; cardinality: 'one' | 'many' } }[];
}
/** Builds per-database formula schemas and wires relation targets without copying records. */
export function buildFormulaSchema(databases: readonly FormulaDatabaseContext[], inferred: ReadonlyMap<string, FormulaType>, currentDatabaseId: string): FormulaSchema {
  const base = new Map<string, Map<string, FormulaProperty>>();
  for (const database of databases) {
    const map = new Map<string, FormulaProperty>();
    for (const property of database.properties) {
      map.set(property.id, { type: property.type, ...(inferred.has(property.id) ? { valueType: inferred.get(property.id)! } : {}) });
    }
    base.set(database.id, map);
  }
  for (const database of databases) {
    const map = base.get(database.id)!;
    for (const property of database.properties) {
      if (property.type !== 'relation' || !property.relation) continue;
      const target = base.get(property.relation.databaseId);
      if (target === undefined) continue;
      map.set(property.id, { ...map.get(property.id)!, relation: { databaseId: property.relation.databaseId, cardinality: property.relation.cardinality, properties: target } });
    }
  }
  return base.get(currentDatabaseId) ?? new Map();
}
export function inferFormulaPropertyTypes(
  properties: readonly { id: string; type: FormulaProperty['type']; formula?: { expression: string }; relation?: { databaseId: string; cardinality: 'one' | 'many' } }[],
  databases?: readonly FormulaDatabaseContext[],
  currentDatabaseId = 'current',
): Map<string, FormulaType> {
  const result = new Map<string, FormulaType>();
  const contexts = databases === undefined
    ? [{ id: currentDatabaseId, properties }]
    : databases.map((database) => database.id === currentDatabaseId ? { ...database, properties } : database);
  let changed = true;
  while (changed) {
    changed = false;
    for (const property of properties) {
      if (property.type !== 'formula' || result.has(property.id) || !property.formula) continue;
      const parsed = parseFormula(property.formula.expression);
      if (!parsed.ok) continue;
      const checked = validateFormula(parsed.value, buildFormulaSchema(contexts, result, currentDatabaseId));
      if (checked.ok) {
        result.set(property.id, checked.value);
        changed = true;
      }
    }
  }
  return result;
}
export type FormulaFunctionCategory = 'Strings' | 'Numbers' | 'Dates' | 'Relations';
export interface FormulaFunctionDefinition {
  min: number;
  max: number;
  types: readonly FormulaType[];
  variadic?: FormulaType;
  result: FormulaType;
  nullBehavior: 'propagate';
  category: FormulaFunctionCategory;
  description: string;
  example: string;
  /** Optional editor signature for functions whose arguments are schema references. */
  signature?: string;
}
function defineFunction(
  signature: Pick<FormulaFunctionDefinition, 'min' | 'max' | 'types' | 'result'> & Partial<Pick<FormulaFunctionDefinition, 'variadic'>>,
  category: FormulaFunctionCategory,
  description: string,
  example: string,
  editorSignature?: string,
): FormulaFunctionDefinition {
  return Object.freeze({ ...signature, nullBehavior: 'propagate' as const, category, description, example, ...(editorSignature === undefined ? {} : { signature: editorSignature }) });
}

/** Relation-aware functions use a relation property and a target property ID, never record copies. */
export const RELATION_FORMULA_FUNCTIONS: ReadonlySet<string> = new Set([
  'relatedCount', 'relatedSum', 'relatedAverage', 'relatedMin', 'relatedMax', 'relatedCountWhere',
]);

/** This registry is the source for static checking, runtime arity/type checks, and editor help. */
export const FORMULA_FUNCTIONS = Object.freeze({
  concat: defineFunction({min:1,max:16,types:['string'],variadic:'string',result:'string'},'Strings','Join one or more strings.','concat("Nodus", " ", "notes")'),
  upper: defineFunction({min:1,max:1,types:['string'],result:'string'},'Strings','Convert text to uppercase.','upper("draft")'),
  lower: defineFunction({min:1,max:1,types:['string'],result:'string'},'Strings','Convert text to lowercase.','lower("READY")'),
  trim: defineFunction({min:1,max:1,types:['string'],result:'string'},'Strings','Remove surrounding whitespace.','trim("  title  ")'),
  length: defineFunction({min:1,max:1,types:['string'],result:'number'},'Strings','Count Unicode code points in text.','length("Nodus")'),
  contains: defineFunction({min:2,max:2,types:['string','string'],result:'boolean'},'Strings','Check whether text contains a case-sensitive substring.','contains("Nodus notes", "notes")'),
  abs: defineFunction({min:1,max:1,types:['number'],result:'number'},'Numbers','Return the absolute value.','abs(-4)'),
  round: defineFunction({min:1,max:1,types:['number'],result:'number'},'Numbers','Round to the nearest integer; ties round away from zero.','round(2.5)'),
  floor: defineFunction({min:1,max:1,types:['number'],result:'number'},'Numbers','Round down to the next integer.','floor(2.8)'),
  ceil: defineFunction({min:1,max:1,types:['number'],result:'number'},'Numbers','Round up to the next integer.','ceil(2.2)'),
  min: defineFunction({min:1,max:16,types:['number'],variadic:'number',result:'number'},'Numbers','Return the smallest argument.','min(4, 8, 2)'),
  max: defineFunction({min:1,max:16,types:['number'],variadic:'number',result:'number'},'Numbers','Return the largest argument.','max(4, 8, 2)'),
  date: defineFunction({min:1,max:1,types:['string'],result:'date'},'Dates','Parse a canonical YYYY-MM-DD date.','date("2026-10-31")'),
  year: defineFunction({min:1,max:1,types:['date'],result:'number'},'Dates','Return the four-digit year.','year(date("2026-10-31"))'),
  month: defineFunction({min:1,max:1,types:['date'],result:'number'},'Dates','Return the month number from 1 to 12.','month(date("2026-10-31"))'),
  day: defineFunction({min:1,max:1,types:['date'],result:'number'},'Dates','Return the day of the month.','day(date("2026-10-31"))'),
  dateAdd: defineFunction({min:2,max:2,types:['date','number'],result:'date'},'Dates','Add a whole number of UTC calendar days.','dateAdd(date("2026-10-31"), 7)'),
  dateDiff: defineFunction({min:2,max:2,types:['date','date'],result:'number'},'Dates','Return signed whole days from the first date to the second.','dateDiff(date("2026-10-01"), date("2026-10-31"))'),
  relatedCount: defineFunction({min:1,max:1,types:['number'],result:'number'},'Relations','Count resolved records linked by a relation property. Missing or deleted records are excluded.','relatedCount(@{relation-property-id})','relatedCount(relation) → number'),
  relatedSum: defineFunction({min:2,max:2,types:['number','number'],result:'number'},'Relations','Sum a numeric property across resolved related records. Empty relations return 0.','relatedSum(@{relation-property-id}, @{target-number-property-id})','relatedSum(relation, targetNumber) → number'),
  relatedAverage: defineFunction({min:2,max:2,types:['number','number'],result:'number'},'Relations','Average a numeric property across resolved related records. Empty relations return null.','relatedAverage(@{relation-property-id}, @{target-number-property-id})','relatedAverage(relation, targetNumber) → number'),
  relatedMin: defineFunction({min:2,max:2,types:['number','number'],result:'number'},'Relations','Smallest numeric or date value across resolved related records; empty relations return null.','relatedMin(@{relation-property-id}, @{target-property-id})','relatedMin(relation, targetNumberOrDate) → number | date'),
  relatedMax: defineFunction({min:2,max:2,types:['number','number'],result:'number'},'Relations','Largest numeric or date value across resolved related records; empty relations return null.','relatedMax(@{relation-property-id}, @{target-property-id})','relatedMax(relation, targetNumberOrDate) → number | date'),
  relatedCountWhere: defineFunction({min:3,max:3,types:['number','number','string'],result:'number'},'Relations','Count resolved related records whose target property equals a literal value.','relatedCountWhere(@{relation-property-id}, @{target-property-id}, "value")','relatedCountWhere(relation, target, literal) → number'),
});

export type FormulaEditorSuggestion = {
  name: string;
  kind: 'function' | 'conditional' | 'operator';
  category: 'Strings' | 'Numbers' | 'Dates' | 'Relations' | 'Logic';
  signature: string;
  description: string;
  example: string;
  insertText: string;
  minArguments?: number;
  maxArguments?: number;
  argumentTypes?: readonly FormulaType[];
  returnType?: FormulaType | 'same as branches';
  nullBehavior?: 'propagate' | 'three-valued' | 'custom';
};

/** Function help is derived from the exact definitions used by validation. */
export const FORMULA_EDITOR_SUGGESTIONS: readonly FormulaEditorSuggestion[] = Object.freeze([
  ...Object.entries(FORMULA_FUNCTIONS).map(([name, spec]) => ({
    name, kind: 'function' as const, category: spec.category,
    signature: spec.signature ?? `${name}(${[...spec.types, ...(spec.variadic ? [`…${spec.variadic}` as FormulaType] : [])].join(', ')}) → ${spec.result}`,
    description: spec.description, example: spec.example, insertText: `${name}(`,
    minArguments: spec.min, maxArguments: spec.max, argumentTypes: spec.types, returnType: spec.result, nullBehavior: spec.nullBehavior,
  })),
  {name:'if',kind:'conditional',category:'Logic',signature:'if(boolean, T, T) → T',description:'Choose a value from a true or false condition; null conditions return null.',example:'if(true, "Ready", "Draft")',insertText:'if(',minArguments:3,maxArguments:3,argumentTypes:['boolean','same as branches'] as FormulaEditorSuggestion['argumentTypes'],returnType:'same as branches',nullBehavior:'custom'},
  {name:'and',kind:'operator',category:'Logic',signature:'boolean and boolean → boolean',description:'Require both boolean expressions; supports null propagation.',example:'@{property-id} and true',insertText:'and ',minArguments:2,maxArguments:2,argumentTypes:['boolean','boolean'],returnType:'boolean',nullBehavior:'three-valued'},
  {name:'or',kind:'operator',category:'Logic',signature:'boolean or boolean → boolean',description:'Accept either boolean expression; supports null propagation.',example:'@{property-id} or false',insertText:'or ',minArguments:2,maxArguments:2,argumentTypes:['boolean','boolean'],returnType:'boolean',nullBehavior:'three-valued'},
  {name:'not',kind:'operator',category:'Logic',signature:'not boolean → boolean',description:'Invert a boolean value.',example:'not @{property-id}',insertText:'not ',minArguments:1,maxArguments:1,argumentTypes:['boolean'],returnType:'boolean',nullBehavior:'propagate'},
]);
export function validateFormula(ast: FormulaExpression, schema: FormulaSchema): FormulaResult<FormulaType> {
  const diagnostics: FormulaDiagnostic[]=[];
  const bad = (message: string, node: FormulaExpression, code: FormulaErrorCode = 'TYPE_MISMATCH', propertyId?:string, functionName?:string): undefined => {diagnostics.push({code,message,propertyId,functionName,span:node.span??{start:0,end:0}});return undefined;};
  const checkRelationCall = (n: FormulaExpression & { kind: 'call' }): FormulaType | undefined => {
    const [relationArgument, targetArgument, filterArgument] = n.arguments;
    if (!relationArgument || relationArgument.kind !== 'property') return bad('First argument must be a relation property reference', n, 'TYPE_MISMATCH', undefined, n.name);
    const relation = schema.get(relationArgument.propertyId);
    if (!relation) return bad('Unknown relation property reference', relationArgument, 'UNKNOWN_PROPERTY', relationArgument.propertyId, n.name);
    if (!relation.relation) return bad('First argument must be a relation property', relationArgument, 'UNSUPPORTED_PROPERTY_TYPE', relationArgument.propertyId, n.name);
    if (n.name === 'relatedCount') {
      if (n.arguments.length !== 1) return bad('relatedCount requires exactly one argument', n, 'ARITY_MISMATCH', undefined, n.name);
      return 'number';
    }
    const arity = n.name === 'relatedCountWhere' ? 3 : 2;
    if (n.arguments.length !== arity) return bad(`${n.name} requires exactly ${arity} arguments`, n, 'ARITY_MISMATCH', undefined, n.name);
    if (!targetArgument || targetArgument.kind !== 'property') return bad('Second argument must be a target property reference', n, 'TYPE_MISMATCH', undefined, n.name);
    const target = relation.relation.properties.get(targetArgument.propertyId);
    if (!target) return bad('Unknown target property reference', targetArgument, 'UNKNOWN_PROPERTY', targetArgument.propertyId, n.name);
    if (target.type === 'formula') return bad('Related formula properties are not supported in relation formulas; use a rollup', targetArgument, 'UNSUPPORTED_PROPERTY_TYPE', targetArgument.propertyId, n.name);
    const targetType = formulaPropertyType(target);
    if (!targetType) return bad('Unsupported target property type', targetArgument, 'UNSUPPORTED_PROPERTY_TYPE', targetArgument.propertyId, n.name);
    if (n.name === 'relatedSum' || n.name === 'relatedAverage') {
      return targetType === 'number' ? 'number' : bad('Aggregate requires a numeric target property', targetArgument, 'TYPE_MISMATCH', targetArgument.propertyId, n.name);
    }
    if (n.name === 'relatedMin' || n.name === 'relatedMax') {
      return targetType === 'number' || targetType === 'date' ? targetType : bad('Minimum/maximum requires a numeric or date target property', targetArgument, 'TYPE_MISMATCH', targetArgument.propertyId, n.name);
    }
    if (n.name === 'relatedCountWhere') {
      if (!filterArgument || filterArgument.kind !== 'literal' || filterArgument.value.type === 'null') return bad('Third argument must be a non-null literal value', n, 'TYPE_MISMATCH', undefined, n.name);
      if (filterArgument.value.type !== targetType && !(targetType === 'date' && filterArgument.value.type === 'string')) return bad('Filter literal type must match the target property', filterArgument, 'TYPE_MISMATCH', targetArgument.propertyId, n.name);
      return 'number';
    }
    return bad('Unknown relation function', n, 'UNKNOWN_FUNCTION', undefined, n.name);
  };
  const check = (n: FormulaExpression): FormulaType | undefined => {
    if (n.kind === 'literal') {const v=n.value;if(v.type==='number'&&!Number.isFinite(v.value))bad('Number literal must be finite',n);if(v.type==='string'&&v.value.length>DEFAULT_FORMULA_EVALUATION_LIMITS.maxStringLength)bad('String literal too long',n,'RESOURCE_LIMIT');return v.type;}
    if (n.kind === 'property') { const p = schema.get(n.propertyId); if (!p) return bad('Unknown property reference', n, 'UNKNOWN_PROPERTY',n.propertyId); const t: FormulaType | undefined = formulaPropertyType(p); return t ?? bad('Unsupported property type', n, 'UNSUPPORTED_PROPERTY_TYPE',n.propertyId); }
    if(n.kind==='unary'){const a=check(n.operand);if(!a)return; if(a==='null')return 'null';return (n.operator==='-'&&a==='number')||(n.operator==='not'&&a==='boolean')?a:bad('Invalid unary operand',n);}
    if(n.kind==='conditional'){const c=check(n.condition),a=check(n.whenTrue),b=check(n.whenFalse);if(!c||!a||!b)return;if(c!=='boolean'&&c!=='null')bad('Condition must be boolean or null',n);if(a===b)return a;if(a==='null')return b;if(b==='null')return a;return bad('Branches must match types',n);}
    if(n.kind==='call'){if(RELATION_FORMULA_FUNCTIONS.has(n.name))return checkRelationCall(n);const sig=FORMULA_FUNCTIONS[n.name as keyof typeof FORMULA_FUNCTIONS];const args=n.arguments.map(check);if(!sig)return bad('Unknown function',n,'UNKNOWN_FUNCTION',undefined,n.name);if(args.length<sig.min||args.length>sig.max)bad('Invalid function arity',n,'ARITY_MISMATCH',undefined,n.name);args.forEach((t,i)=>{if(i>=sig.max)return;const expected=sig.types[i]??('variadic'in sig?sig.variadic:undefined);if(t&&t!=='null'&&t!==expected)bad(`Argument ${i+1} must be ${expected}`,n,'TYPE_MISMATCH',undefined,n.name);});if(args.some(t=>!t))return;return sig.result;}
    const a=check(n.left),b=check(n.right);if(!a||!b)return;if(a==='null'||b==='null'){if(n.operator==='=='||n.operator==='!='||n.operator==='<'||n.operator==='<='||n.operator==='>'||n.operator==='>='||n.operator==='and'||n.operator==='or')return 'boolean';return 'null';}if(n.operator==='and'||n.operator==='or')return a==='boolean'&&b==='boolean'?'boolean':bad('Logical operands must be booleans',n);if(n.operator==='=='||n.operator==='!=')return a===b?'boolean':bad('Equality requires matching types',n);if(['<','<=','>','>='].includes(n.operator))return a===b&&['number','date','string'].includes(a)?'boolean':bad('Ordered comparison requires matching ordered types',n);if(n.operator==='+')return a===b&&(a==='number'||a==='string')?a:bad('Addition requires two numbers or two strings',n);return a==='number'&&b==='number'?'number':bad('Arithmetic requires numbers',n);
  };
  let t:FormulaType|undefined;try{t=check(ast);}catch{return {ok:false,diagnostics:[{code:'RESOURCE_LIMIT',message:'Malformed or excessively nested AST',span:ast?.span??{start:0,end:0}}]};}if(diagnostics.length||!t)return {ok:false,diagnostics};return {ok:true,value:t};
}

export type FormulaPropertyValues = Readonly<Record<string, FormulaValue>>;
export interface FormulaRelatedRow { values: Readonly<Record<string, FormulaValue>> }
export type FormulaRelationValues = Readonly<Record<string, readonly FormulaRelatedRow[]>>;
export function evaluateFormula(ast: FormulaExpression, values: FormulaPropertyValues, limits: FormulaEvaluationLimits = DEFAULT_FORMULA_EVALUATION_LIMITS, relations: FormulaRelationValues = {}): FormulaValue {
  let steps = 0; const failure = (code: 'TYPE_MISMATCH' | 'RESOURCE_LIMIT' | 'DIVISION_BY_ZERO' | 'NON_FINITE_RESULT' | 'INVALID_DATE', message: string): FormulaValue => ({ type: 'error', error: { code, message } });
  const runRelation = (n: FormulaExpression & { kind: 'call' }): FormulaValue => {
    const first = n.arguments[0];
    if (!first || first.kind !== 'property') return failure('TYPE_MISMATCH', 'First argument must be a relation property reference');
    const related = relations[first.propertyId] ?? [];
    if (n.name === 'relatedCount') return { type: 'number', value: related.length };
    const second = n.arguments[1];
    if (!second || second.kind !== 'property') return failure('TYPE_MISMATCH', 'Second argument must be a target property reference');
    const read = (): Array<FormulaValue | undefined> => related.map((row) => row.values[second.propertyId]);
    if (n.name === 'relatedCountWhere') {
      const filter = n.arguments[2];
      if (!filter || filter.kind !== 'literal' || filter.value.type === 'null') return failure('TYPE_MISMATCH', 'Third argument must be a non-null literal value');
      const literal = filter.value;
      return { type: 'number', value: read().filter((value) => value !== undefined && (value.type === literal.type || (value.type === 'date' && literal.type === 'string')) && 'value' in value && value.value === literal.value).length };
    }
    const readValues = read();
    const error = readValues.find((value) => value?.type === 'error');
    if (error) return error;
    const numbers = readValues.filter((value): value is { type: 'number'; value: number } => value?.type === 'number').map((value) => value.value);
    const dates = readValues.filter((value): value is { type: 'date'; value: string } => value?.type === 'date').map((value) => value.value);
    if (n.name === 'relatedSum') {
      const sum = numbers.reduce((total, value) => total + value, 0);
      return Number.isFinite(sum) ? { type: 'number', value: sum } : failure('NON_FINITE_RESULT', 'Numeric result is not finite');
    }
    if (n.name === 'relatedAverage') {
      if (numbers.length === 0) return { type: 'null' };
      const average = numbers.reduce((total, value) => total + value, 0) / numbers.length;
      return Number.isFinite(average) ? { type: 'number', value: average } : failure('NON_FINITE_RESULT', 'Numeric result is not finite');
    }
    if (n.name === 'relatedMin' || n.name === 'relatedMax') {
      if (numbers.length > 0 && dates.length > 0) return failure('TYPE_MISMATCH', 'Minimum/maximum requires values of one compatible type');
      const pool: Array<number | string> = numbers.length > 0 ? numbers : dates;
      if (pool.length === 0) return { type: 'null' };
      const value = pool.reduce((selected, candidate) => n.name === 'relatedMin' ? (candidate < selected ? candidate : selected) : (candidate > selected ? candidate : selected));
      return numbers.length > 0 ? { type: 'number', value: value as number } : { type: 'date', value: value as string };
    }
    return failure('TYPE_MISMATCH', 'Unknown relation function');
  };
  const run = (n: FormulaExpression): FormulaValue => {
    if (++steps > limits.maxEvaluationSteps) return failure('RESOURCE_LIMIT', 'Evaluation step limit exceeded');
    if (n.kind === 'literal') return n.value.type === 'null' ? { type: 'null' } : n.value as FormulaValue;
    if (n.kind === 'property') { const v: unknown=values[n.propertyId]; if(v===undefined)return {type:'null'}; if(!validValue(v,limits.maxStringLength))return {type:'error',error:{code:'INVALID_PROPERTY_VALUE',message:'Invalid property value',propertyId:n.propertyId,span:n.span}}; return v; }
    if (n.kind === 'conditional') { const c = run(n.condition); return c.type === 'boolean' ? run(c.value ? n.whenTrue : n.whenFalse) : c.type === 'null' || c.type==='error' ? c : failure('TYPE_MISMATCH','if condition must be boolean or null'); }
    if (n.kind === 'unary') { const a = run(n.operand); if (a.type === 'error' || a.type === 'null') return a; if (n.operator === 'not' && a.type === 'boolean') return { type: 'boolean', value: !a.value }; if (n.operator === '-' && a.type === 'number') return { type: 'number', value: -a.value }; return failure('TYPE_MISMATCH', 'Invalid unary operand'); }
    if (n.kind === 'call') { if (RELATION_FORMULA_FUNCTIONS.has(n.name)) return runRelation(n); const sig=FORMULA_FUNCTIONS[n.name as keyof typeof FORMULA_FUNCTIONS]; if(!sig)return {type:'error',error:{code:'UNKNOWN_FUNCTION',message:"Unknown function",span:n.span}}; if(n.arguments.length<sig.min||n.arguments.length>sig.max)return {type:'error',error:{code:'ARITY_MISMATCH',message:"Invalid function arity",span:n.span}}; const a = n.arguments.map(run); if (a.some(x => x.type === 'error')) return a.find(x => x.type === 'error')!; if (a.some(x => x.type === 'null')) return { type: 'null' }; if(a.some((x,i)=>x.type!==(sig.types[i]??('variadic' in sig?sig.variadic:undefined))))return failure('TYPE_MISMATCH','Invalid function argument type'); const vals = a.map(x => x.type==='string'||x.type==='number'||x.type==='boolean'||x.type==='date' ? x.value : ''); let out: FormulaValue; switch (n.name) { case 'concat': out = { type: 'string', value: vals.join('') }; break; case 'upper': out = { type: 'string', value: String(vals[0]).toUpperCase() }; break; case 'lower': out = { type: 'string', value: String(vals[0]).toLowerCase() }; break; case 'trim': out = { type: 'string', value: String(vals[0]).trim() }; break; case 'length': out = { type: 'number', value: [...String(vals[0])].length }; break; case 'contains': out = { type: 'boolean', value: String(vals[0]).includes(String(vals[1])) }; break; case 'abs': out = { type: 'number', value: Math.abs(Number(vals[0])) }; break; case 'round': out = { type: 'number', value: Math.sign(Number(vals[0])) * Math.floor(Math.abs(Number(vals[0])) + 0.5) }; break; case 'floor': out = { type: 'number', value: Math.floor(Number(vals[0])) }; break; case 'ceil': out = { type: 'number', value: Math.ceil(Number(vals[0])) }; break; case 'min': out = { type: 'number', value: Math.min(...vals.map(Number)) }; break; case 'max': out = { type: 'number', value: Math.max(...vals.map(Number)) }; break; case 'date': out = isDate(String(vals[0])) ? { type: 'date', value: String(vals[0]) } : failure('INVALID_DATE', 'Invalid calendar date'); break; case 'year': case 'month': case 'day': { const d = String(vals[0]); out = { type: 'number', value: Number(d.slice(n.name === 'year' ? 0 : n.name === 'month' ? 5 : 8, n.name === 'year' ? 4 : n.name === 'month' ? 7 : 10)) }; if (n.name === 'month') out.value = Number(d.slice(5,7)); break; } case 'dateAdd': { const d = new Date(`${String(vals[0])}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + Number(vals[1])); out = Number.isInteger(Number(vals[1])) && !isNaN(d.valueOf()) ? { type: 'date', value: d.toISOString().slice(0,10) } : failure('INVALID_DATE', 'Invalid dateAdd arguments'); break; } case 'dateDiff': out = { type: 'number', value: (Date.parse(`${String(vals[1])}T00:00:00Z`) - Date.parse(`${String(vals[0])}T00:00:00Z`)) / 86400000 }; break; default: return { type: 'error', error: { code: 'UNKNOWN_FUNCTION', message: `Unknown function ${n.name}`, span: n.span } }; } if(out.type==='date'&&!isDate(out.value))return failure('INVALID_DATE','Date result is outside supported calendar range'); return out.type === 'string' && out.value.length > limits.maxStringLength ? failure('RESOURCE_LIMIT', 'String output limit exceeded') : out.type === 'number' && !Number.isFinite(out.value) ? failure('NON_FINITE_RESULT', 'Numeric result is not finite') : out; }
    const l = run(n.left); if (l.type === 'error') return l; if (n.operator === 'and' && l.type === 'boolean' && !l.value) return l; if (n.operator === 'or' && l.type === 'boolean' && l.value) return l; const r = run(n.right); if (r.type === 'error') return r; if (l.type === 'null' || r.type === 'null') { if (n.operator === '==' || n.operator === '!=') return { type: 'boolean', value: n.operator === '==' ? l.type === r.type : l.type !== r.type }; if (n.operator === 'and' || n.operator === 'or') { if (l.type === 'null' && r.type === 'boolean' && ((n.operator === 'and' && !r.value) || (n.operator === 'or' && r.value))) return r; return { type: 'null' }; } return { type: 'null' }; }
    if (l.type !== r.type && !(n.operator === '+' && l.type === 'string' && r.type === 'string')) return failure('TYPE_MISMATCH', 'Operands must have matching types');
    if (['==','!=','<','<=','>','>='].includes(n.operator)) { if(n.operator==='=='||n.operator==='!='){const equal=l.type===r.type&&('value'in l)&&('value'in r)&&l.value===r.value;return {type:'boolean',value:n.operator==='=='?equal:!equal};}const cmp=l.type==='string'&&r.type==='string'?compareCodePoints(l.value,r.value):l.type==='date'&&r.type==='date'?compareCodePoints(l.value,r.value):l.type==='number'&&r.type==='number'?l.value-r.value:NaN;if(!Number.isFinite(cmp))return failure('TYPE_MISMATCH','Invalid ordered comparison');return {type:'boolean',value:n.operator==='<'?cmp<0:n.operator==='<='?cmp<=0:n.operator==='>'?cmp>0:cmp>=0}; }
    if (n.operator === 'and' || n.operator === 'or') return { type: 'boolean', value: n.operator === 'and' ? Boolean(l.value && r.value) : Boolean(l.value || r.value) };
    if (n.operator === '+' && l.type === 'string') {const value=l.value+r.value;return value.length>limits.maxStringLength?failure('RESOURCE_LIMIT','String output limit exceeded'):{type:'string',value};}
    if (l.type !== 'number' || r.type !== 'number') return failure('TYPE_MISMATCH', 'Arithmetic requires numbers'); const a = l.value, b = r.value; if ((n.operator === '/' || n.operator === '%') && b === 0) return failure('DIVISION_BY_ZERO', 'Division by zero'); const v = n.operator === '+' ? a+b : n.operator === '-' ? a-b : n.operator === '*' ? a*b : n.operator === '/' ? a/b : a%b; return Number.isFinite(v) ? { type: 'number', value: v } : failure('NON_FINITE_RESULT', 'Numeric result is not finite');
  };
  try { return run(ast); } catch { return {type:'error',error:{code:'TYPE_MISMATCH',message:'Malformed formula AST or evaluation context'}}; }
}
function formulaPropertyType(property: FormulaProperty): FormulaType | undefined {
  if (property.type === 'text') return 'string';
  if (property.type === 'number' || property.type === 'rollup') return 'number';
  if (property.type === 'checkbox') return 'boolean';
  if (property.type === 'date') return 'date';
  if (property.type === 'formula') return property.valueType;
  return undefined;
}
function isDate(s: string): boolean { return isDateOnly(s); }
function compareCodePoints(a:string,b:string):number{const x=Array.from(a,character=>character.codePointAt(0)!),y=Array.from(b,character=>character.codePointAt(0)!);for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]!-y[i]!;return x.length-y.length;}
function validValue(value: unknown, maxStringLength: number): value is FormulaValue { if(!value||typeof value!=='object'||!('type' in value))return false; const v=value as FormulaValue; switch(v.type){case 'null': return true;case 'string':return typeof v.value==='string'&&v.value.length<=maxStringLength;case 'number':return typeof v.value==='number'&&Number.isFinite(v.value);case 'boolean':return typeof v.value==='boolean';case 'date':return typeof v.value==='string'&&isDate(v.value);case 'error':return !!v.error&&typeof v.error.code==='string'&&typeof v.error.message==='string';default:return false;} }
