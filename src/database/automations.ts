import { randomUUID } from 'node:crypto';
import { isUuidV4 } from '../domain/ids.js';
import { isDateOnly } from '../temporal/date.js';
import type { DatabaseDefinition, Property } from './schema.js';
import { inferFormulaPropertyTypes } from './formula-engine.js';

export const DATABASE_AUTOMATIONS_FORMAT = 'nodus-database-automations';
export const DATABASE_AUTOMATIONS_VERSION = 1;
export const AUTOMATION_HISTORY_LIMIT = 200;

export type AutomationTrigger = 'record-created' | 'property-updated' | 'record-deleted' | 'condition-entered';
export type AutomationOperator = 'equals' | 'not-equals' | 'is-empty' | 'is-not-empty' | 'greater' | 'less' | 'contains' | 'before' | 'after';
export interface AutomationCondition { propertyId: string; operator: AutomationOperator; value?: string | number | boolean }
export type AutomationAction =
  | { type: 'set-property'; propertyId: string; value: string | number | boolean | string[] }
  | { type: 'clear-property'; propertyId: string }
  | { type: 'update-date'; propertyId: string; value: string }
  | { type: 'set-checkbox'; propertyId: string; value: boolean };
export interface DatabaseAutomation {
  id: string;
  databaseId: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  /** Required for property-updated; identifies the watched field. */
  triggerPropertyId?: string;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  createdAt: string;
  updatedAt: string;
}
export interface AutomationExecution {
  id: string;
  eventId: string;
  automationId: string;
  databaseId: string;
  recordId: string;
  trigger: AutomationTrigger;
  status: 'success' | 'failure' | 'skipped' | 'running';
  startedAt: string;
  finishedAt: string;
  completedActions: number;
  error?: string;
}
export interface DatabaseAutomationEvent {
  id: string;
  type: AutomationTrigger;
  databaseId: string;
  recordId: string;
  propertyId?: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export function parseAutomations(json: string): DatabaseAutomation[] {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new Error('Automation definitions are not valid JSON.'); }
  if (!isRecord(raw) || raw.format !== DATABASE_AUTOMATIONS_FORMAT || raw.version !== DATABASE_AUTOMATIONS_VERSION || !Array.isArray(raw.automations)) throw new Error('Automation definitions have an unsupported format.');
  exactKeys(raw, ['format', 'version', 'automations'], 'automation file');
  const values = raw.automations.map(parseAutomation);
  unique(values.map((item) => item.id), 'automation ID');
  return values;
}

export function serializeAutomations(automations: DatabaseAutomation[]): string {
  const text = `${JSON.stringify({ format: DATABASE_AUTOMATIONS_FORMAT, version: DATABASE_AUTOMATIONS_VERSION, automations }, null, 2)}\n`;
  parseAutomations(text);
  return text;
}

export function parseAutomationHistory(json: string): AutomationExecution[] {
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new Error('Automation history is not valid JSON.'); }
  if (!isRecord(raw) || raw.format !== 'nodus-automation-history' || raw.version !== 1 || !Array.isArray(raw.executions)) throw new Error('Automation history has an unsupported format.');
  exactKeys(raw, ['format', 'version', 'executions'], 'automation history');
  const executions = raw.executions.map((item): AutomationExecution => {
    if (!isRecord(item)) throw new Error('Automation execution must be an object.');
    exactKeys(item, ['id', 'eventId', 'automationId', 'databaseId', 'recordId', 'trigger', 'status', 'startedAt', 'finishedAt', 'completedActions', 'error'], 'automation execution');
    if (!['record-created', 'property-updated', 'record-deleted', 'condition-entered'].includes(String(item.trigger))) throw new Error('Invalid execution trigger.');
    if (!['success', 'failure', 'skipped', 'running'].includes(String(item.status))) throw new Error('Invalid execution status.');
    if (!Number.isInteger(item.completedActions) || (item.completedActions as number) < 0) throw new Error('Invalid completedActions.');
    if (item.error !== undefined && typeof item.error !== 'string') throw new Error('Invalid execution error.');
    if (typeof item.eventId !== 'string' || !item.eventId || item.eventId.length > 256) throw new Error('Invalid execution eventId.');
    return { id: uuid(item.id, 'execution id'), eventId: item.eventId, automationId: uuid(item.automationId, 'automationId'), databaseId: uuid(item.databaseId, 'databaseId'), recordId: uuid(item.recordId, 'recordId'), trigger: item.trigger as AutomationTrigger, status: item.status as AutomationExecution['status'], startedAt: iso(item.startedAt, 'startedAt'), finishedAt: iso(item.finishedAt, 'finishedAt'), completedActions: item.completedActions as number, ...(item.error === undefined ? {} : { error: item.error }) };
  });
  unique(executions.map((item) => item.id), 'execution ID');
  return executions;
}

export function parseAutomation(value: unknown): DatabaseAutomation {
  if (!isRecord(value)) throw new Error('Automation must be an object.');
  exactKeys(value, ['id', 'databaseId', 'name', 'enabled', 'trigger', 'triggerPropertyId', 'conditions', 'actions', 'createdAt', 'updatedAt'], 'automation');
  const id = uuid(value.id, 'automation id'); const databaseId = uuid(value.databaseId, 'databaseId');
  const name = requiredName(value.name, 'name');
  if (typeof value.enabled !== 'boolean') throw new Error('enabled must be a boolean.');
  if (!['record-created', 'property-updated', 'record-deleted', 'condition-entered'].includes(String(value.trigger))) throw new Error('Unsupported automation trigger.');
  const trigger = value.trigger as AutomationTrigger;
  const triggerPropertyId = value.triggerPropertyId === undefined ? undefined : uuid(value.triggerPropertyId, 'triggerPropertyId');
  if ((trigger === 'property-updated') !== (triggerPropertyId !== undefined)) throw new Error('property-updated requires triggerPropertyId; other triggers must omit it.');
  if (!Array.isArray(value.conditions)) throw new Error('conditions must be an array.');
  if (!Array.isArray(value.actions) || value.actions.length === 0 || value.actions.length > 20) throw new Error('actions must contain between 1 and 20 actions.');
  const conditions = value.conditions.map(parseCondition); const actions = value.actions.map(parseAction);
  if (trigger === 'condition-entered' && conditions.length === 0) throw new Error('condition-entered requires at least one condition.');
  return { id, databaseId, name, enabled: value.enabled, trigger, ...(triggerPropertyId ? { triggerPropertyId } : {}), conditions, actions,
    createdAt: iso(value.createdAt, 'createdAt'), updatedAt: iso(value.updatedAt, 'updatedAt') };
}

export function validateAutomationReferences(automation: DatabaseAutomation, database: DatabaseDefinition): void {
  if (automation.databaseId !== database.id) throw new Error('Automation database ID does not match its definition.');
  const property = (id: string): Property => {
    const found = database.properties.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`Property ${id} does not exist in database ${database.id}.`);
    return found;
  };
  if (automation.triggerPropertyId) property(automation.triggerPropertyId);
  const formulaTypes = inferFormulaPropertyTypes(database.properties);
  for (const condition of automation.conditions) {
    const target = property(condition.propertyId);
    if (condition.operator === 'is-empty' || condition.operator === 'is-not-empty') continue;
    if (target.type === 'formula') {
      const resultType = formulaTypes.get(target.id);
      const expectedType = resultType === 'string' ? 'text' : resultType === 'boolean' ? 'boolean' : resultType === 'date' ? 'date' : resultType;
      if (!conditionFitsType(expectedType, condition.operator, condition.value)) throw new Error(`Condition is incompatible with formula property ${target.name}.`);
      if (expectedType === 'date') validateDate(condition.value);
    } else if (target.type === 'rollup') {
      if (!conditionFitsType('number', condition.operator, condition.value)) throw new Error(`Condition is incompatible with rollup property ${target.name}.`);
    } else if (target.type === 'relation') {
      const scalar = typeof condition.value === 'string' && isUuidV4(condition.value);
      const manyOperator = target.relation?.cardinality === 'many' && condition.operator === 'contains';
      const singleOperator = target.relation?.cardinality === 'one' && ['equals', 'not-equals'].includes(condition.operator);
      if (!scalar || (!manyOperator && !singleOperator)) throw new Error(`Condition is incompatible with relation property ${target.name}.`);
    } else {
      if (!conditionFits(target, condition.operator, condition.value)) throw new Error(`Condition is incompatible with property ${target.name}.`);
      if (target.type === 'multi-select') {
        if (typeof condition.value !== 'string' || !target.options?.some((option) => option.id === condition.value)) throw new Error(`Condition for ${target.name} must reference an existing option.`);
      } else validateValue(target, condition.value);
    }
  }
  for (const action of automation.actions) {
    const target = property(action.propertyId);
    if (target.type === 'formula' || target.type === 'rollup' || target.relation?.reversePropertyId) throw new Error(`Actions cannot write derived property ${target.name}.`);
    if (action.type === 'update-date' && target.type !== 'date') throw new Error(`Update date requires a Date property (${target.name}).`);
    if (action.type === 'set-checkbox' && target.type !== 'checkbox') throw new Error(`Set checkbox requires a Checkbox property (${target.name}).`);
    if (action.type === 'set-property') {
      if (target.type === 'relation') {
        const valid = target.relation?.cardinality === 'one'
          ? action.value === null || (typeof action.value === 'string' && isUuidV4(action.value))
          : Array.isArray(action.value) && action.value.every((id) => isUuidV4(id));
        if (!valid) throw new Error(`Relation action for ${target.name} requires record UUID${target.relation?.cardinality === 'many' ? 's' : ''}.`);
      } else validateValue(target, action.value);
    }
    if (action.type === 'update-date') validateValue(target, action.value);
  }
}

export function matchesAutomation(automation: DatabaseAutomation, event: DatabaseAutomationEvent): boolean {
  if (!automation.enabled || automation.databaseId !== event.databaseId || automation.trigger !== event.type) return false;
  if (automation.triggerPropertyId && event.propertyId !== automation.triggerPropertyId) return false;
  if (event.type === 'condition-entered') {
    const beforeMatches = automation.conditions.every((condition) => evaluateCondition(condition, event.before[condition.propertyId]));
    const afterMatches = automation.conditions.every((condition) => evaluateCondition(condition, event.after[condition.propertyId]));
    return !beforeMatches && afterMatches;
  }
  return automation.conditions.every((condition) => evaluateCondition(condition, event.after[condition.propertyId]));
}

export function sortAutomations(automations: DatabaseAutomation[]): DatabaseAutomation[] {
  return [...automations].sort((a, b) => a.id.localeCompare(b.id));
}

export function evaluateCondition(condition: AutomationCondition, actual: unknown): boolean {
  switch (condition.operator) {
    case 'is-empty': return actual === undefined || actual === null || actual === '';
    case 'is-not-empty': return actual !== undefined && actual !== null && actual !== '';
    case 'equals': return equalValue(actual, condition.value);
    case 'not-equals': return !equalValue(actual, condition.value);
    case 'greater': return typeof actual === 'number' && typeof condition.value === 'number' && actual > condition.value;
    case 'less': return typeof actual === 'number' && typeof condition.value === 'number' && actual < condition.value;
    case 'contains': return typeof condition.value === 'string' && (typeof actual === 'string' ? actual.includes(condition.value) : Array.isArray(actual) && actual.includes(condition.value));
    case 'before': return typeof actual === 'string' && typeof condition.value === 'string' && actual < condition.value;
    case 'after': return typeof actual === 'string' && typeof condition.value === 'string' && actual > condition.value;
  }
}

export function newAutomationId(): string { return randomUUID(); }

function parseCondition(value: unknown): AutomationCondition {
  if (!isRecord(value)) throw new Error('Condition must be an object.');
  exactKeys(value, ['propertyId', 'operator', 'value'], 'condition');
  const operator = value.operator;
  if (!['equals', 'not-equals', 'is-empty', 'is-not-empty', 'greater', 'less', 'contains', 'before', 'after'].includes(String(operator))) throw new Error('Unsupported condition operator.');
  const empty = operator === 'is-empty' || operator === 'is-not-empty';
  if (empty === Object.hasOwn(value, 'value')) throw new Error('Empty conditions omit value; other conditions require it.');
  return { propertyId: uuid(value.propertyId, 'condition propertyId'), operator: operator as AutomationOperator, ...(empty ? {} : { value: scalar(value.value, 'condition value') }) };
}
function parseAction(value: unknown): AutomationAction {
  if (!isRecord(value)) throw new Error('Action must be an object.');
  if (value.type === 'clear-property') { exactKeys(value, ['type', 'propertyId'], 'clear action'); return { type: value.type, propertyId: uuid(value.propertyId, 'action propertyId') }; }
  if (value.type === 'set-property') { exactKeys(value, ['type', 'propertyId', 'value'], 'set action'); const v = Array.isArray(value.value) ? value.value.map((item) => uuid(item, 'action option ID')) : scalar(value.value, 'action value'); return { type: value.type, propertyId: uuid(value.propertyId, 'action propertyId'), value: v }; }
  if (value.type === 'update-date') { exactKeys(value, ['type', 'propertyId', 'value'], 'date action'); return { type: value.type, propertyId: uuid(value.propertyId, 'action propertyId'), value: requiredDate(value.value) }; }
  if (value.type === 'set-checkbox') { exactKeys(value, ['type', 'propertyId', 'value'], 'checkbox action'); if (typeof value.value !== 'boolean') throw new Error('Checkbox action value must be boolean.'); return { type: value.type, propertyId: uuid(value.propertyId, 'action propertyId'), value: value.value }; }
  throw new Error('Unsupported automation action.');
}
function validateValue(property: Property, value: unknown): void {
  if (property.type === 'text' && typeof value !== 'string') throw new Error(`Property ${property.name} requires text.`);
  if (property.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`Property ${property.name} requires a finite number.`);
  if (property.type === 'checkbox' && typeof value !== 'boolean') throw new Error(`Property ${property.name} requires a boolean.`);
  if (property.type === 'date') requiredDate(value);
  if (property.type === 'select' && (typeof value !== 'string' || !property.options?.some((option) => option.id === value))) throw new Error(`Property ${property.name} requires an existing option ID.`);
  if (property.type === 'multi-select' && (!Array.isArray(value) || value.some((id) => typeof id !== 'string' || !property.options?.some((option) => option.id === id)))) throw new Error(`Property ${property.name} requires existing option IDs.`);
  if (!['text', 'number', 'checkbox', 'date', 'select', 'multi-select'].includes(property.type)) throw new Error(`Property ${property.name} is not supported by automation conditions or actions.`);
}
function conditionFits(p: Property, op: AutomationOperator, value: unknown): boolean {
  if (p.type === 'text') return ['equals', 'not-equals', 'contains'].includes(op) && typeof value === 'string';
  if (p.type === 'number') return ['equals', 'not-equals', 'greater', 'less'].includes(op) && typeof value === 'number';
  if (p.type === 'date') return ['equals', 'not-equals', 'before', 'after'].includes(op) && typeof value === 'string';
  if (p.type === 'checkbox') return ['equals', 'not-equals'].includes(op) && typeof value === 'boolean';
  if (p.type === 'select') return ['equals', 'not-equals'].includes(op) && typeof value === 'string';
  return p.type === 'multi-select' && ['equals', 'not-equals', 'contains'].includes(op) && typeof value === 'string';
}
function conditionFitsType(type: string | undefined, op: AutomationOperator, value: unknown): boolean {
  if (type === 'text') return ['equals', 'not-equals', 'contains'].includes(op) && typeof value === 'string';
  if (type === 'number') return ['equals', 'not-equals', 'greater', 'less'].includes(op) && typeof value === 'number' && Number.isFinite(value);
  if (type === 'date') return ['equals', 'not-equals', 'before', 'after'].includes(op) && typeof value === 'string';
  if (type === 'boolean') return ['equals', 'not-equals'].includes(op) && typeof value === 'boolean';
  return false;
}
function validateDate(value: unknown): void { if (!isDateOnly(value)) throw new Error('Condition date must be a valid YYYY-MM-DD date.'); }
function equalValue(left: unknown, right: unknown): boolean { if (Array.isArray(left)) return typeof right === 'string' ? left.includes(right) : Array.isArray(right) && left.length === right.length && left.every((item, index) => item === right[index]); return left === right; }
function requiredDate(value: unknown): string { if (!isDateOnly(value)) throw new Error('Date must be a valid YYYY-MM-DD date.'); return value; }
function scalar(value: unknown, label: string): string | number | boolean { if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new Error(`${label} must be a scalar.`); if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${label} must be finite.`); return value; }
function uuid(value: unknown, label: string): string { if (typeof value !== 'string' || !isUuidV4(value)) throw new Error(`${label} must be a lowercase UUID v4.`); return value; }
function iso(value: unknown, label: string): string { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || (new Date(value).toISOString() !== value && new Date(value).toISOString().replace(/\.000Z$/, 'Z') !== value)) throw new Error(`${label} must be an ISO timestamp.`); return value; }
function requiredName(value: unknown, label: string): string { if (typeof value !== 'string' || !value.trim() || value.trim() !== value) throw new Error(`${label} must be a non-empty trimmed string.`); return value; }
function exactKeys(value: Record<string, unknown>, allowed: string[], where: string): void { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown key "${key}" in ${where}.`); }
function unique(values: string[], label: string): void { if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}.`); }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
