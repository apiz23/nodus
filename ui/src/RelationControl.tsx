import { useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { Property } from '../../src/database/schema';
import type { RelationReference } from '../../src/database/relations';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type RelationOption = RelationReference & { aliases?: string[]; tags?: string[] };
const SELECTED_PAGE_SIZE = 12;
const OPTION_RESULT_LIMIT = 50;

function shortId(id: string): string {
  return id.slice(-8);
}

export function RelationControl({ property, value, options = [], references = [], label, onChange, inline = false, targetDatabaseName, targetAvailable = true }: {
  property: Property;
  value: unknown;
  options?: RelationOption[];
  references?: RelationReference[];
  label: string;
  onChange: (value: unknown) => void;
  inline?: boolean;
  targetDatabaseName?: string;
  targetAvailable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedPage, setSelectedPage] = useState(0);
  const ids: string[] = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : typeof value === 'string' && value ? [value] : [];
  const multiple = property.relation?.cardinality === 'many';
  const selectedPages = Math.max(1, Math.ceil(ids.length / SELECTED_PAGE_SIZE));
  const page = Math.min(selectedPage, selectedPages - 1);
  const selectedIds = ids.slice(page * SELECTED_PAGE_SIZE, (page + 1) * SELECTED_PAGE_SIZE);
  const knownReferences = useMemo(() => new Map([...options, ...references].map((item) => [item.id, item])), [options, references]);
  const matching = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return options;
    return options.filter((option) => [option.title, option.path, ...(option.aliases ?? []), ...(option.tags ?? [])]
      .some((field) => field?.toLocaleLowerCase().includes(normalized)));
  }, [options, query]);
  const select = (id: string) => {
    onChange(multiple ? ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id] : ids.includes(id) ? null : id);
    if (!multiple) setOpen(false);
  };
  const command = <Command shouldFilter={false} label={label}>
    <CommandInput aria-label={label} value={query} onValueChange={setQuery} placeholder="Search title, path, alias, or tag" />
    <CommandList className="max-h-60">
      <CommandEmpty>{query ? 'No matching records in the target database.' : 'No records are available in the target database.'}</CommandEmpty>
      <CommandGroup heading={multiple ? 'Select one or more records' : 'Select one record'}>
        {matching.slice(0, OPTION_RESULT_LIMIT).map((option) => {
          const selected = ids.includes(option.id);
          return <CommandItem key={option.id} value={option.id} aria-label={`${selected ? 'Remove' : 'Choose'} ${option.title}`} onSelect={() => select(option.id)}>
            <Check aria-hidden="true" className={selected ? 'opacity-100' : 'opacity-0'} />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{option.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{option.path}{option.aliases?.length ? ` · ${option.aliases.join(', ')}` : ''}</span>
            </span>
          </CommandItem>;
        })}
      </CommandGroup>
    </CommandList>
    {matching.length > OPTION_RESULT_LIMIT ? <p className="px-3 pb-2 text-xs text-muted-foreground" role="status">Showing the first {OPTION_RESULT_LIMIT} matches. Refine your search to see other records.</p> : null}
  </Command>;

  return <div className="flex min-w-0 flex-col gap-2">
    {targetAvailable ? <p className="text-xs text-muted-foreground">{multiple ? 'Multiple records can be linked from' : 'One record can be linked from'} <span className="font-medium text-foreground">{targetDatabaseName ?? 'the target database'}</span>.</p> : <p className="text-xs text-destructive" role="alert">The configured target database is unavailable. Existing references are kept; choose a valid target in the schema editor to add records.</p>}
    {ids.length ? <div className="flex min-w-0 flex-col gap-1.5" aria-label="Selected related records">
      {ids.length > SELECTED_PAGE_SIZE ? <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground" aria-live="polite">Showing {page * SELECTED_PAGE_SIZE + 1}–{Math.min((page + 1) * SELECTED_PAGE_SIZE, ids.length)} of {ids.length} selected</p>
        <div className="flex gap-1">
          <Button type="button" size="icon-xs" variant="ghost" aria-label="Previous selected records" disabled={page === 0} onClick={() => setSelectedPage(Math.max(0, page - 1))}><ChevronLeft /></Button>
          <Button type="button" size="icon-xs" variant="ghost" aria-label="Next selected records" disabled={page >= selectedPages - 1} onClick={() => setSelectedPage(Math.min(selectedPages - 1, page + 1))}><ChevronRight /></Button>
        </div>
      </div> : null}
      <ul className="flex min-w-0 flex-col gap-1">
        {selectedIds.map((id) => {
          const reference = knownReferences.get(id);
          const status = reference?.status ?? 'missing';
          const title = reference?.title;
          const visibleName = status === 'missing' ? 'Missing record' : status === 'incompatible' ? title ?? 'Outside target database' : title ?? 'Untitled record';
          const detail = status === 'resolved' ? reference?.path : `${status === 'missing' ? 'Reference' : 'Reference'} ${shortId(id)}`;
          return <li key={id} className="flex min-w-0 items-center gap-2 rounded-md border bg-background px-2 py-1.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs" title={visibleName}>{visibleName}</span>
              {detail ? <span className={`block truncate text-[11px] ${status === 'resolved' ? 'text-muted-foreground' : 'font-mono text-destructive'}`} title={status === 'resolved' ? detail : undefined}>{detail}</span> : null}
            </span>
            {status !== 'resolved' ? <Badge variant="destructive" className="shrink-0">{status === 'missing' ? 'Missing' : 'Incompatible'}</Badge> : null}
            <Button type="button" size="icon-xs" variant="ghost" className="shrink-0" aria-label={`Remove ${status === 'missing' ? 'missing' : status === 'incompatible' ? 'incompatible' : ''} relation ${title ?? shortId(id)}`} onClick={() => onChange(multiple ? ids.filter((item) => item !== id) : null)}><X /></Button>
          </li>;
        })}
      </ul>
    </div> : <p className="text-xs text-muted-foreground">No records selected.</p>}
    {!inline && ids.length ? <Button type="button" size="xs" variant="ghost" className="self-start" onClick={() => onChange(multiple ? [] : null)}>Clear {multiple ? 'relations' : 'relation'}</Button> : null}
    {inline ? command : <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(''); }}>
      <PopoverTrigger asChild><Button type="button" variant="outline" size="sm" aria-label={label} aria-expanded={open} disabled={!targetAvailable}>{ids.length ? 'Change related records' : 'Choose related records'}</Button></PopoverTrigger>
      <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))] p-0">{command}</PopoverContent>
    </Popover>}
  </div>;
}

export function RelationValue({ references = [], onOpen }: { references?: RelationReference[]; onOpen: (id: string) => void }) {
  if (!references.length) return <span className="text-muted-foreground">—</span>;
  const titleCounts = new Map<string, number>();
  for (const reference of references) if (reference.status === 'resolved' && reference.title) titleCounts.set(reference.title, (titleCounts.get(reference.title) ?? 0) + 1);
  return <ul className="flex min-w-0 flex-col items-start gap-1">
    {references.map((ref) => ref.status === 'resolved'
      ? <li key={ref.id} className="min-w-0 max-w-full">
        <Button type="button" variant="link" size="xs" className="h-auto max-w-full justify-start whitespace-normal p-0 text-left" aria-label={`Open related record ${ref.title ?? 'Untitled record'}${ref.path ? `, ${ref.path}` : ''}`} title={ref.path} onClick={() => onOpen(ref.id)}>
          <span className="min-w-0"><span className="block break-words">{ref.title ?? 'Untitled record'}</span>{ref.path && (titleCounts.get(ref.title ?? '') ?? 0) > 1 ? <span className="block max-w-full truncate text-[11px] text-muted-foreground">{ref.path}</span> : null}</span>
        </Button>
      </li>
      : <li key={ref.id} className="flex max-w-full flex-wrap items-center gap-1.5">
        <Badge variant="destructive">{ref.status === 'missing' ? 'Missing record' : 'Incompatible record'}</Badge>
        {ref.title ? <span className="max-w-48 truncate text-xs text-muted-foreground" title={ref.title}>{ref.title}</span> : null}
        <span className="font-mono text-[10px] text-muted-foreground">{shortId(ref.id)}</span>
      </li>)}
  </ul>;
}
