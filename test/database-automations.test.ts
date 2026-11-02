import { describe, expect, it } from 'vitest';
import { matchesAutomation, parseAutomations, serializeAutomations, sortAutomations, validateAutomationReferences, type DatabaseAutomation, type DatabaseAutomationEvent } from '../src/database/automations.js';
import type { DatabaseDefinition } from '../src/database/schema.js';

const DB = '11111111-1111-4111-8111-111111111111';
const NAME = '22222222-2222-4222-8222-222222222222';
const STATUS = '33333333-3333-4333-8333-333333333333';
const CHECK = '44444444-4444-4444-8444-444444444444';
const DATE = '55555555-5555-4555-8555-555555555555';
const NOW = '2026-10-25T12:00:00.000Z';
const schema: DatabaseDefinition = { id: DB, name: 'Tasks', properties: [
  { id: NAME, name: 'Name', type: 'text' }, { id: STATUS, name: 'Score', type: 'number' },
  { id: CHECK, name: 'Done', type: 'checkbox' }, { id: DATE, name: 'Due', type: 'date' },
] };
function automation(overrides: Partial<DatabaseAutomation> = {}): DatabaseAutomation {
  return { id: '66666666-6666-4666-8666-666666666666', databaseId: DB, name: 'Ready flow', enabled: true, trigger: 'record-created', conditions: [], actions: [{ type: 'set-checkbox', propertyId: CHECK, value: true }], createdAt: NOW, updatedAt: NOW, ...overrides };
}
const event = (type: DatabaseAutomationEvent['type'], before: Record<string, unknown> = {}, after: Record<string, unknown> = {}, propertyId?: string): DatabaseAutomationEvent => ({ id: 'event-1', type, databaseId: DB, recordId: '77777777-7777-4777-8777-777777777777', ...(propertyId ? { propertyId } : {}), before, after });

describe('database automation contracts', () => {
  it('round-trips strict definitions and rejects malformed IDs, unknown keys, and empty action lists', () => {
    const definition = automation();
    expect(parseAutomations(serializeAutomations([definition]))).toEqual([definition]);
    expect(() => parseAutomations(JSON.stringify({ format: 'nodus-database-automations', version: 1, automations: [{ ...definition, extra: true }] }))).toThrow(/Unknown key/);
    expect(() => parseAutomations(JSON.stringify({ format: 'nodus-database-automations', version: 1, automations: [{ ...definition, actions: [] }] }))).toThrow(/actions/);
    expect(() => parseAutomations(JSON.stringify({ format: 'nodus-database-automations', version: 1, automations: [{ ...definition, databaseId: 'Tasks' }] }))).toThrow(/UUID/);
  });

  it('matches each trigger only for its source database and watched field', () => {
    expect(matchesAutomation(automation(), event('record-created'))).toBe(true);
    expect(matchesAutomation(automation({ trigger: 'record-deleted' }), event('record-deleted'))).toBe(true);
    expect(matchesAutomation(automation({ trigger: 'property-updated', triggerPropertyId: NAME }), event('property-updated', {}, { [NAME]: 'x' }, NAME))).toBe(true);
    expect(matchesAutomation(automation({ trigger: 'property-updated', triggerPropertyId: NAME }), event('property-updated', { [NAME]: 'x' }, {}, NAME))).toBe(true);
    expect(matchesAutomation(automation({ trigger: 'property-updated', triggerPropertyId: NAME }), event('property-updated', {}, { [CHECK]: true }, CHECK))).toBe(false);
    expect(matchesAutomation(automation({ trigger: 'condition-entered', conditions: [{ propertyId: STATUS, operator: 'greater', value: 5 }] }), event('condition-entered', { [STATUS]: 3 }, { [STATUS]: 6 }))).toBe(true);
    expect(matchesAutomation(automation({ trigger: 'condition-entered', conditions: [{ propertyId: STATUS, operator: 'greater', value: 5 }] }), event('condition-entered', { [STATUS]: 8 }, { [STATUS]: 9 }))).toBe(false);
    expect(matchesAutomation(automation({ enabled: false }), event('record-created'))).toBe(false);
  });

  it('validates condition and action property types and values', () => {
    validateAutomationReferences(automation({ actions: [
      { type: 'set-property', propertyId: NAME, value: 'Title' },
      { type: 'clear-property', propertyId: STATUS },
      { type: 'update-date', propertyId: DATE, value: '2026-12-01' },
      { type: 'set-checkbox', propertyId: CHECK, value: false },
    ] }), schema);
    expect(() => validateAutomationReferences(automation({ actions: [{ type: 'update-date', propertyId: NAME, value: 'nope' }] }), schema)).toThrow(/Date property/);
    expect(() => validateAutomationReferences(automation({ conditions: [{ propertyId: CHECK, operator: 'greater', value: 3 }] }), schema)).toThrow(/incompatible/);
    expect(() => validateAutomationReferences(automation({ actions: [{ type: 'set-property', propertyId: '88888888-8888-4888-8888-888888888888', value: 'x' }] }), schema)).toThrow(/does not exist/);
  });

  it('sorts matching workflow execution deterministically by stable ID', () => {
    const items = [automation({ id: '99999999-9999-4999-8999-999999999999' }), automation({ id: '88888888-8888-4888-8888-888888888888' })];
    expect(sortAutomations(items).map((item) => item.id)).toEqual(['88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999999']);
  });
});
