import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FORMULA_EVALUATION_LIMITS,
  type FormulaDiagnostic,
  type FormulaExpression,
  type FormulaFunctionDefinition,
  type FormulaValue,
} from '../src/database/formula-contract.js';

const PROPERTY_ID = '70000000-0000-4000-8000-000000000001';

describe('formula language contracts', () => {
  it('models literals, stable property references, operators, calls, and lazy conditionals', () => {
    const expression = {
      kind: 'conditional',
      condition: {
        kind: 'binary', operator: '>',
        left: { kind: 'property', propertyId: PROPERTY_ID },
        right: { kind: 'literal', value: { type: 'number', value: 10 } },
      },
      whenTrue: { kind: 'call', name: 'upper', arguments: [{ kind: 'literal', value: { type: 'string', value: 'ready' } }] },
      whenFalse: { kind: 'literal', value: { type: 'null' } },
      span: { start: 0, end: 47 },
    } satisfies FormulaExpression;

    expect(expression.kind).toBe('conditional');
    expect(expression.condition.kind).toBe('binary');
    if (expression.condition.kind === 'binary') {
      expect(expression.condition.left).toMatchObject({ kind: 'property', propertyId: PROPERTY_ID });
    }
  });

  it('represents each scalar result and a structured error without using undefined', () => {
    const values = [
      { type: 'string', value: 'text' },
      { type: 'number', value: 3.5 },
      { type: 'boolean', value: false },
      { type: 'date', value: '2026-10-31' },
      { type: 'null' },
      { type: 'error', error: { code: 'DIVISION_BY_ZERO', message: 'Cannot divide by zero' } },
    ] satisfies FormulaValue[];

    expect(values.map((value) => value.type)).toEqual(['string', 'number', 'boolean', 'date', 'null', 'error']);
  });

  it('describes a bounded pure function signature and source diagnostic', () => {
    const dateAdd = {
      name: 'dateAdd', minArguments: 2, maxArguments: 2,
      parameterTypes: ['date', 'number'], returnType: 'date', nullBehavior: 'propagate',
    } satisfies FormulaFunctionDefinition;
    const diagnostic = {
      code: 'CIRCULAR_DEPENDENCY', severity: 'error', message: 'Formula dependency cycle',
      propertyId: PROPERTY_ID, relatedPropertyIds: [PROPERTY_ID], span: { start: 0, end: 12 },
    } satisfies FormulaDiagnostic;

    expect(dateAdd.parameterTypes).toEqual(['date', 'number']);
    expect(diagnostic.relatedPropertyIds).toEqual([PROPERTY_ID]);
  });

  it('publishes finite default source, tree, call, evaluation, and string limits', () => {
    expect(DEFAULT_FORMULA_EVALUATION_LIMITS).toEqual({
      maxSourceLength: 4_096,
      maxTokens: 1_024,
      maxAstNodes: 256,
      maxNestingDepth: 32,
      maxFunctionArguments: 16,
      maxEvaluationSteps: 1_024,
      maxStringLength: 16_384,
    });
    expect(Object.isFrozen(DEFAULT_FORMULA_EVALUATION_LIMITS)).toBe(true);
  });
});
