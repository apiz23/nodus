import type { FormulaExpression, FormulaType, FormulaValue } from '../../../src/database/formula-contract.js';
import { evaluateFormula, FORMULA_EDITOR_SUGGESTIONS, inferFormulaPropertyTypes, parseFormula, validateFormula, type FormulaDiagnostic, type FormulaEditorSuggestion, type FormulaProperty, type FormulaSchema } from '../../../src/database/formula-engine.js';
import type { Property } from '../../../src/database/schema.js';
import type { UiDatabaseRow } from '../../../src/ui-server/dto.js';

export interface FormulaDraftAnalysis {
  diagnostics: FormulaDiagnostic[];
  resultType?: FormulaType;
  dependencies: string[];
  preview?: FormulaValue;
}

export interface FormulaCompletionOption {
  key: string;
  label: string;
  detail: string;
  insertText: string;
  disabled?: boolean;
  reason?: string;
  documentation?: FormulaEditorSuggestion;
}
export interface FormulaCompletion {
  kind: 'property' | 'function';
  from: number;
  to: number;
  options: FormulaCompletionOption[];
}

export function analyzeFormulaDraft(
  expression: string,
  properties: readonly Property[],
  propertyId: string,
  previewRow?: Pick<UiDatabaseRow, 'values' | 'issues'>,
): FormulaDraftAnalysis {
  const candidateProperties = properties.map((property) => property.id === propertyId && property.type === 'formula'
    ? { ...property, formula: { expression } }
    : property);
  const parsed = parseFormula(expression);
  if (!parsed.ok) return { diagnostics: parsed.diagnostics, dependencies: [] };

  const dependencies = [...new Set(propertyReferences(parsed.value))];
  const cycle = formulaCycleContaining(candidateProperties, propertyId);
  const inferred = inferFormulaPropertyTypes(candidateProperties);
  const schema = formulaSchema(candidateProperties, inferred);
  const checked = validateFormula(parsed.value, schema);
  const diagnostics = [...checked.ok ? [] : checked.diagnostics];
  if (cycle) diagnostics.push({
    code: 'CIRCULAR_DEPENDENCY',
    message: `Circular dependency: ${cycle.map((id) => candidateProperties.find((property) => property.id === id)?.name ?? id).join(' → ')}`,
    propertyId, relatedPropertyIds: cycle,
    span: parsed.value.span ?? { start: 0, end: expression.length },
  });

  const resultType = inferred.get(propertyId) ?? (checked.ok ? checked.value : undefined);
  let preview: FormulaValue | undefined;
  if (diagnostics.length === 0 && checked.ok && previewRow) {
    const values: Record<string, FormulaValue> = {};
    for (const property of candidateProperties) {
      if (property.type === 'formula') continue;
      const issue = previewRow.issues.find((item) => item.propertyId === property.id && ['FORMULA_ERROR', 'ROLLUP_ERROR', 'CIRCULAR_ROLLUP', 'INVALID_VALUE', 'TYPE_MISMATCH'].includes(item.code));
      values[property.id] = issue
        ? { type: 'error', error: { code: 'INVALID_PROPERTY_VALUE', message: issue.message, propertyId: property.id } }
        : toFormulaValue(property, previewRow.values[property.id], inferred.get(property.id));
    }
    const cache = new Map<string, FormulaValue>();
    const visiting = new Set<string>();
    const calculate = (id: string): FormulaValue => {
      const cached = cache.get(id);
      if (cached) return cached;
      if (visiting.has(id)) return { type: 'error', error: { code: 'CIRCULAR_DEPENDENCY', message: 'Circular formula dependency', propertyId: id } };
      const property = candidateProperties.find((candidate) => candidate.id === id && candidate.type === 'formula');
      if (!property) return { type: 'error', error: { code: 'UNKNOWN_PROPERTY', message: 'Formula property is unavailable.', propertyId: id } };
      const source = id === propertyId ? expression : property.formula?.expression ?? '';
      const child = parseFormula(source);
      if (!child.ok) return { type: 'error', error: { code: child.diagnostics[0]?.code ?? 'SYNTAX_ERROR', message: child.diagnostics[0]?.message ?? 'Invalid formula.', propertyId: id } };
      const checkedChild = validateFormula(child.value, schema);
      if (!checkedChild.ok) return { type: 'error', error: { code: checkedChild.diagnostics[0]?.code ?? 'TYPE_MISMATCH', message: checkedChild.diagnostics[0]?.message ?? 'Invalid formula.', propertyId: id } };
      visiting.add(id);
      const context = { ...values };
      for (const dependency of propertyReferences(child.value)) {
        if (candidateProperties.some((candidate) => candidate.id === dependency && candidate.type === 'formula')) context[dependency] = calculate(dependency);
      }
      const result = evaluateFormula(child.value, context);
      visiting.delete(id);
      cache.set(id, result);
      return result;
    };
    preview = calculate(propertyId);
  }
  return { diagnostics, ...(resultType ? { resultType } : {}), dependencies, ...(preview ? { preview } : {}) };
}

export function formulaCompletions(source: string, cursor: number, properties: readonly Property[]): FormulaCompletion | undefined {
  const before = source.slice(0, cursor);
  if (insideStringLiteral(before)) return undefined;
  const propertyMatch = /@\{([0-9a-z-]*)$/i.exec(before);
  if (propertyMatch) {
    const from = propertyMatch.index;
    const query = propertyMatch[1]!.toLowerCase();
    const types = inferFormulaPropertyTypes(properties);
    const matches = properties.filter((property) => query === '' || property.id.toLowerCase().includes(query) || property.name.toLocaleLowerCase().includes(query));
    const supported = matches.filter((property) => supportedFormulaProperty(property, types)).slice(0, 40).map((property) => ({
      key: property.id,
      label: property.name,
      detail: `${formulaPropertyType(property, types)} · ${property.id}`,
      insertText: `@{${property.id}}`,
    }));
    const unsupported = matches.filter((property) => !supportedFormulaProperty(property, types)).slice(0, 8).map((property) => ({
      key: `unsupported:${property.id}`,
      label: property.name,
      detail: `${propertyTypeName(property)} · unavailable`,
      insertText: '',
      disabled: true,
      reason: 'Formula references currently support text, number, checkbox, date, numeric rollup, and typed formula values.',
    }));
    return { kind: 'property', from, to: cursor, options: [...supported, ...unsupported] };
  }

  const identifier = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before);
  if (!identifier) return undefined;
  const query = identifier[0]!.toLocaleLowerCase();
  const options = FORMULA_EDITOR_SUGGESTIONS.filter((item) => item.name.toLocaleLowerCase().startsWith(query)).map((item) => ({
    key: item.name,
    label: item.name,
    detail: `${item.category} · ${item.signature}`,
    insertText: item.insertText,
    documentation: item,
  }));
  return options.length ? { kind: 'function', from: identifier.index, to: cursor, options } : undefined;
}

function insideStringLiteral(source: string): boolean {
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\\') { index += 1; continue; }
    if (source[index] === '"') quoted = !quoted;
  }
  return quoted;
}

export function supportedFormulaProperty(property: Property, inferredTypes: ReadonlyMap<string, FormulaType>): boolean {
  if (property.type === 'text' || property.type === 'number' || property.type === 'checkbox' || property.type === 'date' || property.type === 'rollup') return true;
  return property.type === 'formula' && inferredTypes.has(property.id) && inferredTypes.get(property.id) !== 'error';
}

export function inferFormulaTypes(properties: readonly Property[]): Map<string, FormulaType> {
  return inferFormulaPropertyTypes(properties);
}

export function formulaTypeLabel(type: FormulaType | undefined): string {
  if (!type) return 'Unknown';
  if (type === 'null') return 'Null';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function formatFormulaPreview(value: FormulaValue): string {
  if (value.type === 'null') return 'Null';
  if (value.type === 'error') return value.error.message;
  if (value.type === 'boolean') return value.value ? 'Yes' : 'No';
  return String(value.value);
}

function formulaSchema(properties: readonly Property[], inferred: ReadonlyMap<string, FormulaType>): FormulaSchema {
  const result = new Map<string, FormulaProperty>();
  for (const property of properties) {
    result.set(property.id, {
      type: property.type,
      ...(inferred.has(property.id) ? { valueType: inferred.get(property.id)! } : {}),
    });
  }
  return result;
}

function toFormulaValue(property: Property, value: unknown, inferredType?: FormulaType): FormulaValue {
  if (value === undefined || value === null) return { type: 'null' };
  if (property.type === 'text' && typeof value === 'string') return { type: 'string', value };
  if (property.type === 'date' && typeof value === 'string') return { type: 'date', value };
  if ((property.type === 'number' || property.type === 'rollup') && typeof value === 'number') return { type: 'number', value };
  if (property.type === 'checkbox' && typeof value === 'boolean') return { type: 'boolean', value };
  if (property.type === 'formula' && inferredType && inferredType !== 'error' && inferredType !== 'null') {
    if (inferredType === 'string' && typeof value === 'string') return { type: 'string', value };
    if (inferredType === 'date' && typeof value === 'string') return { type: 'date', value };
    if (inferredType === 'number' && typeof value === 'number') return { type: 'number', value };
    if (inferredType === 'boolean' && typeof value === 'boolean') return { type: 'boolean', value };
  }
  return { type: 'error', error: { code: 'INVALID_PROPERTY_VALUE', message: `Property “${property.name}” has no valid preview value.`, propertyId: property.id } };
}

function formulaPropertyType(property: Property, inferred: ReadonlyMap<string, FormulaType>): string {
  return property.type === 'formula' ? formulaTypeLabel(inferred.get(property.id)) : property.type === 'rollup' ? 'Number (rollup)' : property.type;
}
function propertyTypeName(property: Property): string { return property.type === 'multi-select' ? 'Multi-select' : property.type.charAt(0).toUpperCase() + property.type.slice(1); }

function propertyReferences(expression: FormulaExpression): string[] {
  const found: string[] = [];
  const stack = [expression];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.kind === 'property') found.push(node.propertyId);
    else if (node.kind === 'unary') stack.push(node.operand);
    else if (node.kind === 'binary') stack.push(node.left, node.right);
    else if (node.kind === 'conditional') stack.push(node.condition, node.whenTrue, node.whenFalse);
    else if (node.kind === 'call') stack.push(...node.arguments);
  }
  return found;
}

function formulaCycleContaining(properties: readonly Property[], activeId: string): string[] | undefined {
  const formulas = new Map(properties.filter((property) => property.type === 'formula').map((property) => [property.id, property]));
  const graph = new Map<string, string[]>();
  for (const [id, property] of formulas) {
    const parsed = parseFormula(property.formula?.expression ?? '');
    graph.set(id, parsed.ok ? propertyReferences(parsed.value).filter((dependency) => formulas.has(dependency)) : []);
  }
  const stack: string[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  let result: string[] | undefined;
  const visit = (id: string): void => {
    if (result || done.has(id)) return;
    if (visiting.has(id)) {
      const cycle = stack.slice(stack.indexOf(id)).concat(id);
      if (cycle.includes(activeId)) result = cycle;
      return;
    }
    visiting.add(id);
    stack.push(id);
    for (const dependency of graph.get(id) ?? []) visit(dependency);
    stack.pop();
    visiting.delete(id);
    done.add(id);
  };
  for (const id of formulas.keys()) visit(id);
  return result;
}
