import { DEFAULT_FORMULA_EVALUATION_LIMITS, type FormulaEvaluationLimits, type FormulaSourceSpan } from './formula-contract.js';

export type FormulaTokenKind = 'string' | 'number' | 'boolean' | 'null' | 'property' | 'identifier' | 'operator' | 'leftParen' | 'rightParen' | 'comma' | 'eof';
export interface FormulaToken { kind: FormulaTokenKind; text: string; value?: string | number | boolean | null; span: FormulaSourceSpan }
export interface FormulaParseDiagnostic { code: 'SYNTAX_ERROR' | 'RESOURCE_LIMIT'; message: string; span: FormulaSourceSpan }
export type FormulaResult<T> = { ok: true; value: T } | { ok: false; diagnostics: FormulaParseDiagnostic[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function tokenizeFormula(source: string, limits: FormulaEvaluationLimits = DEFAULT_FORMULA_EVALUATION_LIMITS): FormulaResult<FormulaToken[]> {
  const tokens: FormulaToken[] = []; const error = (message: string, start: number, end = start + 1, code: FormulaParseDiagnostic['code'] = 'SYNTAX_ERROR'): FormulaResult<FormulaToken[]> => ({ ok: false, diagnostics: [{ code, message, span: { start, end } }] });
  if (source.length > limits.maxSourceLength) return error('Formula source limit exceeded', 0, source.length, 'RESOURCE_LIMIT');
  let i = 0;
  while (i < source.length) {
    const start = i, c = source[i]!;
    if (/\s/u.test(c)) { i++; continue; }
    if (c === '"') {
      i++; let value = '';
      while (i < source.length && source[i] !== '"') {
        if (source[i] !== '\\') { value += source[i++]!; continue; }
        i++; const e = source[i++]; const escapes: Record<string, string> = { '"': '"', '\\': '\\', n: '\n', r: '\r', t: '\t' };
        if (e !== undefined && e in escapes) value += escapes[e]!;
        else if (e === 'u') { const hex = source.slice(i, i + 4); if (!/^[0-9a-f]{4}$/i.test(hex)) return error('Invalid Unicode escape', start, i + 4); value += String.fromCharCode(parseInt(hex, 16)); i += 4; }
        else return error('Invalid string escape', i - 2, i);
      }
      if (source[i] !== '"') return error('Unterminated string literal', start, source.length);
      i++; if(value.length>limits.maxStringLength)return error('String literal limit exceeded',start,i,'RESOURCE_LIMIT'); tokens.push({ kind: 'string', text: source.slice(start, i), value, span: { start, end: i } }); continue;
    }
    if (source.startsWith('@{', i)) { const end = source.indexOf('}', i + 2); if (end < 0) return error('Unterminated property reference', start, source.length); const id = source.slice(i + 2, end); if (!uuid.test(id)) return error('Malformed property UUID', start, end + 1); i = end + 1; tokens.push({ kind: 'property', text: source.slice(start, i), value: id.toLowerCase(), span: { start, end: i } }); continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) { const m = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(i)); if (!m) return error('Invalid number literal', start); i += m[0].length; const n = Number(m[0]); if (!Number.isFinite(n)) return error('Number literal must be finite', start, i); tokens.push({ kind: 'number', text: m[0], value: n, span: { start, end: i } }); continue; }
    if (/[A-Za-z_]/.test(c)) { const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))![0]; i += m.length; const kind = m === 'true' || m === 'false' ? 'boolean' : m === 'null' ? 'null' : ['not','and','or'].includes(m) ? 'operator' : 'identifier'; tokens.push({ kind, text: m, value: kind === 'boolean' ? m === 'true' : kind === 'null' ? null : m, span: { start, end: i } }); continue; }
    const op = ['==', '!=', '<=', '>='].find(x => source.startsWith(x, i)) ?? ( '+-*/%<>'.includes(c) ? c : undefined );
    if (op) { i += op.length; tokens.push({ kind: 'operator', text: op, span: { start, end: i } }); continue; }
    if (c === '(' || c === ')' || c === ',') { i++; tokens.push({ kind: c === '(' ? 'leftParen' : c === ')' ? 'rightParen' : 'comma', text: c, span: { start, end: i } }); continue; }
    if (c === '=') return error('Use == for equality', start);
    if (c === '!') return error('Use not for logical negation', start);
    return error(`Unexpected character '${c}'`, start);
  }
  if(tokens.length+1>limits.maxTokens)return error('Formula token limit exceeded',0,source.length,'RESOURCE_LIMIT');
  tokens.push({ kind: 'eof', text: '', span: { start: source.length, end: source.length } }); return { ok: true, value: tokens };
}
