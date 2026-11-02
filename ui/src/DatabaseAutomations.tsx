import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, Workflow } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { DatabaseAutomation, AutomationAction, AutomationCondition } from '../../src/database/automations';
import type { UiDatabase } from '../../src/ui-server/dto';
import { api } from './api';

const operators = ['equals', 'not-equals', 'is-empty', 'is-not-empty', 'greater', 'less', 'contains', 'before', 'after'] as const;
const operatorLabel: Record<string, string> = { equals: 'is', 'not-equals': 'is not', 'is-empty': 'is empty', 'is-not-empty': 'is not empty', greater: 'is greater than', less: 'is less than', contains: 'contains', before: 'is before', after: 'is after' };
const triggers = [
  ['record-created', 'Record created'], ['property-updated', 'Property updated'], ['record-deleted', 'Record deleted'], ['condition-entered', 'Record enters condition'],
] as const;
const propertiesWritable = (database: UiDatabase) => database.properties.filter((p) => !['formula', 'rollup', 'relation'].includes(p.type) && !p.relation?.reversePropertyId);
const propertiesFilterable = (database: UiDatabase) => database.properties;
function initialPropertyValue(property: UiDatabase['properties'][number] | undefined): string | number | boolean | string[] { if (!property) return ''; if (property.type === 'checkbox') return false; if (property.type === 'number') return 0; if (property.type === 'multi-select' || (property.type === 'relation' && property.relation?.cardinality === 'many')) return []; if (property.type === 'select') return property.options?.[0]?.id ?? ''; return ''; }
const emptyAutomation = (database: UiDatabase): DatabaseAutomation => { const property = propertiesWritable(database)[0]; return { id: crypto.randomUUID(), databaseId: database.id, name: 'New automation', enabled: true, trigger: 'record-created', conditions: [], actions: [{ type: 'set-property', propertyId: property?.id ?? '', value: initialPropertyValue(property) }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; };

function ValueEditor({ property, value, label, onChange, multiple = false }: { property: UiDatabase['properties'][number] | undefined; value: unknown; label: string; onChange: (value: string | number | boolean | string[]) => void; multiple?: boolean }) {
  if (!property) return <Input aria-label={label} value={String(value ?? '')} disabled />;
  if (property.type === 'checkbox' || (property.type === 'formula' && property.formula?.resultType === 'boolean')) return <Checkbox aria-label={label} checked={value === true} onCheckedChange={(checked) => onChange(checked === true)} />;
  if (property.type === 'select' || property.type === 'multi-select') {
    if (multiple || (property.type === 'multi-select' && Array.isArray(value))) return <div className="flex flex-wrap gap-3">{(property.options ?? []).map((option) => { const selected = Array.isArray(value) && value.includes(option.id); return <label key={option.id} className="flex items-center gap-2 text-sm"><Checkbox aria-label={`${label}: ${option.name}`} checked={selected} onCheckedChange={(checked) => { const values = Array.isArray(value) ? value as string[] : []; onChange(checked === true ? [...new Set([...values, option.id])] : values.filter((id) => id !== option.id)); }} />{option.name}</label>; })}</div>;
    return <Select value={String(value ?? '')} onValueChange={onChange}><SelectTrigger aria-label={label}><SelectValue placeholder="Choose option" /></SelectTrigger><SelectContent>{(property.options ?? []).map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent></Select>;
  }
  const numeric = property.type === 'number' || property.type === 'rollup' || (property.type === 'formula' && property.formula?.resultType === 'number');
  const date = property.type === 'date' || (property.type === 'formula' && property.formula?.resultType === 'date');
  const array = Array.isArray(value);
  return <Input aria-label={label} type={date ? 'date' : numeric ? 'number' : 'text'} value={array ? value.join(', ') : String(value ?? '')} onChange={(event) => onChange(array || (property.type === 'relation' && property.relation?.cardinality === 'many') ? event.target.value.split(',').map((item) => item.trim()).filter(Boolean) : numeric ? Number(event.target.value) : event.target.value)} />;
}

export function DatabaseAutomations({ database }: { database: UiDatabase }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [automations, setAutomations] = useState<DatabaseAutomation[]>([]);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof api.automationHistory>>['executions']>([]);
  const [hash, setHash] = useState<string | null>(null);
  const [draft, setDraft] = useState<DatabaseAutomation | null>(null);
  const [deleting, setDeleting] = useState<DatabaseAutomation | null>(null);
  const writable = useMemo(() => propertiesWritable(database), [database]);

  async function refresh() {
    setLoading(true); setError(null);
    try {
      const [config, executions] = await Promise.all([api.databaseAutomations(database.id), api.automationHistory(database.id)]);
      setAutomations(config.automations); setHash(config.contentHash); setHistory(executions.executions);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load automations.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { if (open) void refresh(); }, [open, database.id]);

  async function persist(next: DatabaseAutomation[]): Promise<boolean> {
    setSaving(true); setError(null);
    try { const saved = await api.saveDatabaseAutomations(database.id, next.map((item) => ({ ...item, updatedAt: new Date().toISOString() })), hash); setAutomations(saved.automations); setHash(saved.contentHash); setDraft(null); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save automations.'); return false; }
    finally { setSaving(false); }
  }
  function toggle(item: DatabaseAutomation) { void persist(automations.map((candidate) => candidate.id === item.id ? { ...candidate, enabled: !candidate.enabled } : candidate)); }
  function updateDraft(change: Partial<DatabaseAutomation>) { setDraft((current) => current ? { ...current, ...change } : current); }
  function updateAction(index: number, change: Partial<AutomationAction>) { if (!draft) return; const actions = draft.actions.map((action, i) => i === index ? { ...action, ...change } as AutomationAction : action); updateDraft({ actions }); }
  function updateCondition(index: number, change: Partial<AutomationCondition>) { if (!draft) return; const conditions = [...draft.conditions]; conditions[index] = { propertyId: propertiesFilterable(database)[0]?.id ?? '', operator: 'equals', value: '', ...conditions[index], ...change }; updateDraft({ conditions }); }
  const titleOf = (id: string) => database.properties.find((p) => p.id === id)?.name ?? 'Missing property';
  const renderCondition = (condition: AutomationCondition, index: number) => {
    const property = database.properties.find((candidate) => candidate.id === condition.propertyId);
    const formulaType = property?.formula?.resultType;
    const allowed = operators.filter((operator) => property && (operator === 'is-empty' || operator === 'is-not-empty' || (['text', 'formula'].includes(property.type) && ['equals', 'not-equals', 'contains'].includes(operator)) || (['number', 'rollup'].includes(property.type) && ['equals', 'not-equals', 'greater', 'less'].includes(operator)) || (property.type === 'formula' && formulaType === 'number' && ['equals', 'not-equals', 'greater', 'less'].includes(operator)) || (property.type === 'date' && ['equals', 'not-equals', 'before', 'after'].includes(operator)) || (property.type === 'formula' && formulaType === 'date' && ['equals', 'not-equals', 'before', 'after'].includes(operator)) || (['checkbox', 'select'].includes(property.type) && ['equals', 'not-equals'].includes(operator)) || (property.type === 'formula' && formulaType === 'boolean' && ['equals', 'not-equals'].includes(operator)) || (property.type === 'multi-select' && ['equals', 'not-equals', 'contains'].includes(operator)) || (property.type === 'relation' && (property.relation?.cardinality === 'one' ? ['equals', 'not-equals'].includes(operator) : operator === 'contains'))));
    return <div key={index} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_1fr_1fr_auto]"><Select value={condition.propertyId} onValueChange={(propertyId) => updateCondition(index, { propertyId, operator: 'equals', value: '' })}><SelectTrigger aria-label={`Condition ${index + 1} property`}><SelectValue /></SelectTrigger><SelectContent>{propertiesFilterable(database).map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>)}</SelectContent></Select><Select value={condition.operator} onValueChange={(operator) => updateCondition(index, { operator: operator as AutomationCondition['operator'], ...(['is-empty', 'is-not-empty'].includes(operator) ? { value: undefined } : { value: property?.type === 'number' ? 0 : property?.type === 'checkbox' ? false : '' }) })}><SelectTrigger aria-label={`Condition ${index + 1} operator`}><SelectValue /></SelectTrigger><SelectContent>{allowed.map((operator) => <SelectItem key={operator} value={operator}>{operatorLabel[operator]}</SelectItem>)}</SelectContent></Select>{!['is-empty', 'is-not-empty'].includes(condition.operator) && <ValueEditor property={property} value={condition.value} label={`Condition ${index + 1} value`} onChange={(value) => updateCondition(index, { value: Array.isArray(value) ? value[0] ?? '' : value })} />}<Button size="icon-sm" variant="ghost" aria-label={`Remove condition ${index + 1}`} onClick={() => setDraft((current) => current ? { ...current, conditions: current.conditions.filter((_, i) => i !== index) } : current)}><Trash2 /></Button></div>;
  };

  return <>
    <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}><Workflow data-icon="inline-start" /> Automations</Button>
    <Dialog open={open && draft === null} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Automations for {database.name}</DialogTitle><DialogDescription>Local workflows run in ID order. Each action writes through database validation; action writes do not trigger another automation run.</DialogDescription></DialogHeader>
        {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
        {loading ? <p role="status" className="text-sm text-muted-foreground">Loading automations…</p> : <div className="flex flex-col gap-5">
          <section aria-label="Automation list" className="flex flex-col gap-2">
            <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Workflows</h3><Button size="sm" onClick={() => setDraft(emptyAutomation(database))}><Plus data-icon="inline-start" /> Create</Button></div>
            {automations.length === 0 ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No automations yet. Create a workflow for this database.</p> : automations.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-md border p-3">
              <Checkbox aria-label={`Enable ${item.name}`} checked={item.enabled} onCheckedChange={() => toggle(item)} />
              <Button type="button" variant="ghost" className="h-auto min-w-0 flex-1 justify-start px-2 py-1 text-left" onClick={() => setDraft(structuredClone(item))}><span className="min-w-0"><span className="block truncate text-sm font-medium">{item.name}</span><span className="block text-xs text-muted-foreground">{triggers.find(([value]) => value === item.trigger)?.[1]} · {item.actions.length} action{item.actions.length === 1 ? '' : 's'}</span></span></Button>
              <Badge variant={item.enabled ? 'secondary' : 'outline'}>{item.enabled ? 'Enabled' : 'Disabled'}</Badge>
              <Button size="icon-sm" variant="ghost" aria-label={`Delete ${item.name}`} onClick={() => setDeleting(item)}><Trash2 /></Button>
            </div>)}
          </section>
          <section aria-label="Execution history" className="flex flex-col gap-2"><h3 className="text-sm font-semibold">Recent executions</h3>
            {history.length === 0 ? <p className="text-sm text-muted-foreground">No executions recorded.</p> : <ul className="flex flex-col gap-2">{history.slice(0, 20).map((entry) => <li key={entry.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs"><Badge variant={entry.status === 'success' ? 'secondary' : entry.status === 'failure' ? 'destructive' : 'outline'}>{entry.status}</Badge><span className="font-medium">{automations.find((item) => item.id === entry.automationId)?.name ?? 'Deleted automation'}</span><span className="text-muted-foreground">{new Date(entry.finishedAt).toLocaleString()} · {entry.completedActions} action(s)</span>{entry.error && <p className="basis-full text-destructive">{entry.error}</p>}</li>)}</ul>}
          </section>
        </div>}
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Sheet open={draft !== null} onOpenChange={(next) => { if (!next) setDraft(null); }}>
      <SheetContent side="right" className="overflow-y-auto sm:max-w-2xl">
        <SheetHeader><SheetTitle>{automations.some((item) => item.id === draft?.id) ? 'Edit automation' : 'Create automation'}</SheetTitle><SheetDescription>Conditions are combined with AND. Actions run from top to bottom.</SheetDescription></SheetHeader>
        {draft && <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">Name<Input aria-label="Automation name" value={draft.name} onChange={(e) => updateDraft({ name: e.target.value })} /></label>
          <label className="flex flex-col gap-1 text-sm">Trigger<Select value={draft.trigger} onValueChange={(value) => updateDraft({ trigger: value as DatabaseAutomation['trigger'], ...(value === 'property-updated' ? { triggerPropertyId: draft.triggerPropertyId ?? writable[0]?.id } : { triggerPropertyId: undefined }) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{triggers.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label>
          {draft.trigger === 'property-updated' && <label className="flex flex-col gap-1 text-sm">Watched property<Select value={draft.triggerPropertyId} onValueChange={(value) => updateDraft({ triggerPropertyId: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{writable.map((property) => <SelectItem key={property.id} value={property.id}>{property.name}</SelectItem>)}</SelectContent></Select></label>}
          <section className="flex flex-col gap-2 rounded-md border p-3"><div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold">Conditions (AND)</h3><p className="text-xs text-muted-foreground">Optional except for “Record enters condition”.</p></div><Button size="sm" variant="outline" onClick={() => updateCondition(draft.conditions.length, {})}><Plus data-icon="inline-start" /> Add condition</Button></div>
            {draft.conditions.map(renderCondition)}
          </section>
          <section className="flex flex-col gap-2"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold">Ordered actions</h3><Button size="sm" variant="outline" onClick={() => updateDraft({ actions: [...draft.actions, { type: 'set-property', propertyId: writable[0]?.id ?? '', value: initialPropertyValue(writable[0]) }] })}><Plus data-icon="inline-start" /> Add action</Button></div>
            {draft.actions.map((action, index) => <div key={`${index}-${action.type}`} className="flex flex-col gap-2 rounded-md border p-3"><div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">Action {index + 1}</span><div className="flex gap-1"><Button size="icon-sm" variant="ghost" aria-label={`Move action ${index + 1} up`} disabled={index === 0} onClick={() => { const actions = [...draft.actions]; [actions[index - 1], actions[index]] = [actions[index]!, actions[index - 1]!]; updateDraft({ actions }); }}><ArrowUp /></Button><Button size="icon-sm" variant="ghost" aria-label={`Move action ${index + 1} down`} disabled={index === draft.actions.length - 1} onClick={() => { const actions = [...draft.actions]; [actions[index], actions[index + 1]] = [actions[index + 1]!, actions[index]!]; updateDraft({ actions }); }}><ArrowDown /></Button><Button size="icon-sm" variant="ghost" aria-label={`Remove action ${index + 1}`} disabled={draft.actions.length === 1} onClick={() => updateDraft({ actions: draft.actions.filter((_, i) => i !== index) })}><Trash2 /></Button></div></div>
              <div className="grid gap-2 sm:grid-cols-2"><Select value={action.type} onValueChange={(type) => { const property = (type === 'update-date' ? database.properties.filter((p) => p.type === 'date') : type === 'set-checkbox' ? database.properties.filter((p) => p.type === 'checkbox') : writable)[0]; updateAction(index, type === 'clear-property' ? { type, propertyId: property?.id ?? '' } : type === 'update-date' ? { type, propertyId: property?.id ?? '', value: '' } : type === 'set-checkbox' ? { type, propertyId: property?.id ?? '', value: true } : { type: 'set-property', propertyId: property?.id ?? '', value: initialPropertyValue(property) }); }}><SelectTrigger aria-label={`Action ${index + 1} type`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="set-property">Set property</SelectItem><SelectItem value="clear-property">Clear property</SelectItem><SelectItem value="update-date">Update date</SelectItem><SelectItem value="set-checkbox">Set checkbox</SelectItem></SelectContent></Select>
                <Select value={action.propertyId} onValueChange={(propertyId) => { const property = database.properties.find((candidate) => candidate.id === propertyId); updateAction(index, { propertyId, ...(action.type === 'set-property' ? { value: initialPropertyValue(property) } : {}) }); }}><SelectTrigger aria-label={`Action ${index + 1} property`}><SelectValue placeholder="Choose property" /></SelectTrigger><SelectContent>{(action.type === 'update-date' ? database.properties.filter((p) => p.type === 'date') : action.type === 'set-checkbox' ? database.properties.filter((p) => p.type === 'checkbox') : writable).map((property) => <SelectItem key={property.id} value={property.id}>{property.name}</SelectItem>)}</SelectContent></Select></div>
              {action.type !== 'clear-property' && <label className="flex flex-col gap-1 text-sm">{titleOf(action.propertyId)} value<ValueEditor property={database.properties.find((property) => property.id === action.propertyId)} value={action.value} label={`${titleOf(action.propertyId)} value`} multiple={action.type === 'set-property' && database.properties.find((property) => property.id === action.propertyId)?.type === 'multi-select'} onChange={(value) => updateAction(index, { value })} /></label>}
            </div>)}
          </section>
        </div>}
        {writable.length === 0 && <p role="status" className="text-sm text-muted-foreground">Add a writable database property before creating an automation action.</p>}
        <SheetFooter><Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button><Button disabled={saving || !draft || !draft.name.trim() || draft.actions.some((action) => !action.propertyId) || (draft.trigger === 'condition-entered' && draft.conditions.length === 0)} onClick={() => draft && void persist(automations.some((item) => item.id === draft.id) ? automations.map((item) => item.id === draft.id ? draft : item) : [...automations, draft])}>{saving ? 'Saving…' : 'Save automation'}</Button></SheetFooter>
      </SheetContent>
    </Sheet>
    <AlertDialog open={deleting !== null} onOpenChange={(next) => { if (!next) setDeleting(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Delete automation?</AlertDialogTitle><AlertDialogDescription>{deleting ? `“${deleting.name}” will be removed. Its execution history will remain available.` : 'This automation will be removed.'}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={saving || deleting === null} onClick={(event) => { event.preventDefault(); if (deleting) void persist(automations.filter((candidate) => candidate.id !== deleting.id)).then((success) => { if (success) setDeleting(null); }); }}>{saving ? 'Deleting…' : 'Delete automation'}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
