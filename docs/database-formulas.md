# Database formulas

## Status and goals

This document describes the formula language and database experience implemented in Phase 7D. Formula properties store their source expression in the database schema. Formula values are calculated from record properties during the shared relation/database projection and are never written into note frontmatter.

### Phase 7D.2 engine API

The engine exposes `tokenizeFormula(source, limits?)`, `parseFormula(source, limits?)`, `validateFormula(ast, schema)`, and `evaluateFormula(ast, propertyValues, limits?)`. The database projection parses formulas once per projection, resolves dependencies per record, and emits formula diagnostics in row issues. No JavaScript evaluation facilities are used.

## Formula database properties

A formula property has a stable property UUID and schema configuration `{ "expression": "..." }`. The database format version is 3 when a formula property is present. Readers continue to accept existing v1 and v2 schemas; formula definitions are rejected in older versions. Formula configuration is included in schema backup/portable data. The API exposes the expression and an inferred `resultType` when it can be determined.

Formula properties are read-only derived fields. Stored attempts to write a formula value are diagnosed and ignored; setters reject edits. Updating an ordinary property never writes calculated formula values into frontmatter. Formula results are recomputed from the current projection after load or restore.

Formulas may reference text, number, checkbox, date, and numeric rollup properties, plus other formulas in the same database. Select, multi-select, and relation inputs remain unsupported. Property references resolve by UUID. Renaming a property does not change its formula reference. A missing property, unsupported type, invalid expression, or invalid source value produces a formula diagnostic. Those formula diagnostics are isolated to the affected formula/record; independent formulas and records continue to project.

The projection extracts formula references, detects self and indirect cycles, infers result types in dependency order, and evaluates dependencies on demand. Results are memoized only for the current record projection; no cross-request cache exists. Each record receives a fresh value context. A cycle or invalid formula produces a row issue with code `FORMULA_ERROR`; its displayed value is null and UI renders the diagnostic state. Source properties and formula definitions are not rewritten.

### Query behavior

The shared row pipeline supplies derived scalar values to Table and List presentation, saved-view filters, sorting, and grouping. Sorting uses the typed derived scalar, not its display string. Filters compare values of matching runtime types. Formula grouping uses deterministic typed value groups. Missing formula values group as “No value”. Evaluation errors are excluded from filters, omitted from sort keys, and shown as a diagnostic group/value state; they are not treated as zero or empty text. Existing properties retain their prior query behavior.

Per-record dependency results are memoized within one projection only, keyed by formula property ID. A new projection after source/schema changes, refresh, restore, or movement recalculates all formulas; this avoids stale cache invalidation risks. Formula parsing is reused within each projection, not persisted.

Formula properties are authored from the existing database schema sheet. Formula values remain read-only in record rows. The formula editor offers syntax highlighting, stable-ID property suggestions, standard-library suggestions, static diagnostics, and a record-context preview.

The language is intentionally small. It must be deterministic, local, bounded, understandable in Markdown-backed databases, and safe to evaluate without executing JavaScript. It has no assignment, variables, loops, user-defined functions, reflection, or general-purpose scripting.

## Value and type system

The formula types are `string`, `number`, `boolean`, `date`, `null`, and `error`.

| Type | Meaning |
|---|---|
| `string` | Unicode text. String operations are exact and locale-independent. |
| `number` | A finite IEEE-754 number. NaN and positive/negative infinity are invalid results. |
| `boolean` | Exactly `true` or `false`; there is no truthy/falsy conversion. |
| `date` | A valid calendar day represented as canonical `YYYY-MM-DD`, with no time or timezone. |
| `null` | A deliberate empty/missing scalar value. `undefined` is not a formula value. |
| `error` | A structured evaluation failure. It is distinct from `null` and must not be silently converted to `null`. |

Types do not implicitly convert. A number is never parsed from text, a boolean is never treated as a number, and a date is not an arbitrary string. Equality requires matching non-null types; ordered comparisons are limited to two numbers, two dates, or two strings. String ordering compares Unicode code points, not locale collation.

The initial property mapping is deliberately limited:

| Database property | Formula type / behavior |
|---|---|
| Text | `string` |
| Number | `number` |
| Checkbox | `boolean` |
| Date | `date`, after validating its stored `YYYY-MM-DD` value |
| Numeric rollup | `number` or its specified `null` result |
| Select, multi-select | Unsupported initially; option IDs are not silently converted to labels |
| Relation | Unsupported as a direct value; formulas do not traverse relations |
| Formula | A typed scalar result; formulas may reference other formulas in the same database |

An existing property with no value evaluates as `null`. A property that has been deleted produces `UNKNOWN_PROPERTY` at formula validation time. A stored value that violates its property schema produces `INVALID_PROPERTY_VALUE` for that record. Unsupported property types produce `UNSUPPORTED_PROPERTY_TYPE`. These cases remain distinct from a formula that explicitly evaluates to `null`.

## References and syntax

Users author references with a controlled token containing the stable property UUID:

```text
@{70000000-0000-4000-8000-000000000001} * 1.15
```

The editor can display the current property name and insert this token. The AST stores only `propertyId`; it never stores a path, title, or arbitrary object traversal. Renaming a property therefore does not change formula identity. If a property is removed, the reference stays in the formula text and is diagnosed until repaired. This is less readable in raw text than name-only references, but avoids ambiguous names and keeps formulas stable across renames.

The grammar uses double-quoted strings, finite decimal/exponent number literals, lowercase `true`, `false`, and `null`, UUID property references, parentheses, operators, and calls to a fixed standard library. Strings support escaped quote, backslash, newline, carriage return, tab, and four-hex-digit Unicode escapes. Hex, binary, numeric separators, comments, assignments, member access, indexing, and arbitrary identifiers are not part of the language.

Examples:

```text
@{70000000-0000-4000-8000-000000000001} * 1.15
upper(@{70000000-0000-4000-8000-000000000002})
if(@{70000000-0000-4000-8000-000000000003} >= 3, "Ready", "Draft")
dateAdd(@{70000000-0000-4000-8000-000000000004}, 7)
```

`if(condition, whenTrue, whenFalse)` is a special lazy conditional form represented by a conditional AST node. It is not an unrestricted function call. The condition must be boolean or null; branches must have the same type, or one may be null. If the condition is null, the result is null and neither branch is evaluated. Only the chosen branch can produce a runtime error.

## Operators and precedence

Operators are listed from highest to lowest precedence. Binary arithmetic and logical operators are left-associative. Unary operators associate right-to-left. Comparison and equality operators are non-associative; write `a < b and b < c`, not `a < b < c`.

| Precedence | Operators | Rules |
|---:|---|---|
| 1 | Calls, references, literals, `(expression)` | Parentheses override precedence. |
| 2 | unary `-` | Accepts a number. |
| 3 | `*`, `/`, `%` | Number operands only. `%` is signed remainder, with the sign of the left operand. |
| 4 | `+`, `-` | `+` accepts either two numbers or two strings; string `+` concatenates. `-` accepts numbers only. |
| 5 | `<`, `<=`, `>`, `>=` | Same-type numbers, dates, or strings. |
| 6 | `==`, `!=` | Strict same-type equality; null has the explicit rules below. |
| 7 | `not` | Accepts a boolean or null; `not a == b` means `not (a == b)`. |
| 8 | `and` | Boolean three-valued logic; short-circuits on false. |
| 9 | `or` | Boolean three-valued logic; short-circuits on true. |

Division and remainder by zero return `DIVISION_BY_ZERO`. Arithmetic overflow and any non-finite result return `NON_FINITE_RESULT`. A type-invalid operation is diagnosed before evaluation and returns `TYPE_MISMATCH`; there are no implicit string/number conversions.

### Null and boolean behavior

For equality, `null == null` is true, `null != null` is false, and null compared with any non-null value is unequal. Ordered comparisons with null return null. Arithmetic and ordinary functions propagate null. `not null` is null.

`and` and `or` use three-valued logic without coercion:

| Left | Right | `and` | `or` |
|---|---|---|---|
| false | any non-error | false | right value |
| true | any non-error | right value | true |
| null | false | false | null |
| null | true | null | true |
| null | null | null | null |

An error encountered during evaluation propagates as an error value. `and` stops when its left operand is false; `or` stops when its left operand is true. Otherwise the right operand is evaluated. This preserves predictable short-circuit behavior while allowing null truth tables to resolve from the other operand.

## Initial standard library

Function names are case-sensitive. Functions are pure and deterministic. Case conversion uses locale-independent Unicode default mappings from the Unicode version pinned by the evaluator build. Unless a row says otherwise, arguments must match the stated types, null arguments propagate to a null result, and invalid arity or type is a compile/type diagnostic.

| Function | Signature | Null and error behavior |
|---|---|---|
| `concat` | `concat(string, ...string)`; 1–16 arguments | Null propagates. Output length is subject to the string limit. |
| `upper`, `lower` | `(string) -> string` | Locale-independent Unicode default case mapping; null propagates. |
| `trim` | `(string) -> string` | Removes leading/trailing Unicode whitespace; null propagates. |
| `length` | `(string) -> number` | Counts Unicode code points, not UTF-16 code units or grapheme clusters; null propagates. |
| `contains` | `(string, string) -> boolean` | Case-sensitive substring search; null propagates. |
| `abs`, `round`, `floor`, `ceil` | `(number) -> number` | Null propagates; `round` ties are rounded away from zero. |
| `min`, `max` | `(number, ...number)`; 1–16 arguments | Null propagates; results must be finite. |
| `date` | `(string) -> date` | Accepts only a real `YYYY-MM-DD` calendar date; invalid input returns `INVALID_DATE`. |
| `year`, `month`, `day` | `(date) -> number` | Gregorian calendar components; month is 1–12; null propagates. |
| `dateAdd` | `(date, number) -> date` | Adds an integer count of UTC calendar days; fractional days or an out-of-range date return `INVALID_DATE`. |
| `dateDiff` | `(start: date, end: date) -> number` | Signed whole calendar days `end - start`; null propagates. |

`and`, `or`, and `not` are operators, not duplicate functions. `if` is the lazy conditional form described above. No clock, random, locale, filesystem, network, or environment functions are available.

## Errors and diagnostics

`FormulaError` is a structured per-record result containing a stable code, message, optional property ID, and optional source span. `FormulaDiagnostic` uses the same codes and adds severity and optional related property IDs. The initial codes are `SYNTAX_ERROR`, `UNKNOWN_PROPERTY`, `UNSUPPORTED_PROPERTY_TYPE`, `TYPE_MISMATCH`, `UNKNOWN_FUNCTION`, `ARITY_MISMATCH`, `INVALID_PROPERTY_VALUE`, `DIVISION_BY_ZERO`, `NON_FINITE_RESULT`, `INVALID_DATE`, `CIRCULAR_DEPENDENCY`, and `RESOURCE_LIMIT`.

Syntax, unknown-reference, unsupported-type, and static type errors are formula diagnostics and prevent an invalid compiled formula from being applied. Runtime errors are per-record `error` values and diagnostics; they do not throw through database projection, sorting, filtering, or rendering. Errors remain distinct from null: an error does not satisfy `== null`, does not silently count as empty, and cannot be used as a normal operand. Query presentation will show a diagnostic state for errors rather than crashing or treating them as ordinary values.

Source spans are zero-based UTF-16 offsets with an exclusive end, matching JavaScript editor offsets. Messages are explanatory, but consumers should branch on stable error codes rather than message text.

## Resource and security limits

The contracts define these enforced defaults:

| Limit | Default |
|---|---:|
| Formula source | 4,096 UTF-16 code units |
| Tokens including EOF | 1,024 |
| AST nodes | 256 |
| Parenthesis/unary nesting depth | 32 |
| Function arguments | 16 |
| Evaluation steps per record | 1,024 |
| String result | 16,384 UTF-16 code units |

Exceeding a limit returns `RESOURCE_LIMIT`. The implementation uses its own tokenizer, AST, type checker, and interpreter. It does not use `eval`, `Function`, dynamic imports, filesystem/network access, browser globals, or Node APIs. Property access uses stable IDs in the AST. Strings, AST size, token count, and evaluation steps are bounded.

## Relations, rollups, and dependency cycles

Forward relation values remain stable note UUIDs and are not formula scalars. Formula evaluation does not follow links, scan another database, or traverse a relation. Existing rollups remain derived values from the relation projection. A scalar rollup result may be referenced when its output type is supported; an unavailable rollup is an error, while a rollup whose defined result is null remains null.

Formula properties may depend on supported ordinary scalar properties, supported scalar rollups, and other formula properties. The current database projection builds a per-database dependency graph using stable property IDs and detects direct and indirect cycles before evaluating records. A cycle produces `FORMULA_ERROR` row diagnostics; the underlying engine error code is `CIRCULAR_DEPENDENCY`. Independent formulas and records continue evaluating. Evaluation also has a per-record memo and the engine's step limit. No relation traversal or new rollup operation is introduced.

## Compatibility and storage

Formula properties are serialized in database schema format v3. Existing v1 and v2 schemas remain readable and are serialized with their compatible format versions; formulas are rejected in earlier formats. Backup and portable import/export preserve formula definitions as schema data. Formula results and diagnostics are derived on each projection and are never included as authoritative note data. Restoring or importing a schema therefore recalculates results from the restored source properties.

## Formula editor

Open the database schema sheet, add a property, and select **Formula**. Choose **Configure formula** to edit a new expression or **Edit formula** to change an existing one. The inline editor uses the existing CodeMirror editor infrastructure, supports normal selection, copy/paste, undo/redo, multi-line input, and keeps edits local until **Apply formula**. Cancel closes the editor without changing the schema draft. Applying changes updates only that schema draft; **Save schema** persists it. The API's inferred `resultType` is display metadata and is stripped before saving the schema. Empty, syntactically invalid, unresolved, unsupported, type-invalid, or cyclic formulas cannot be applied or saved as new/changed definitions. Existing invalid formulas remain diagnosable and are preserved when left unchanged.

Numbers, strings, booleans, null, UUID property references, functions, operators, and punctuation receive syntax-aware styling. Invalid tokens and diagnostic spans receive an error underline. Diagnostics show their stable code and source offsets; selecting one returns the cursor to that location. Validation runs synchronously against bounded input, while preview evaluation is debounced and cancelled when the expression or record context changes.

Typing `@{` opens supported properties and properties that cannot currently be referenced. A supported suggestion displays its name, type, and stable UUID; selecting it inserts the UUID reference. Formula, text, number, checkbox, date, and numeric rollup properties can be suggested when their scalar type is known. Select, multi-select, and relation properties remain visible as unavailable with an explanation. Typing a function prefix opens suggestions derived from the validation registry. The reference panel shows categories, signatures, argument counts and types, return type, null behavior, descriptions, and examples. `if`, `and`, `or`, and `not` are included as language constructs; `if` is parsed as a lazy conditional and the logical operators remain operators.

The preview uses the first available record in the selected database, its current source values, and the same parser, validator, dependency resolution, and evaluator used by database projections. Candidate dependency formula expressions are recalculated in the preview. It shows the derived result and type, a valid null as **Null**, and runtime errors by code and message. With no records it explains that a record is needed for context. Preview output is transient and never changes note data. Direct and indirect cycles are shown as `CIRCULAR_DEPENDENCY` diagnostics and block Apply.

In database views, valid null results display as **No value**. Evaluation errors display a compact **Formula error** control; opening it reveals the property name, record name, stable error code, message, and source span when available. Errors are not treated as null by filters or sort keys and do not interrupt virtualized rendering or prevent unrelated source-property edits. Raw stack traces are not displayed.

## Implementation status and remaining work

The standalone tokenizer, parser, AST validator, bounded standard library, schema v3 configuration, derived evaluation, cycle handling, query integration, API projection, backup/portable compatibility, and schema-sheet authoring UX are implemented. Formulas remain within one database and cannot traverse relations. The editor does not provide inline property-name aliases: stable UUIDs are the authored reference syntax. Function and property suggestions are local to the current schema; no network or filesystem search is used. Formula results and previews remain derived and are never persisted.
