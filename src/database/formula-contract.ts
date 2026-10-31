/** The scalar value types understood by the formula engine and database projection. */
export type FormulaType = 'string' | 'number' | 'boolean' | 'date' | 'null' | 'error';

/** Dates use validated YYYY-MM-DD calendar strings; formula evaluation has no timezone. */
export type FormulaValue =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'date'; value: string }
  | { type: 'null' }
  | { type: 'error'; error: FormulaError };

export type FormulaErrorCode =
  | 'SYNTAX_ERROR'
  | 'UNKNOWN_PROPERTY'
  | 'UNSUPPORTED_PROPERTY_TYPE'
  | 'TYPE_MISMATCH'
  | 'UNKNOWN_FUNCTION'
  | 'ARITY_MISMATCH'
  | 'INVALID_PROPERTY_VALUE'
  | 'DIVISION_BY_ZERO'
  | 'NON_FINITE_RESULT'
  | 'INVALID_DATE'
  | 'CIRCULAR_DEPENDENCY'
  | 'RESOURCE_LIMIT';

export interface FormulaSourceSpan {
  /** Zero-based UTF-16 offsets into the original formula source; end is exclusive. */
  start: number;
  end: number;
}

/** A per-record evaluation failure; it is a value, never an exception escaping a query. */
export interface FormulaError {
  code: FormulaErrorCode;
  message: string;
  propertyId?: string;
  span?: FormulaSourceSpan;
}

export interface FormulaDiagnostic {
  code: FormulaErrorCode;
  severity: 'error' | 'warning';
  message: string;
  propertyId?: string;
  relatedPropertyIds?: readonly string[];
  span?: FormulaSourceSpan;
}

export type FormulaUnaryOperator = '-' | 'not';
export type FormulaBinaryOperator =
  | '+' | '-' | '*' | '/' | '%'
  | '==' | '!=' | '<' | '<=' | '>' | '>='
  | 'and' | 'or';

export type FormulaLiteralValue =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'null' };

interface FormulaExpressionBase {
  span?: FormulaSourceSpan;
}

export type FormulaExpression =
  | (FormulaExpressionBase & { kind: 'literal'; value: FormulaLiteralValue })
  /** The parser stores stable schema identity here, never a name or object path. */
  | (FormulaExpressionBase & { kind: 'property'; propertyId: string })
  | (FormulaExpressionBase & { kind: 'unary'; operator: FormulaUnaryOperator; operand: FormulaExpression })
  | (FormulaExpressionBase & { kind: 'binary'; operator: FormulaBinaryOperator; left: FormulaExpression; right: FormulaExpression })
  /** `if(condition, yes, no)` is represented separately so evaluation can stay lazy. */
  | (FormulaExpressionBase & { kind: 'conditional'; condition: FormulaExpression; whenTrue: FormulaExpression; whenFalse: FormulaExpression })
  | (FormulaExpressionBase & { kind: 'call'; name: string; arguments: readonly FormulaExpression[] });

export interface FormulaFunctionDefinition {
  name: string;
  minArguments: number;
  maxArguments: number;
  parameterTypes: readonly FormulaType[];
  /** When present, this type is accepted for trailing variadic arguments. */
  variadicParameterType?: FormulaType;
  returnType: FormulaType;
  nullBehavior: 'propagate' | 'custom';
}

/** Explicit bounds enforced by tokenization, parsing, validation, and evaluation. */
export interface FormulaEvaluationLimits {
  maxSourceLength: number;
  maxTokens: number;
  maxAstNodes: number;
  maxNestingDepth: number;
  maxFunctionArguments: number;
  maxEvaluationSteps: number;
  maxStringLength: number;
}

export const DEFAULT_FORMULA_EVALUATION_LIMITS: Readonly<FormulaEvaluationLimits> = Object.freeze({
  maxSourceLength: 4_096,
  maxTokens: 1_024,
  maxAstNodes: 256,
  maxNestingDepth: 32,
  maxFunctionArguments: 16,
  maxEvaluationSteps: 1_024,
  maxStringLength: 16_384,
});
