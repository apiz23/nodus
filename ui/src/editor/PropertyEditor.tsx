import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, LoaderCircle, Plus, Settings2, Trash2 } from 'lucide-react';
import type { NotePropertyDefinition, NotePropertyType, NotePropertyValue, PropertyCatalogMutation } from '../../../src/properties/catalog.js';
import type { UiGeneralNotePropertiesResponse, UiNote, UiPropertyCatalogResponse } from '../../../src/ui-server/dto';
import { ApiError, api } from '../api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type ValueResponse = Pick<UiGeneralNotePropertiesResponse, 'values' | 'issues' | 'contentHash'>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The request failed. Try again.';
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function initialKey(name: string): string {
  const stem = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 52);
  return /^[a-z]/.test(stem) ? stem : `property-${stem || 'value'}`;
}

function displayValue(value: NotePropertyValue): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'Empty list';
  return String(value);
}

export function PropertyEditor({
  note,
  vaultIdentity,
  disabled = false,
  disabledReason,
  busy = false,
  onSetValue,
  onUnsetValue,
  onReloadNote,
  onCatalogChanged,
}: {
  note: UiNote;
  vaultIdentity: string;
  disabled?: boolean;
  disabledReason?: string;
  busy?: boolean;
  onSetValue: (propertyId: string, value: NotePropertyValue) => Promise<UiNote>;
  onUnsetValue: (propertyId: string) => Promise<UiNote>;
  onReloadNote: () => void;
  onCatalogChanged?: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [catalogState, setCatalogState] = useState<UiPropertyCatalogResponse | null>(null);
  const [values, setValues] = useState<ValueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingProperty, setPendingProperty] = useState<string | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [visibleIds, setVisibleIds] = useState<string[]>([]);
  const requestRef = useRef(0);

  async function reload(): Promise<void> {
    const request = ++requestRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [catalog, result] = await Promise.all([api.propertyCatalog(), api.generalNoteProperties(note.id)]);
      if (request !== requestRef.current) return;
      if (result.contentHash !== note.contentHash) {
        setValues(null);
        setLoadError('The note changed while its properties were loading. Reload the note to see the latest values.');
      } else {
        setCatalogState(catalog);
        setValues({ values: result.values, issues: result.issues, contentHash: result.contentHash });
        setVisibleIds((current) => current.filter((id) => catalog.catalog.properties.some((property) => property.id === id)));
      }
    } catch (error) {
      if (request === requestRef.current) setLoadError(errorMessage(error));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    setCatalogState(null);
    setValues(null);
    setVisibleIds([]);
    void reload();
    return () => { requestRef.current += 1; };
  }, [vaultIdentity, note.id, note.contentHash]);

  const catalog = catalogState?.catalog ?? null;
  const visibleProperties = useMemo(() => {
    if (!catalog || !values) return [];
    const visible = new Set([...visibleIds, ...Object.keys(values.values), ...values.issues.map((issue) => issue.propertyId)]);
    return catalog.properties.filter((property) => visible.has(property.id));
  }, [catalog, values, visibleIds]);
  const availableProperties = catalog?.properties.filter((property) => !visibleProperties.some((visible) => visible.id === property.id)) ?? [];
  const issues = new Map(values?.issues.map((issue) => [issue.propertyId, issue.message]) ?? []);

  async function saveValue(propertyId: string, value: NotePropertyValue): Promise<void> {
    if (disabled || busy || pendingProperty !== null) throw new Error(disabledReason ?? 'Wait for the current note change to finish.');
    setPendingProperty(propertyId);
    try {
      const request = requestRef.current;
      const updated = await onSetValue(propertyId, value);
      if (request !== requestRef.current || updated.id !== note.id) return;
      setValues((current) => current === null ? current : {
        values: { ...current.values, [propertyId]: value },
        issues: current.issues.filter((issue) => issue.propertyId !== propertyId),
        contentHash: updated.contentHash,
      });
      setVisibleIds((current) => current.includes(propertyId) ? current : [...current, propertyId]);
    } finally {
      setPendingProperty(null);
    }
  }

  async function unsetValue(propertyId: string): Promise<void> {
    if (disabled || busy || pendingProperty !== null) throw new Error(disabledReason ?? 'Wait for the current note change to finish.');
    setPendingProperty(propertyId);
    try {
      const request = requestRef.current;
      const updated = await onUnsetValue(propertyId);
      if (request !== requestRef.current || updated.id !== note.id) return;
      setValues((current) => current === null ? current : {
        ...current,
        values: Object.fromEntries(Object.entries(current.values).filter(([id]) => id !== propertyId)),
        issues: current.issues.filter((issue) => issue.propertyId !== propertyId),
        contentHash: updated.contentHash,
      });
      setVisibleIds((current) => current.filter((id) => id !== propertyId));
    } finally {
      setPendingProperty(null);
    }
  }

  function includeProperty(id: string): void {
    setVisibleIds((current) => current.includes(id) ? current : [...current, id]);
    setOpen(true);
  }

  return (
    <section className="mt-3 rounded-md border border-border/70" aria-label="Note properties">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex min-h-9 items-center gap-2 px-2.5">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-8 flex-1 justify-start px-1.5 text-xs font-medium">
              <ChevronDown className={`transition-transform ${open ? '' : '-rotate-90'}`} data-icon="inline-start" />
              Properties
              {visibleProperties.length > 0 && <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">{visibleProperties.length}</Badge>}
            </Button>
          </CollapsibleTrigger>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={!catalog} onClick={() => setManagerOpen(true)}>
            <Settings2 data-icon="inline-start" /> {catalog?.properties.length ? 'Manage' : 'Add property'}
          </Button>
        </div>
        <CollapsibleContent>
          <div className="flex flex-col gap-2 border-t px-2.5 py-2.5">
            {loading ? <p className="text-xs text-muted-foreground" role="status">Loading properties…</p> : null}
            {loadError ? <div role="alert" className="flex items-center gap-2 text-xs text-destructive"><span className="flex-1">{loadError}</span><Button size="xs" variant="outline" onClick={() => loadError.includes('note changed while') ? onReloadNote() : void reload()}>{loadError.includes('note changed while') ? 'Reload note' : 'Retry'}</Button></div> : null}
            {!loading && !loadError && visibleProperties.length === 0 ? <p className="text-xs text-muted-foreground">No properties on this note yet.</p> : null}
            {visibleProperties.map((property) => (
              <PropertyValueRow
                key={`${note.id}:${property.id}`}
                property={property}
                hasValue={Boolean(values && Object.hasOwn(values.values, property.id))}
                value={values?.values[property.id]}
                issue={issues.get(property.id)}
                disabled={disabled || busy || pendingProperty !== null}
                pending={pendingProperty === property.id}
                onSave={(value) => saveValue(property.id, value)}
                onUnset={() => unsetValue(property.id)}
              />
            ))}
            {availableProperties.length > 0 ? (
              <div className="flex items-center gap-2 pt-1">
                <Select value="" onValueChange={(id) => includeProperty(id)} disabled={disabled || busy || loading}>
                  <SelectTrigger aria-label="Add property" className="h-7 max-w-64 text-xs"><SelectValue placeholder="Add property…" /></SelectTrigger>
                  <SelectContent><SelectGroup>{availableProperties.map((property) => <SelectItem key={property.id} value={property.id}>{property.name}</SelectItem>)}</SelectGroup></SelectContent>
                </Select>
              </div>
            ) : null}
            {disabled && disabledReason ? <p className="text-[11px] text-muted-foreground">{disabledReason}</p> : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
      <PropertyCatalogDialog open={managerOpen} onOpenChange={setManagerOpen} catalog={catalogState} onUpdated={(updated) => { setCatalogState(updated); void reload(); onCatalogChanged?.(); }} onError={setLoadError} />
    </section>
  );
}

function PropertyValueRow({
  property, hasValue, value, issue, disabled, pending, onSave, onUnset,
}: {
  property: NotePropertyDefinition;
  hasValue: boolean;
  value: NotePropertyValue | undefined;
  issue?: string;
  disabled: boolean;
  pending: boolean;
  onSave: (value: NotePropertyValue) => Promise<void>;
  onUnset: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => typeof value === 'string' || typeof value === 'number' ? String(value) : '');
  const [selected, setSelected] = useState<string[]>(() => Array.isArray(value) ? value : []);
  const [error, setError] = useState<string | null>(null);
  const currentSignature = JSON.stringify(value);
  useEffect(() => {
    if (typeof value === 'string' || typeof value === 'number') setDraft(String(value));
    if (Array.isArray(value)) setSelected(value);
  }, [currentSignature]);
  const saving = pending;
  const unchanged = hasValue && JSON.stringify(property.type === 'multi-select' ? selected : property.type === 'checkbox' ? value : (property.type === 'number' ? Number(draft) : draft)) === JSON.stringify(value);

  async function save(next: NotePropertyValue): Promise<void> {
    setError(null);
    try { await onSave(next); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  async function unset(): Promise<void> {
    setError(null);
    try { await onUnset(); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  function textControl(type: 'text' | 'number' | 'date' | 'url') {
    const inputType = type === 'number' ? 'number' : type === 'date' ? 'date' : 'text';
    const label = `${property.name} value`;
    const urlSafe = type === 'url' && typeof value === 'string' && safeHttpUrl(value);
    return <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <Input aria-label={label} type={inputType} value={draft} onChange={(event) => { setDraft(event.target.value); setError(null); }} disabled={disabled || saving} step={type === 'number' ? 'any' : undefined} className="h-7 min-w-24 text-xs" />
      <Button type="button" size="xs" variant="outline" disabled={disabled || saving || (unchanged && !issue)} onClick={() => {
        if (type === 'number') {
          if (draft.trim() === '' || !Number.isFinite(Number(draft))) { setError('Enter a finite number, or use Unset to remove the value.'); return; }
          void save(Number(draft));
        } else void save(draft);
      }}>Save</Button>
      {urlSafe ? <a className="max-w-24 truncate text-xs underline underline-offset-2" href={value} target="_blank" rel="noopener noreferrer" aria-label={`Open ${property.name} URL`}>Open</a> : null}
    </div>;
  }

  let control: ReactNode;
  switch (property.type) {
    case 'text': control = textControl('text'); break;
    case 'number': control = textControl('number'); break;
    case 'date': control = textControl('date'); break;
    case 'url': control = textControl('url'); break;
    case 'checkbox': control = <label className="flex flex-1 items-center gap-2 text-xs"><Checkbox aria-label={property.name} checked={value === true} disabled={disabled || saving} onCheckedChange={(checked) => void save(checked === true)} />{hasValue ? displayValue(value!) : 'Unset'}</label>; break;
    case 'select': control = <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <Select value={typeof value === 'string' ? property.options?.find((option) => option.label.normalize('NFC').toLowerCase() === value.normalize('NFC').toLowerCase() || option.aliases?.some((alias) => alias.normalize('NFC').toLowerCase() === value.normalize('NFC').toLowerCase()))?.id ?? '' : ''} onValueChange={(id) => { const option = property.options?.find((candidate) => candidate.id === id); if (option) void save(option.label); }} disabled={disabled || saving || !property.options?.length}>
        <SelectTrigger aria-label={property.name} className="h-7 min-w-28 text-xs"><SelectValue placeholder={hasValue ? 'Invalid value' : 'Choose…'} /></SelectTrigger>
        <SelectContent><SelectGroup>{property.options?.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
    </div>; break;
    case 'multi-select': control = <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      {property.options?.length ? property.options.map((option) => <label key={option.id} className="flex items-center gap-2 text-xs"><Checkbox aria-label={`${property.name}: ${option.label}`} checked={selected.some((item) => item.normalize('NFC').toLowerCase() === option.label.normalize('NFC').toLowerCase() || option.aliases?.some((alias) => alias.normalize('NFC').toLowerCase() === item.normalize('NFC').toLowerCase()))} disabled={disabled || saving} onCheckedChange={(checked) => setSelected((current) => checked ? [...current.filter((item) => item.normalize('NFC').toLowerCase() !== option.label.normalize('NFC').toLowerCase()), option.label] : current.filter((item) => item.normalize('NFC').toLowerCase() !== option.label.normalize('NFC').toLowerCase() && !option.aliases?.some((alias) => alias.normalize('NFC').toLowerCase() === item.normalize('NFC').toLowerCase())))} />{option.label}</label>) : <span className="text-xs text-muted-foreground">No options configured.</span>}
      <div className="flex items-center gap-1.5"><span className="mr-auto text-[11px] text-muted-foreground">{selected.length ? selected.join(', ') : hasValue ? 'Empty list' : 'Unset'}</span><Button type="button" size="xs" variant="outline" disabled={disabled || saving || unchanged} onClick={() => void save(selected)}>Save selection</Button></div>
    </div>; break;
  }

  return <div role="group" aria-label={`${property.name} property`} className="grid gap-1.5 sm:grid-cols-[minmax(7rem,0.3fr)_minmax(0,1fr)] sm:items-start">
    <div className="flex min-w-0 items-center gap-1.5 pt-1"><span className="truncate text-xs font-medium" title={property.name}>{property.name}</span><Badge variant="outline" className="px-1 py-0 text-[9px]">{property.type}</Badge>{!hasValue ? <span className="text-[10px] text-muted-foreground">Unset</span> : property.type === 'text' && value === '' ? <span className="text-[10px] text-muted-foreground">Empty</span> : null}<span className="sr-only">{hasValue ? 'Set' : 'Unset'}</span></div>
    <div className="flex min-w-0 items-start gap-1.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {issue ? <p className="text-xs text-destructive" role="alert">{issue}</p> : null}
        {control}
      </div>
      {hasValue || issue ? <Button type="button" size="xs" variant="ghost" className="shrink-0 text-muted-foreground" disabled={disabled || saving} onClick={() => void unset()}>Unset</Button> : null}
      {saving ? <span role="status" className="sr-only">Saving {property.name}</span> : null}
    </div>
    {error ? <p className="text-xs text-destructive sm:col-start-2" role="alert">{error}</p> : null}
  </div>;
}

function safeHttpUrl(value: string): boolean {
  try { const url = new URL(value); return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== ''; }
  catch { return false; }
}

function PropertyCatalogDialog({
  open, onOpenChange, catalog, onUpdated, onError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: UiPropertyCatalogResponse | null;
  onUpdated: (catalog: UiPropertyCatalogResponse) => void;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [type, setType] = useState<NotePropertyType>('text');
  const [newOptions, setNewOptions] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [optionDrafts, setOptionDrafts] = useState<Record<string, string>>({});
  const [optionAdds, setOptionAdds] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => { if (!open) { setError(null); setConfirm(null); } }, [open]);
  useEffect(() => { if (name && !key) setKey(initialKey(name)); }, [name, key]);

  async function mutate(mutation: PropertyCatalogMutation): Promise<boolean> {
    if (!catalog || busy) return false;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.mutatePropertyCatalog({ mutation, baseHash: catalog.contentHash });
      onUpdated(saved);
      onError(null);
      setConfirm(null);
      return true;
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === 'STALE_WRITE') setError('The property catalog changed elsewhere. Reload it before making another change.');
      else setError(errorMessage(reason));
      return false;
    } finally { setBusy(false); }
  }

  async function reloadCatalog(): Promise<void> {
    setBusy(true);
    try { onUpdated(await api.propertyCatalog()); setError(null); onError(null); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }

  async function createProperty(): Promise<void> {
    if (!catalog || !name.trim() || !key.trim()) { setError('Enter a display name and YAML key.'); return; }
    const options = type === 'select' || type === 'multi-select'
      ? newOptions.split('\n').map((label) => label.trim()).filter(Boolean).map((label) => ({ id: randomId(), label }))
      : undefined;
    if (await mutate({ type: 'create-property', property: { id: randomId(), key: key.trim(), name: name.trim(), type, ...(options ? { options } : {}) } })) {
      setName(''); setKey(''); setNewOptions('');
    }
  }

  const definitions = catalog?.catalog.properties ?? [];
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
      <DialogHeader><DialogTitle>Manage note properties</DialogTitle><DialogDescription>Definitions apply across this vault. Renaming labels keeps the stable YAML key and preserves existing values.</DialogDescription></DialogHeader>
      {error ? <div className="flex items-center gap-2 rounded-md border border-destructive/30 p-2 text-xs text-destructive" role="alert"><span className="flex-1">{error}</span>{error.includes('changed elsewhere') && <Button size="xs" variant="outline" disabled={busy} onClick={() => void reloadCatalog()}>Reload catalog</Button>}</div> : null}
      <div className="flex flex-col gap-3">
        <section className="rounded-md border p-3">
          <h3 className="mb-2 text-sm font-medium">Create a property</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs">Display name<Input value={name} onChange={(event) => { setName(event.target.value); if (!key || key === initialKey(name)) setKey(initialKey(event.target.value)); }} placeholder="Reading status" disabled={busy} /></label>
            <label className="flex flex-col gap-1 text-xs">Stable YAML key<Input value={key} onChange={(event) => setKey(event.target.value)} placeholder="reading-status" disabled={busy} /></label>
            <label className="flex flex-col gap-1 text-xs">Type<Select value={type} onValueChange={(value) => setType(value as NotePropertyType)} disabled={busy}><SelectTrigger aria-label="Property type"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{(['text', 'number', 'checkbox', 'date', 'select', 'multi-select', 'url'] as const).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectGroup></SelectContent></Select></label>
            {type === 'select' || type === 'multi-select' ? <label className="flex flex-col gap-1 text-xs sm:col-span-2">Options, one per line<textarea value={newOptions} onChange={(event) => setNewOptions(event.target.value)} rows={3} className="min-h-16 rounded-md border border-input bg-transparent px-2.5 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={busy} /></label> : null}
          </div>
          <Button type="button" size="sm" className="mt-3" disabled={busy || !name.trim() || !key.trim()} onClick={() => void createProperty()}>{busy ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <Plus data-icon="inline-start" />}Create property</Button>
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Vault definitions</h3>
          {definitions.length === 0 ? <p className="text-xs text-muted-foreground">No definitions yet.</p> : definitions.map((property) => <DefinitionRow key={property.id} property={property} busy={busy} confirm={confirm} onConfirmChange={setConfirm} onMutate={mutate} draftName={draftNames[property.id] ?? property.name} onDraftName={(value) => setDraftNames((current) => ({ ...current, [property.id]: value }))} optionDrafts={optionDrafts} onOptionDraft={(id, value) => setOptionDrafts((current) => ({ ...current, [id]: value }))} optionAdd={optionAdds[property.id] ?? ''} onOptionAdd={(value) => setOptionAdds((current) => ({ ...current, [property.id]: value }))} />)}
        </section>
      </div>
      <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function DefinitionRow({
  property, busy, confirm, onConfirmChange, onMutate, draftName, onDraftName, optionDrafts, onOptionDraft, optionAdd, onOptionAdd,
}: {
  property: NotePropertyDefinition; busy: boolean; confirm: string | null;
  onConfirmChange: (confirm: string | null) => void;
  onMutate: (mutation: PropertyCatalogMutation) => Promise<boolean>;
  draftName: string; onDraftName: (value: string) => void;
  optionDrafts: Record<string, string>; onOptionDraft: (id: string, value: string) => void;
  optionAdd: string; onOptionAdd: (value: string) => void;
}) {
  const supportsOptions = property.type === 'select' || property.type === 'multi-select';
  return <article className="rounded-md border p-3">
    <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary">{property.type}</Badge><code className="text-[11px] text-muted-foreground">{property.key}</code><span className="ml-auto text-[11px] text-muted-foreground">Stable ID</span></div>
    <div className="mt-2 flex items-center gap-2"><Input aria-label={`Name for ${property.key}`} value={draftName} onChange={(event) => onDraftName(event.target.value)} disabled={busy} className="h-7 text-xs" /><Button size="xs" variant="outline" disabled={busy || draftName === property.name || !draftName.trim()} onClick={() => { const next = draftName.trim(); void onMutate({ type: 'rename-property', propertyId: property.id, name: next }).then((saved) => { if (saved) onDraftName(next); }); }}>Rename</Button></div>
    {supportsOptions ? <div className="mt-3 flex flex-col gap-1.5">
      {property.options?.map((option) => <div key={option.id} className="flex items-center gap-2"><Input aria-label={`Option ${option.label}`} value={optionDrafts[option.id] ?? option.label} onChange={(event) => onOptionDraft(option.id, event.target.value)} disabled={busy} className="h-7 text-xs" /><Button size="xs" variant="outline" disabled={busy || (optionDrafts[option.id] ?? option.label) === option.label || !(optionDrafts[option.id] ?? option.label).trim()} onClick={() => { const next = (optionDrafts[option.id] ?? option.label).trim(); void onMutate({ type: 'rename-option', propertyId: property.id, optionId: option.id, label: next }).then((saved) => { if (saved) onOptionDraft(option.id, next); }); }}>Rename option</Button><Button size="icon-xs" variant="ghost" aria-label={`Remove option ${option.label}`} disabled={busy} onClick={() => onConfirmChange(`${property.id}:option:${option.id}`)}><Trash2 /></Button></div>)}
      <div className="flex items-center gap-2"><Input aria-label={`New option for ${property.name}`} value={optionAdd} onChange={(event) => onOptionAdd(event.target.value)} placeholder="Add option" disabled={busy} className="h-7 text-xs" /><Button size="xs" variant="outline" disabled={busy || !optionAdd.trim()} onClick={() => void onMutate({ type: 'add-option', propertyId: property.id, option: { id: randomId(), label: optionAdd.trim() } }).then((saved) => { if (saved) onOptionAdd(''); })}>Add option</Button></div>
    </div> : null}
    {confirm?.startsWith(`${property.id}:option:`) ? <div className="mt-3 rounded-md bg-muted p-2 text-xs"><p>Existing note values will remain in YAML, but removing this option makes those values invalid.</p><div className="mt-2 flex justify-end gap-2"><Button size="xs" variant="ghost" onClick={() => onConfirmChange(null)}>Cancel</Button><Button size="xs" variant="destructive" disabled={busy} onClick={() => { const optionId = confirm.split(':option:')[1]!; void onMutate({ type: 'remove-option', propertyId: property.id, optionId, confirmUnregisterValues: true }).then(() => onConfirmChange(null)); }}>Confirm removal</Button></div></div> : null}
    <div className="mt-3 border-t pt-2">
      <Button type="button" size="xs" variant="ghost" className="text-destructive" disabled={busy} onClick={() => onConfirmChange(`${property.id}:delete`)}>Delete definition</Button>
      {confirm === `${property.id}:delete` ? <div className="rounded-md bg-muted p-2 text-xs"><p>Deleting this definition does not delete its existing YAML values. They remain as unregistered frontmatter.</p><div className="mt-2 flex justify-end gap-2"><Button size="xs" variant="ghost" onClick={() => onConfirmChange(null)}>Cancel</Button><Button size="xs" variant="destructive" disabled={busy} onClick={() => void onMutate({ type: 'delete-property', propertyId: property.id, confirmUnregisterValues: true }).then(() => onConfirmChange(null))}>Confirm delete</Button></div></div> : null}
    </div>
  </article>;
}
