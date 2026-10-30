import { useEffect, useState } from 'react';
import { ListFilter, Plus, X } from 'lucide-react';
import type { NotePropertyDefinition } from '../../src/properties/catalog.js';
import { operatorsForProperty, type NoteFilter, type NoteFilterLogic } from '../../src/search/note-filters.js';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from './api';

interface Props {
  vaultKey: string;
  revision: number;
  filters: readonly NoteFilter[];
  logic: NoteFilterLogic;
  onChange(filters: NoteFilter[], logic: NoteFilterLogic): void;
}

export function NoteFiltersPopover({ vaultKey, revision, filters, logic, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [properties, setProperties] = useState<NotePropertyDefinition[]>([]);
  const [catalogIssue, setCatalogIssue] = useState<string | null>(null);
  const [kind, setKind] = useState<'tag' | 'property'>('tag');
  const [propertyId, setPropertyId] = useState('');
  const [operator, setOperator] = useState('contains');
  const [value, setValue] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void api.searchMetadata(true).then((metadata) => {
      if (cancelled) return;
      setTags(metadata.tags);
      setProperties(metadata.properties);
      setCatalogIssue(metadata.catalogIssue ?? null);
      setLoadError(null);
    }).catch((error: unknown) => {
      if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load metadata filters.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, vaultKey, revision]);

  const definition = properties.find((property) => property.id === propertyId);
  const operators = kind === 'tag' ? ['contains', 'does-not-contain', 'contains-all'] : definition ? operatorsForProperty(definition) : [];
  const setKindValue = (next: 'tag' | 'property') => {
    setKind(next);
    setOperator(next === 'tag' ? 'contains' : (properties.find((item) => item.id === propertyId) ? operatorsForProperty(properties.find((item) => item.id === propertyId)!)[0] ?? 'equals' : 'equals'));
    setValue('');
  };
  const noValue = ['is-empty', 'is-not-empty', 'is-checked', 'is-unchecked'].includes(operator);
  const parseValue = (): NoteFilter | null => {
    if (kind === 'tag') {
      const values = value.split(',').map((tag) => tag.normalize('NFC').trim()).filter(Boolean);
      if (!values.length) return null;
      return { type: 'tag', operator: operator as 'contains' | 'does-not-contain' | 'contains-all', value: operator === 'contains-all' ? values : values[0]! };
    }
    if (!definition) return null;
    if (noValue) return { type: 'property', propertyId: definition.id, operator };
    if (definition.type === 'number') {
      if (!value.trim() || !Number.isFinite(Number(value))) return null;
      return { type: 'property', propertyId: definition.id, operator, value: Number(value) };
    }
    if (definition.type === 'multi-select') {
      const values = value.split(',').map((item) => item.trim()).filter(Boolean);
      if (!values.length) return null;
      return { type: 'property', propertyId: definition.id, operator, value: operator === 'contains-all' ? values : values[0]! };
    }
    return { type: 'property', propertyId: definition.id, operator, value };
  };
  const addFilter = () => {
    const filter = parseValue();
    if (!filter) return;
    onChange([...filters, filter], logic);
    setValue('');
  };
  const filterLabel = (filter: NoteFilter) => {
    if (filter.type === 'tag') return `Tag ${filter.operator.replaceAll('-', ' ')} ${Array.isArray(filter.value) ? filter.value.join(', ') : filter.value}`;
    const property = properties.find((item) => item.id === filter.propertyId);
    const valueLabel = filter.value === undefined ? '' : ` ${Array.isArray(filter.value) ? filter.value.join(', ') : String(filter.value)}`;
    return `${property?.name ?? 'Deleted property'} ${filter.operator.replaceAll('-', ' ')}${valueLabel}`;
  };

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" size="icon-sm" aria-label={`Filter notes${filters.length ? `, ${filters.length} active` : ''}`} className="relative shrink-0">
        <ListFilter />{filters.length ? <span className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">{filters.length}</span> : null}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-[min(360px,calc(100vw-24px))] space-y-3">
      <div><div className="text-sm font-medium">Filter notes</div><p className="text-xs text-muted-foreground">Combine metadata filters with {logic.toUpperCase()}.</p></div>
      {loadError ? <div role="alert" className="text-xs text-destructive">{loadError}<Button size="xs" variant="link" onClick={() => setOpen(false)}>Close and retry</Button></div> : null}
      {catalogIssue ? <p role="status" className="text-xs text-amber-700 dark:text-amber-300">Property filters unavailable: {catalogIssue}</p> : null}
      <div className="flex items-center gap-2">
        <Select value={kind} onValueChange={(next) => setKindValue(next as 'tag' | 'property')}>
          <SelectTrigger aria-label="Filter field type" className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="tag">Tag</SelectItem><SelectItem value="property">Property</SelectItem></SelectContent>
        </Select>
        {kind === 'property' ? <Select value={propertyId} onValueChange={(next) => { setPropertyId(next); const selected = properties.find((item) => item.id === next); setOperator(selected ? operatorsForProperty(selected)[0]! : ''); setValue(''); }}>
          <SelectTrigger aria-label="Property" className="min-w-0 flex-1"><SelectValue placeholder="Choose property" /></SelectTrigger>
          <SelectContent>{properties.map((property) => <SelectItem key={property.id} value={property.id}>{property.name}</SelectItem>)}</SelectContent>
        </Select> : null}
      </div>
      {kind === 'property' && definition === undefined ? <p className="text-xs text-muted-foreground">{loading ? 'Loading properties…' : 'No registered properties are available.'}</p> : null}
      {operators.length ? <div className="flex gap-2">
        <Select value={operator} onValueChange={(next) => { setOperator(next); setValue(''); }}>
          <SelectTrigger aria-label="Filter operator" className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>{operators.map((item) => <SelectItem key={item} value={item}>{item.replaceAll('-', ' ')}</SelectItem>)}</SelectContent>
        </Select>
        {!noValue ? (kind === 'property' && definition?.type === 'select' ? <Select value={value} onValueChange={setValue}>
          <SelectTrigger aria-label="Filter value" className="min-w-0 flex-1"><SelectValue placeholder="Choose value" /></SelectTrigger><SelectContent>{definition.options?.flatMap((option) => [option.label, ...(option.aliases ?? [])]).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
        </Select> : <Input aria-label="Filter value" placeholder={kind === 'tag' || definition?.type === 'multi-select' ? 'Enter value(s), comma separated' : 'Value'} list={kind === 'tag' ? 'nodus-tag-filter-suggestions' : undefined} type={definition?.type === 'date' ? 'date' : definition?.type === 'number' ? 'number' : 'text'} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addFilter(); } }} className="min-w-0 flex-1" />) : null}
      </div> : null}
      {kind === 'tag' ? <datalist id="nodus-tag-filter-suggestions">{tags.map((tag) => <option key={tag} value={tag} />)}</datalist> : null}
      <Button type="button" size="sm" className="w-full" disabled={!parseValue()} onClick={addFilter}><Plus />Add filter</Button>
      {filters.length ? <>
        <div className="flex items-center justify-between"><span className="text-xs font-medium">Active filters</span><Select value={logic} onValueChange={(next) => onChange([...filters], next as NoteFilterLogic)}><SelectTrigger aria-label="Filter combination" className="h-7 w-20"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="and">AND</SelectItem><SelectItem value="or">OR</SelectItem></SelectContent></Select></div>
        <div className="flex max-h-32 flex-col gap-1 overflow-y-auto">{filters.map((filter, index) => <div key={`${index}-${filter.type === 'property' ? filter.propertyId : 'tag'}`} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1"><Badge variant="secondary" className="max-w-[260px] truncate">{filterLabel(filter)}</Badge><Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove filter ${filterLabel(filter)}`} onClick={() => onChange(filters.filter((_, itemIndex) => itemIndex !== index), logic)}><X /></Button></div>)}</div>
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => onChange([], 'and')}>Clear all</Button>
      </> : null}
    </PopoverContent>
  </Popover>;
}
