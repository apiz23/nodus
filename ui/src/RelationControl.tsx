import { useState } from 'react';
import type { Property } from '../../src/database/schema';
import type { RelationReference } from '../../src/database/relations';
import { Button } from '@/components/ui/button';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function RelationControl({ property, value, options = [], label, onChange, inline = false }: {
  property: Property; value: unknown; options?: RelationReference[]; label: string; onChange: (value: unknown) => void; inline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ids: string[] = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
  const multiple = property.relation?.cardinality === 'many';
  const matching = options.filter((option) => `${option.title} ${option.path} ${option.id}`.toLowerCase().includes(query.toLowerCase()));
  const select = (id: string) => {
    onChange(multiple ? ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id] : ids.includes(id) ? null : id);
    if (!multiple) setOpen(false);
  };
  const command = <Command shouldFilter={false} label={label}>
    <CommandInput value={query} onValueChange={setQuery} placeholder="Find related records…" />
    <CommandList className="max-h-60"><CommandEmpty>No matching records in the target database.</CommandEmpty>
      <CommandGroup>{matching.slice(0, 50).map((option) => <CommandItem key={option.id} value={option.id} aria-label={`Choose ${option.title}`} onSelect={() => select(option.id)}>
        <span>{ids.includes(option.id) ? '✓ ' : ''}{option.title}<span className="block text-xs text-muted-foreground">{option.path} · {option.id}</span></span>
      </CommandItem>)}</CommandGroup>
    </CommandList>{matching.length > 50 ? <p className="p-2 text-xs text-muted-foreground">First 50 records; refine your search.</p> : null}
  </Command>;
  return <div className="flex min-w-0 flex-col gap-2">
    <div className="flex flex-wrap gap-1">{ids.map((id) => <Button key={id} size="xs" variant="outline" className="h-auto max-w-full justify-start whitespace-normal break-words text-left" aria-label={`Remove relation ${options.find((item) => item.id === id)?.title ?? id}`} onClick={() => multiple ? onChange(ids.filter((item) => item !== id)) : onChange(null)}>
      {options.find((item) => item.id === id)?.title ?? `Missing/incompatible: ${id}`} ×
    </Button>)}</div>
    {!inline ? <Button size="xs" variant="ghost" onClick={() => onChange(multiple ? [] : null)}>Clear relation</Button> : null}
    {inline ? command : <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button variant="outline" size="sm" aria-label={label} aria-expanded={open}>{ids.length ? 'Change related records' : 'Choose related records'}</Button></PopoverTrigger><PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-0">{command}</PopoverContent></Popover>}
  </div>;
}

export function RelationValue({ references = [], onOpen }: { references?: RelationReference[]; onOpen: (id: string) => void }) {
  if (!references.length) return <span className="text-muted-foreground">—</span>;
  return <span className="flex flex-wrap gap-1">{references.map((ref) => ref.status === 'resolved'
    ? <Button key={ref.id} variant="link" size="xs" className="h-auto max-w-full justify-start whitespace-normal break-words p-0 text-left" title={`${ref.path} · ${ref.id}`} onClick={() => onOpen(ref.id)}>{ref.title}</Button>
    : <span key={ref.id} className="break-all text-xs text-destructive">{ref.status === 'missing' ? 'Missing/deleted' : 'Incompatible'}: {ref.title ?? ref.id}</span>)}</span>;
}
