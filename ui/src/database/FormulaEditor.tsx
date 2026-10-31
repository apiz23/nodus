import { useEffect, useMemo, useRef, useState } from 'react';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { EditorState, StateEffect } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet } from '@codemirror/view';
import { AlertCircle, BookOpen, Check, ChevronDown, Code2, FunctionSquare, X } from 'lucide-react';
import type { FormulaDiagnostic, FormulaEditorSuggestion } from '../../../src/database/formula-engine.js';
import { FORMULA_EDITOR_SUGGESTIONS } from '../../../src/database/formula-engine.js';
import type { FormulaType, FormulaValue } from '../../../src/database/formula-contract.js';
import { tokenizeFormula } from '../../../src/database/formula-tokenizer.js';
import type { Property } from '../../../src/database/schema.js';
import type { UiDatabaseRow } from '../../../src/ui-server/dto.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { analyzeFormulaDraft, formulaCompletions, formatFormulaPreview, formulaTypeLabel, inferFormulaTypes, type FormulaCompletion } from './formula-editor-model.js';

const diagnosticsChanged = StateEffect.define<void>();
const functionNames = new Set(FORMULA_EDITOR_SUGGESTIONS.map((item) => item.name));

export interface FormulaEditorProps {
  property: Property;
  properties: readonly Property[];
  previewRow?: UiDatabaseRow;
  disabled?: boolean;
  onApply: (expression: string) => void;
  onCancel: () => void;
}

export function FormulaEditor({ property, properties, previewRow, disabled = false, onApply, onCancel }: FormulaEditorProps) {
  const initialExpression = property.formula?.expression ?? '';
  const [expression, setExpression] = useState(initialExpression);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [preview, setPreview] = useState<FormulaValue | null | undefined>(undefined);
  const [completion, setCompletion] = useState<FormulaCompletion | null>(null);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [completionAnchor, setCompletionAnchor] = useState({ left: 0, top: 0 });
  const hostRef = useRef<HTMLDivElement>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const expressionRef = useRef(expression);
  const diagnosticsRef = useRef<readonly FormulaDiagnostic[]>([]);
  const completionRef = useRef<FormulaCompletion | null>(null);
  const completionIndexRef = useRef(completionIndex);
  const propertiesRef = useRef(properties);
  const onApplyRef = useRef(onApply);
  const onCancelRef = useRef(onCancel);
  expressionRef.current = expression;
  completionRef.current = completion;
  completionIndexRef.current = completionIndex;
  propertiesRef.current = properties;
  onApplyRef.current = onApply;
  onCancelRef.current = onCancel;

  const analysis = useMemo(() => analyzeFormulaDraft(expression, properties, property.id), [expression, properties, property.id]);
  diagnosticsRef.current = analysis.diagnostics;

  useEffect(() => {
    const host = editorHostRef.current;
    if (!host) return undefined;

    const moveCompletion = (delta: number): boolean => {
      const current = completionRef.current;
      if (!current?.options.length) return false;
      const count = current.options.length;
      let index = completionIndexRef.current;
      for (let attempt = 0; attempt < count; attempt += 1) {
        index = (index + delta + count) % count;
        if (!current.options[index]?.disabled) {
          setCompletionIndex(index);
          return true;
        }
      }
      return true;
    };
    const chooseCompletion = (): boolean => {
      const current = completionRef.current;
      const option = current?.options[completionIndexRef.current];
      if (!current || !option || option.disabled) return false;
      insertCompletion(current, option.insertText);
      return true;
    };
    const completionKeys = keymap.of([
      { key: 'ArrowDown', run: () => moveCompletion(1) },
      { key: 'ArrowUp', run: () => moveCompletion(-1) },
      { key: 'Enter', run: chooseCompletion },
      { key: 'Escape', run: () => { if (!completionRef.current) return false; setCompletion(null); return true; } },
    ]);
    const listener = EditorView.updateListener.of((update) => {
      if (update.docChanged) setExpression(update.state.doc.toString());
      if (update.docChanged || update.selectionSet) {
        const pos = update.state.selection.main.head;
        const next = formulaCompletions(update.state.doc.toString(), pos, propertiesRef.current);
        setCompletionIndex(0);
        if (!next) { setCompletion(null); return; }
        const point = update.view.coordsAtPos(pos);
        const rect = hostRef.current?.getBoundingClientRect();
        if (point && rect) setCompletionAnchor({
          left: Math.max(8, Math.min(point.left - rect.left, rect.width - 280)),
          top: Math.max(8, point.bottom - rect.top),
        });
        setCompletion(next);
      }
    });
    const syntax = ViewPlugin.fromClass(class {
      decorations: DecorationSet;
      diagnostics = diagnosticsRef.current;
      constructor(view: EditorView) { this.decorations = formulaDecorations(view, this.diagnostics); }
      update(update: import('@codemirror/view').ViewUpdate) {
        for (const transaction of update.transactions) {
          if (transaction.effects.some((effect) => effect.is(diagnosticsChanged))) this.diagnostics = diagnosticsRef.current;
        }
        if (update.docChanged || update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(diagnosticsChanged)))) {
          this.decorations = formulaDecorations(update.view, this.diagnostics);
        }
      }
    }, { decorations: (plugin) => plugin.decorations });
    const theme = EditorView.baseTheme({
      '&': { color: 'var(--foreground)', backgroundColor: 'transparent', fontSize: '13px' },
      '.cm-content': { fontFamily: 'var(--font-mono)', lineHeight: '1.65', padding: '12px', caretColor: 'var(--success)', minHeight: '104px' },
      '.cm-scroller': { overflow: 'auto', maxHeight: '260px' },
      '&.cm-focused': { outline: 'none' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--selection)' },
      '.cm-formula-string': { color: 'var(--muted-foreground)' },
      '.cm-formula-number': { color: 'var(--foreground)', fontWeight: '600' },
      '.cm-formula-literal': { color: 'var(--success)', fontWeight: '600' },
      '.cm-formula-property': { color: 'var(--success)', textDecoration: 'underline', textUnderlineOffset: '2px' },
      '.cm-formula-function': { color: 'var(--foreground)', fontWeight: '600' },
      '.cm-formula-operator': { color: 'var(--muted-foreground)' },
      '.cm-formula-punctuation': { color: 'var(--muted-foreground)' },
      '.cm-formula-invalid': { backgroundColor: 'color-mix(in srgb, var(--destructive) 12%, transparent)', textDecoration: 'underline wavy var(--destructive)', textUnderlineOffset: '2px' },
    });
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: expressionRef.current,
        extensions: [
          theme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': `Formula for ${property.name}`, 'aria-multiline': 'true', spellcheck: 'false' }),
          history(),
          completionKeys,
          keymap.of([...defaultKeymap, ...historyKeymap]),
          syntax,
          listener,
        ],
      }),
    });
    viewRef.current = view;

    function insertCompletion(current: FormulaCompletion, insertText: string) {
      view.dispatch({
        changes: { from: current.from, to: current.to, insert: insertText },
        selection: { anchor: current.from + insertText.length },
        userEvent: 'input.complete',
      });
      view.focus();
      setCompletion(null);
    }
    return () => { view.destroy(); viewRef.current = null; };
  }, [property.id, property.name]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: diagnosticsChanged.of() });
  }, [analysis.diagnostics]);

  useEffect(() => {
    let current = true;
    setPreview(undefined);
    const timer = window.setTimeout(() => {
      if (!current) return;
      if (analysis.diagnostics.length || !previewRow) { setPreview(null); return; }
      const latest = analyzeFormulaDraft(expression, properties, property.id, previewRow);
      if (current) setPreview(latest.preview ?? null);
    }, 180);
    return () => { current = false; window.clearTimeout(timer); };
  }, [analysis.diagnostics, expression, properties, property.id, previewRow]);

  const inferred = useMemo(() => inferFormulaTypes(properties), [properties]);
  const canApply = expression.trim().length > 0 && analysis.diagnostics.length === 0 && !disabled;
  const selectedCompletion = completion?.options[completionIndex];

  function goToDiagnostic(diagnostic: FormulaDiagnostic): void {
    const view = viewRef.current;
    if (!view || !diagnostic.span) return;
    const from = Math.min(diagnostic.span.start, view.state.doc.length);
    const to = Math.min(Math.max(diagnostic.span.end, from), view.state.doc.length);
    view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    view.focus();
  }

  return <section ref={hostRef} aria-label={`Formula editor for ${property.name}`} className="flex min-w-0 flex-col gap-3 rounded-md border bg-muted/20 p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-sm font-medium"><Code2 className="size-4 text-success" />Formula for {property.name || 'new property'}</h3>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">Use @{`{property UUID}`} to reference supported fields. Renaming a field will not change its reference.</p>
      </div>
      <Badge variant={analysis.diagnostics.length ? 'destructive' : 'secondary'}>{analysis.diagnostics.length ? `${analysis.diagnostics.length} issue${analysis.diagnostics.length === 1 ? '' : 's'}` : `Returns ${formulaTypeLabel(analysis.resultType)}`}</Badge>
    </div>

    <div className="relative min-w-0 overflow-visible rounded-md border bg-background">
      <div ref={editorHostRef} />
      <Popover open={completion !== null} onOpenChange={(open) => { if (!open) setCompletion(null); }}>
        <PopoverAnchor asChild><span aria-hidden="true" className="pointer-events-none absolute size-px" style={{ left: completionAnchor.left, top: completionAnchor.top }} /></PopoverAnchor>
        <PopoverContent align="start" side="bottom" sideOffset={4} className="w-[min(24rem,calc(100vw-2rem))] p-1" onOpenAutoFocus={(event) => event.preventDefault()} onInteractOutside={(event) => { if (event.target instanceof Node && hostRef.current?.contains(event.target)) event.preventDefault(); }}>
          <Command shouldFilter={false} value={selectedCompletion?.key ?? ''} onValueChange={(value) => {
            const index = completion?.options.findIndex((option) => option.key === value) ?? -1;
            if (index >= 0) setCompletionIndex(index);
          }}>
            <CommandList className="max-h-64">
              {!completion?.options.some((option) => !option.disabled) ? <CommandEmpty>No supported suggestions match. Select a supported property type in the schema.</CommandEmpty> : null}
              {completion?.kind === 'property' ? <>
                <CommandGroup heading="Supported properties">
                  {completion.options.filter((option) => !option.disabled).map((option) => <CommandItem key={option.key} value={option.key} onMouseDown={(event) => event.preventDefault()} onSelect={() => insertFromCompletion(option)}>
                    <span className="min-w-0 flex-1"><span className="block truncate">{option.label}</span><span className="block truncate font-mono text-[11px] text-muted-foreground">{option.detail}</span></span>
                  </CommandItem>)}
                </CommandGroup>
                {completion.options.some((option) => option.disabled) ? <CommandGroup heading="Not supported in formulas">
                  {completion.options.filter((option) => option.disabled).map((option) => <CommandItem key={option.key} value={option.key} disabled title={option.reason}><span className="min-w-0"><span className="block truncate">{option.label}</span><span className="block truncate text-[11px] text-muted-foreground">{option.detail} — {option.reason}</span></span></CommandItem>)}
                </CommandGroup> : null}
              </> : <CommandGroup heading="Functions and operators">
                {completion?.options.map((option) => <CommandItem key={option.key} value={option.key} onMouseDown={(event) => event.preventDefault()} onSelect={() => insertFromCompletion(option)}>
                  <span className="min-w-0 flex-1"><span className="block truncate font-mono">{option.label}</span><span className="block truncate text-[11px] text-muted-foreground">{option.detail}</span>{option.documentation ? <span className="block truncate text-[11px] text-muted-foreground">{option.documentation.description}</span> : null}</span>
                </CommandItem>)}
              </CommandGroup>}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
    <p className="text-[11px] text-muted-foreground">Type <kbd className="rounded border px-1 font-mono">@&#123;</kbd> for properties or a function name. Use ↑ ↓ to move, Enter to insert, and Escape to close. Ctrl/⌘ Z and Shift+Ctrl/⌘ Z undo and redo.</p>

    <div className="grid min-w-0 gap-3 lg:grid-cols-2">
      <section aria-label="Formula validation" aria-live="polite" className="min-w-0">
        <h4 className="mb-1 flex items-center gap-2 text-xs font-medium"><AlertCircle className="size-3.5" />Validation</h4>
        {analysis.diagnostics.length ? <ul className="flex max-h-32 flex-col gap-1 overflow-auto" role="list">
          {analysis.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}:${diagnostic.span?.start ?? 0}:${index}`}>
            <button type="button" className="flex max-w-full items-start gap-1.5 text-left text-xs text-destructive underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => goToDiagnostic(diagnostic)}>
              <span className="shrink-0 font-mono">{diagnostic.code}</span><span className="min-w-0 break-words">{diagnostic.message}</span>
              {diagnostic.span ? <span className="shrink-0 text-[11px] text-muted-foreground">{diagnostic.span.start + 1}–{diagnostic.span.end + 1}</span> : null}
            </button>
          </li>)}
        </ul> : <p className="text-xs text-muted-foreground" role="status">Formula is valid. Results are derived from this record’s current values.</p>}
      </section>
      <section aria-label="Formula preview" aria-live="polite" className="min-w-0">
        <h4 className="mb-1 flex items-center gap-2 text-xs font-medium"><Check className="size-3.5" />Preview</h4>
        {!previewRow ? <p className="text-xs text-muted-foreground">Add a record to this database to preview the formula in record context.</p>
          : preview === undefined ? <p className="text-xs text-muted-foreground">Updating preview…</p>
            : preview === null ? <p className="text-xs text-muted-foreground">Preview is unavailable until the formula is valid.</p>
              : <div className="min-w-0 rounded-sm bg-muted/40 px-2.5 py-2">
                <p className="text-[11px] text-muted-foreground">Example record: <span className="font-medium text-foreground">{previewRow.title}</span></p>
                <p className={cn('mt-1 break-words text-sm', preview.type === 'error' && 'text-destructive')}>
                  {preview.type === 'error' ? `${preview.error.code}: ${preview.error.message}` : formatFormulaPreview(preview)}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2"><Badge variant="outline">{formulaTypeLabel(preview.type)}</Badge><span className="text-[11px] text-muted-foreground">Derived only; never saved to the note.</span></div>
              </div>}
        <p className="mt-1 break-words text-[11px] text-muted-foreground">Depends on: {analysis.dependencies.length ? analysis.dependencies.map((id) => properties.find((item) => item.id === id)?.name ?? `Missing property ${id}`).join(', ') : 'no properties'}</p>
      </section>
    </div>

    <Collapsible open={referenceOpen} onOpenChange={setReferenceOpen}>
      <CollapsibleTrigger asChild><Button type="button" size="xs" variant="ghost"><BookOpen data-icon="inline-start" />Function reference<ChevronDown className={cn('size-3.5 transition-transform', referenceOpen && 'rotate-180')} /></Button></CollapsibleTrigger>
      <CollapsibleContent className="mt-2 max-h-64 overflow-auto rounded-md border bg-background p-2">
        <div className="flex flex-col gap-3">
          {(['Strings', 'Numbers', 'Dates', 'Logic'] as const).map((category) => <section key={category} aria-label={`${category} formula functions`}>
            <h5 className="mb-1 text-[11px] font-medium text-muted-foreground">{category}</h5>
            <ul className="grid gap-2 sm:grid-cols-2">
              {FORMULA_EDITOR_SUGGESTIONS.filter((item) => item.category === category).map((item) => <li key={item.name} className="min-w-0 rounded-sm bg-muted/40 px-2 py-1.5">
                <p className="flex flex-wrap items-center gap-x-1 font-mono text-[11px] font-medium"><FunctionSquare className="size-3 text-success" />{item.signature}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{item.description}</p>
                <code className="mt-0.5 block break-all text-[11px]">{item.example}</code>
                {item.minArguments !== undefined ? <p className="mt-0.5 text-[11px] text-muted-foreground">Arguments: {item.minArguments === item.maxArguments ? item.minArguments : `${item.minArguments}–${item.maxArguments}`} · Null: {item.nullBehavior ?? 'custom'}</p> : null}
              </li>)}
            </ul>
          </section>)}
        </div>
      </CollapsibleContent>
    </Collapsible>

    <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
      <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onCancel}><X data-icon="inline-start" />Cancel formula edit</Button>
      <Button type="button" size="sm" disabled={!canApply} onClick={() => onApply(expression)}><Check data-icon="inline-start" />Apply formula</Button>
    </div>
  </section>;

  function insertFromCompletion(option: { insertText: string }): void {
    const view = viewRef.current;
    const current = completionRef.current;
    if (!view || !current) return;
    view.dispatch({ changes: { from: current.from, to: current.to, insert: option.insertText }, selection: { anchor: current.from + option.insertText.length }, userEvent: 'input.complete' });
    view.focus();
    setCompletion(null);
  }
}

function formulaDecorations(view: EditorView, diagnostics: readonly FormulaDiagnostic[]): DecorationSet {
  const source = view.state.doc.toString();
  const tokenized = tokenizeFormula(source);
  const marks: Array<{ from: number; to: number; decoration: ReturnType<typeof Decoration.mark> }> = [];
  if (tokenized.ok) for (let index = 0; index < tokenized.value.length; index += 1) {
    const token = tokenized.value[index]!;
    if (token.kind === 'eof' || token.span.start === token.span.end) continue;
    const className = token.kind === 'string' ? 'cm-formula-string'
      : token.kind === 'number' ? 'cm-formula-number'
        : token.kind === 'boolean' || token.kind === 'null' ? 'cm-formula-literal'
          : token.kind === 'property' ? 'cm-formula-property'
            : token.kind === 'identifier' ? (functionNames.has(token.text) && tokenized.value[index + 1]?.kind === 'leftParen' ? 'cm-formula-function' : functionNames.has(token.text) ? 'cm-formula-function' : 'cm-formula-invalid')
              : token.kind === 'operator' ? 'cm-formula-operator' : 'cm-formula-punctuation';
    marks.push({ from: token.span.start, to: token.span.end, decoration: Decoration.mark({ class: className }) });
  }
  for (const diagnostic of diagnostics) {
    const from = Math.max(0, Math.min(diagnostic.span?.start ?? 0, view.state.doc.length));
    const to = Math.max(from, Math.min(diagnostic.span?.end ?? from, view.state.doc.length));
    if (to > from) marks.push({ from, to, decoration: Decoration.mark({ class: 'cm-formula-invalid', attributes: { 'aria-invalid': 'true' } }) });
  }
  marks.sort((left, right) => left.from - right.from || left.to - right.to);
  return Decoration.set(marks.map((mark) => mark.decoration.range(mark.from, mark.to)), true);
}
