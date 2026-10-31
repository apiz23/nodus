import { hasBlockingRowIssues } from './database-table';
import { RelationControl, RelationValue } from './RelationControl';
import { RelationSchemaFields } from './RelationSchemaFields';
import { isDerivedProperty } from '../../src/database/schema';
import type { RelationReference } from '../../src/database/relations';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowDownAZ, ArrowUpAZ, Check, ChevronDown, ChevronRight, Columns3, Database, ListFilter, Pencil, Plus, RefreshCw, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { PROPERTY_TYPES, type DatabaseDefinition, type Property, type PropertyType } from '../../src/database/schema';
import type {
  UiDatabase,
  UiDatabaseRowsResponse,
  UiDatabaseRow,
  UiNoteSummary,
} from '../../src/ui-server/dto';
import {
  filterOperators,
  isValidFilter,
  initialFilterValue,
  databaseIdentityLabel,
  selectDatabaseRows,
  type DatabaseFilter,
  type DatabaseFilterOperator,
  type DatabaseSortDirection,
  type DatabaseSortField,
} from './database-table';
import { ApiError, api } from './api';
import { SidebarToggle } from './SidebarToggle';
import { diagnoseDatabaseView, type DatabaseView } from '../../src/database/database-view';
import { SavedViewControls } from './SavedViewControls';
import { KanbanView, CalendarView } from './DatabaseLayouts';
import { defaultView, isDateOnly, type ViewConfiguration } from './database-view-layout';

const SEARCHABLE_OPTIONS_THRESHOLD = 8;

function propertyTypeLabel(type: PropertyType): string {
  switch (type) {
    case 'multi-select': return 'Multi-select';
    case 'checkbox': return 'Checkbox';
    default: return `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
  }
}

interface DatabasesViewProps {
  vaultKey?: string;
  onNoteCreated?: (note: UiNoteSummary) => void;
  databases: UiDatabase[];
  notes: UiNoteSummary[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
  onDatabaseSaved: (database: UiDatabase, created: boolean, selectCreated: boolean) => void;
  onOpenNote: (id: string) => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

interface EditingProperty {
  noteId: string;
  propertyId: string;
  draft: unknown;
  source: 'row' | 'add';
  baseHash?: string;
  remove?: boolean;
}

function initialValue(property: Property): unknown {
  switch (property.type) {
    case 'text':
    case 'date':
      return '';
    case 'number':
      return '';
    case 'checkbox':
      return false;
    case 'select':
      return property.options?.[0]?.id ?? '';
    case 'relation': return property.relation?.cardinality === 'one' ? null : [];
    case 'rollup': return null;
    case 'multi-select':
      return [];
  }
}

function valueForInput(property: Property, value: unknown): unknown {
  return value === undefined ? initialValue(property) : value;
}

export function formatPropertyValue(property: Property, value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (property.type === 'rollup' && property.rollup?.operation === 'completion-percentage') return `${Number(value).toFixed(1)}%`;
  if (property.type === 'checkbox') return value === true ? 'Yes' : 'No';
  if (property.type === 'select') {
    return property.options?.find((option) => option.id === value)?.name ?? String(value);
  }
  if (property.type === 'multi-select' && Array.isArray(value)) {
    return value
      .map((id) => property.options?.find((option) => option.id === id)?.name ?? String(id))
      .join(', ') || '—';
  }
  return String(value);
}

function toApiValue(property: Property, value: unknown): string | number | boolean | string[] | null {
  if (property.type === 'relation') return value as string | string[] | null;
  if (property.type === 'number') {
    if (typeof value !== 'string' || value.trim() === '') throw new Error('Enter a finite number.');
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) throw new Error('Enter a finite number.');
    return numberValue;
  }
  if (property.type === 'multi-select') return Array.isArray(value) ? value as string[] : [];
  if (property.type === 'checkbox') return value === true;
  if (typeof value !== 'string') throw new Error('Choose a value before saving.');
  if (property.type === 'select' && value === '') throw new Error('Choose an option before saving.');
  if (property.type === 'date' && value === '') throw new Error('Choose a date before saving.');
  return value;
}

function SearchableOptionPicker({
  property,
  value,
  label,
  onChange,
}: {
  property: Property;
  value: unknown;
  label: string;
  onChange: (value: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = property.options ?? [];
  const multiple = property.type === 'multi-select';
  const selectedIds = multiple
    ? Array.isArray(value) ? value as string[] : []
    : typeof value === 'string' ? [value] : [];
  const selectedNames = options
    .filter((option) => selectedIds.includes(option.id))
    .map((option) => option.name);
  const triggerLabel = multiple
    ? selectedNames.length === 0
      ? 'Choose options'
      : selectedNames.length <= 2
        ? selectedNames.join(', ')
        : `${selectedNames.length} selected`
    : selectedNames[0] ?? 'Choose an option';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="w-full justify-between" aria-label={label} aria-expanded={open}>
          <span className="min-w-0 truncate">{triggerLabel}</span>
          <ChevronRight className="rotate-90 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={`${property.name} options`} className="w-64 min-w-[var(--radix-popover-trigger-width)] p-0">
        <Command label={`Search ${property.name} options`}>
          <CommandInput
            aria-label={`Search ${property.name} options`}
            placeholder={`Search ${property.name.toLocaleLowerCase()}…`}
          />
          <CommandList className="max-h-64" aria-label={`${property.name} options`}>
            <CommandEmpty>No matching options.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const checked = selectedIds.includes(option.id);
                return (
                  <CommandItem
                    key={option.id}
                    value={`${option.name} ${option.id}`}
                    aria-label={`${option.name}${checked ? ', selected' : ''}`}
                    onSelect={() => {
                      if (multiple) {
                        onChange(checked
                          ? selectedIds.filter((id) => id !== option.id)
                          : [...selectedIds, option.id]);
                      } else {
                        onChange(option.id);
                        setOpen(false);
                      }
                    }}
                  >
                    {multiple ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'grid size-3.5 shrink-0 place-items-center rounded-[3px] border',
                          checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                        )}
                      >
                        {checked ? <Check className="size-2.5" /> : null}
                      </span>
                    ) : checked ? <Check /> : <span aria-hidden="true" className="size-4" />}
                    <span className="min-w-0 truncate">{option.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function PropertyControl({
  property,
  value,
  label,
  onChange,
  relationOptions,
}: {
  property: Property;
  relationOptions?: RelationReference[];
  value: unknown;
  label: string;
  onChange: (value: unknown) => void;
}) {
  if (property.type === 'relation') return <RelationControl property={property} value={value} label={label} options={relationOptions} onChange={onChange} />;
  if (property.type === 'select' || property.type === 'multi-select') {
    const options = property.options ?? [];
    if (options.length > SEARCHABLE_OPTIONS_THRESHOLD) {
      return <SearchableOptionPicker property={property} value={value} label={label} onChange={onChange} />;
    }
  }

  if (property.type === 'checkbox') {
    return (
      <Button
        type="button"
        size="sm"
        variant={value === true ? 'secondary' : 'outline'}
        aria-label={label}
        aria-pressed={value === true}
        onClick={() => onChange(value !== true)}
      >
        <span className="inline-flex items-center gap-1.5">
          {value === true ? <Check data-icon="inline-start" /> : null}
          {value === true ? 'Yes' : 'No'}
        </span>
      </Button>
    );
  }

  if (property.type === 'select') {
    const options = property.options ?? [];
    const selected = options.find((option) => option.id === value);
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="w-full justify-between" aria-label={label}>
            <span className="truncate">{selected?.name ?? 'Choose an option'}</span>
            <ChevronRight className="rotate-90 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-64 w-56">
          <DropdownMenuRadioGroup value={typeof value === 'string' ? value : ''} onValueChange={onChange}>
            {options.map((option) => (
              <DropdownMenuRadioItem key={option.id} value={option.id}>
                {option.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {options.length === 0 ? <div className="px-2 py-1.5 text-xs text-muted-foreground">No options defined.</div> : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  if (property.type === 'multi-select') {
    const options = property.options ?? [];
    const selected = Array.isArray(value) ? value as string[] : [];
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="w-full justify-start truncate" aria-label={label}>
            {formatPropertyValue(property, selected)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-64 w-56">
          <DropdownMenuGroup>
            {options.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.id}
                checked={selected.includes(option.id)}
                onCheckedChange={(checked) => {
                  onChange(checked
                    ? [...selected, option.id]
                    : selected.filter((id) => id !== option.id));
                }}
              >
                {option.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
          {options.length === 0 ? <div className="px-2 py-1.5 text-xs text-muted-foreground">No options defined.</div> : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const type = (property.type === 'number' || property.type === 'rollup') ? 'number' : property.type === 'date' ? 'date' : 'text';
  return (
    <Input
      type={type}
      step={type === 'number' ? 'any' : undefined}
      value={typeof value === 'string' || typeof value === 'number' ? value : ''}
      aria-label={label}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

function issueSummary(issue: { path: string; message: string }): string {
  return `${issue.path}: ${issue.message}`;
}

export function DatabasesView({
  vaultKey = 'local-vault',
  onNoteCreated,
  databases,
  notes,
  loading,
  error,
  selectedId,
  onSelect,
  onRetry,
  onDatabaseSaved,
  onOpenNote,
  sidebarCollapsed,
  onToggleSidebar,
}: DatabasesViewProps) {
  const selected = databases.find((database) => database.id === selectedId) ?? databases[0] ?? null;
  const [rowData, setRowData] = useState<UiDatabaseRowsResponse | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingProperty | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionIssues, setActionIssues] = useState<string[]>([]);
  const [stale, setStale] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [focusedFilterId, setFocusedFilterId] = useState<string | null>(null);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [candidatePropertyId, setCandidatePropertyId] = useState<string | null>(null);
  const [confirmedAdd, setConfirmedAdd] = useState(false);
  const [schemaDraft, setSchemaDraft] = useState<DatabaseDefinition | null>(null);
  const [schemaCreating, setSchemaCreating] = useState(false);
  const [schemaSaving, setSchemaSaving] = useState(false);
  const [schemaStale, setSchemaStale] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [schemaNotice, setSchemaNotice] = useState<string | null>(null);
  const [schemaNoticeDatabaseId, setSchemaNoticeDatabaseId] = useState<string | null>(null);
  const [newPropertyIds, setNewPropertyIds] = useState<Set<string>>(() => new Set());
  const [sortField, setSortField] = useState<DatabaseSortField>('title');
  const [sortDirection, setSortDirection] = useState<DatabaseSortDirection>('asc');
  const [sorts, setSorts] = useState<Array<{ propertyId: DatabaseSortField; direction: DatabaseSortDirection }>>([{ propertyId: 'title', direction: 'asc' }]);
  const [filters, setFilters] = useState<DatabaseFilter[]>([]);
  const [hiddenPropertyIds, setHiddenPropertyIds] = useState<Set<string>>(() => new Set());
  const [savedPresentation, setSavedPresentation] = useState<DatabaseView | null>(null);
  const [viewsLoading, setViewsLoading] = useState(true);
  const [newDatedEntry, setNewDatedEntry] = useState<{ date: string; title: string; noteId?: string; baseHash?: string } | null>(null);
  const mutationGeneration = useRef(0);
  const schemaGeneration = useRef(0);
  const schemaTriggerRef = useRef<HTMLElement | null>(null);
  const onRetryRef = useRef(onRetry);
  const mounted = useRef(true);
  const cardEditorRef = useRef<HTMLElement | null>(null);
  const datedTriggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (editing?.source === 'row' && savedPresentation?.type && savedPresentation.type !== 'table') cardEditorRef.current?.focus();
  }, [editing?.noteId, editing?.propertyId, editing?.source, savedPresentation?.type]);
  onRetryRef.current = onRetry;

  useLayoutEffect(() => {
    mutationGeneration.current += 1;
    schemaGeneration.current += 1;
    setSchemaDraft(null);
    schemaTriggerRef.current = null;
    setSchemaCreating(false);
    setSchemaSaving(false);
    setSchemaError(null);
    setSchemaNotice(null);
    setSchemaNoticeDatabaseId(null);
    setSchemaStale(false);
    setRowsError(null);
    setRowsLoading(selected !== null);
    setEditing(null);
    setAddOpen(false);
    setAddQuery('');
    setCandidateId(null);
    setCandidatePropertyId(null);
    setConfirmedAdd(false);
    setActionError(null);
    setActionNotice(null);
    setActionIssues([]);
    setStale(false);
    // A request for the previous database may still finish in the background,
    // but it must not leave the newly selected view stuck in a saving state.
    setSaving(false);
    setSortField('title');
    setSortDirection('asc');
    setSorts([{ propertyId: 'title', direction: 'asc' }]);
    setFilters([]);
    setHiddenPropertyIds(new Set());
    setSavedPresentation(null);
    setViewsLoading(true);
    setNewDatedEntry(null);
  }, [selected?.id]);

  useEffect(() => {
    if (selected === null) {
      setRowData(null);
      return undefined;
    }
    let current = true;
    setRowData(null);
    setRowsLoading(true);
    setRowsError(null);
    setActionError(null);
    setActionNotice(null);
    setActionIssues([]);
    setStale(false);
    api.databaseRows(selected.id, selected.contentHash).then((result) => {
      if (current) setRowData(result);
    }).catch((cause: unknown) => {
      if (current) {
        setRowsError(cause instanceof Error ? cause.message : 'Could not load database rows.');
        if (cause instanceof ApiError && cause.code === 'SCHEMA_CHANGED') onRetryRef.current();
      }
    }).finally(() => {
      if (current) setRowsLoading(false);
    });
    return () => { current = false; };
  }, [selected?.id, selected?.contentHash, reloadVersion]);

  // Old responses may remain in state for one render after selection changes.
  // Only expose rows that match both the selected database and schema revision.
  const currentRowData = selected !== null
    && rowData?.databaseId === selected.id
    && rowData.schemaHash === selected.contentHash
    ? rowData
    : null;
  const currentDiagnostics = currentRowData === null || selected === null
    ? []
    : currentRowData.diagnostics.filter((issue) => issue.databaseId === selected.id);
  const memberIds = useMemo(() => new Set(currentRowData?.rows.map((row) => row.noteId) ?? []), [currentRowData]);
  const matchingCandidates = useMemo(() => {
    const query = addQuery.trim().toLocaleLowerCase();
    return notes
      .filter((note) => !memberIds.has(note.id))
      .filter((note) => query === '' || `${note.title} ${note.path}`.toLocaleLowerCase().includes(query));
  }, [addQuery, memberIds, notes]);
  const candidates = matchingCandidates.slice(0, 50);
  const candidate = notes.find((note) => note.id === candidateId) ?? null;
  const candidateProperty = selected?.properties.find((property) => property.id === candidatePropertyId) ?? null;
  const displayRows = useMemo(() => selected === null || currentRowData === null
    ? []
    : selectDatabaseRows(currentRowData.rows, selected.properties, filters, sorts),
  [filters, currentRowData, selected, sorts]);
  const visibleProperties = useMemo(
    () => selected === null ? [] : [
      ...(savedPresentation?.visiblePropertyIds ?? []).flatMap((id) => selected.properties.find((property) => property.id === id) ?? []),
      ...selected.properties.filter((property) => !savedPresentation?.visiblePropertyIds.includes(property.id)),
    ].filter((property) => !hiddenPropertyIds.has(property.id)),
    [hiddenPropertyIds, selected, savedPresentation],
  );
  const appliedFilterCount = selected === null
    ? 0
    : filters.filter((filter) => {
        const property = selected.properties.find((item) => item.id === filter.propertyId);
        return property !== undefined && isValidFilter(property, filter.operator, filter.value);
      }).length;
  const hiddenPropertyCount = selected === null ? 0 : selected.properties.length - visibleProperties.length;
  const viewConfiguration: ViewConfiguration = {
    type: savedPresentation?.type ?? 'table', settings: savedPresentation?.settings ?? {},
    sort: sorts[0] ?? { propertyId: sortField, direction: sortDirection },
    sorts,
    filters: filters as DatabaseView['filters'],
    visiblePropertyIds: [
      ...visibleProperties.map((property) => property.id),
      ...(savedPresentation?.visiblePropertyIds.filter((id) => !selected?.properties.some((property) => property.id === id)) ?? []),
    ],
  };
  const viewIssues = selected === null || savedPresentation === null ? [] : diagnoseDatabaseView({ id: '', databaseId: selected.id, name: '', ...viewConfiguration }, selected);
  const layoutProperty = selected?.properties.find((property) => property.id === (viewConfiguration.type === 'kanban'
    ? viewConfiguration.settings?.groupPropertyId : viewConfiguration.settings?.datePropertyId));

  function applySavedView(view: DatabaseView | null): void {
    if (selected === null) return;
    mutationGeneration.current += 1;
    const configuration = view ?? defaultView(selected);
    setSavedPresentation(view);
    setSortField(configuration.sort.propertyId); setSortDirection(configuration.sort.direction);
    setSorts(configuration.sorts ?? [configuration.sort]);
    setFilters(configuration.filters);
    setHiddenPropertyIds(new Set(selected.properties.filter((property) => !configuration.visiblePropertyIds.includes(property.id)).map((property) => property.id)));
    setEditing(null); setAddOpen(false); setCandidateId(null); setCandidatePropertyId(null); setConfirmedAdd(false);
    setSaving(false); setActionError(null); setActionNotice(null); setActionIssues([]); setStale(false); setNewDatedEntry(null);
  }

  function addTableFilter(): void {
    const property = selected?.properties[0];
    if (property === undefined) return;
    const id = crypto.randomUUID();
    setFilters((previous) => [...previous, {
      id,
      propertyId: property.id,
      operator: filterOperators(property)[0] ?? 'equals',
      value: initialFilterValue(property),
    }]);
    setFocusedFilterId(id);
  }

  function updateTableFilter(id: string, update: Partial<DatabaseFilter>): void {
    setFilters((previous) => previous.map((filter) => {
      if (filter.id !== id) return filter;
      const next = { ...filter, ...update };
      if (next.operator === 'is-empty' || next.operator === 'is-not-empty') delete next.value;
      else if (update.operator === 'is-empty' || update.operator === 'is-not-empty') {
        const property = selected?.properties.find((item) => item.id === next.propertyId);
        if (property) next.value = initialFilterValue(property);
      }
      return next;
    }));
  }

  function updateSort(index: number, update: Partial<{ propertyId: DatabaseSortField; direction: DatabaseSortDirection }>): void {
    setSorts((previous) => previous.map((sort, sortIndex) => sortIndex === index ? { ...sort, ...update } : sort));
  }

  function moveSort(index: number, delta: number): void {
    setSorts((previous) => {
      const target = index + delta;
      if (target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function changeFilterProperty(id: string, propertyId: string): void {
    const property = selected?.properties.find((item) => item.id === propertyId);
    if (property === undefined) return;
    updateTableFilter(id, {
      propertyId,
      operator: filterOperators(property)[0] ?? 'equals',
      value: initialFilterValue(property),
    });
  }

  function toggleVisibleProperty(propertyId: string, checked: boolean): void {
    setHiddenPropertyIds((previous) => {
      const next = new Set(previous);
      if (checked) next.delete(propertyId);
      else next.add(propertyId);
      return next;
    });
  }

  function dismissSchemaEditor(): void {
    setSchemaDraft(null);
    setSchemaError(null);
    setSchemaNotice(null);
    setSchemaStale(false);
    const trigger = schemaTriggerRef.current;
    schemaTriggerRef.current = null;
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
    });
  }

  function closeSchemaEditor(): void {
    if (schemaSaving) return;
    dismissSchemaEditor();
  }

  function openSchemaEditor(create: boolean): void {
    schemaTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSchemaCreating(create);
    setSchemaDraft(create
      ? { id: crypto.randomUUID(), name: '', properties: [] }
      : selected === null ? null : {
          id: selected.id,
          name: selected.name,
          properties: selected.properties.map((property) => ({
            ...property,
            ...(property.options === undefined ? {} : { options: property.options.map((option) => ({ ...option })) }),
          })),
        });
    setSchemaError(null);
    setSchemaNotice(null);
    setSchemaStale(false);
    setNewPropertyIds(new Set());
  }

  function updateSchemaProperty(index: number, update: Partial<Property>): void {
    setSchemaDraft((previous) => previous === null ? null : {
      ...previous,
      properties: previous.properties.map((property, propertyIndex) => propertyIndex === index
        ? { ...property, ...update }
        : property),
    });
  }

  function addSchemaProperty(): void {
    const id = crypto.randomUUID();
    setSchemaDraft((previous) => previous === null ? null : ({
      ...previous,
      properties: [...previous.properties, { id, name: '', type: 'text' }],
    }));
    setNewPropertyIds((previous) => new Set(previous).add(id));
  }

  function changeSchemaPropertyType(index: number, type: PropertyType): void {
    const current = schemaDraft?.properties[index];
    if (current === undefined) return;
    const hasOptions = type === 'select' || type === 'multi-select';
    updateSchemaProperty(index, {
      type,
      relation: type === 'relation' ? { databaseId: databases[0]?.id ?? schemaDraft!.id, cardinality: 'many' } : undefined,
      rollup: type === 'rollup' ? { relationPropertyId: schemaDraft!.properties.find((item) => item.type === 'relation')?.id ?? '', operation: 'count' } : undefined,
      ...(hasOptions ? { options: current.options ?? [] } : { options: undefined }),
    });
  }

  function addSchemaOption(index: number): void {
    const property = schemaDraft?.properties[index];
    if (property === undefined) return;
    updateSchemaProperty(index, {
      options: [...(property.options ?? []), { id: crypto.randomUUID(), name: '' }],
    });
  }

  function updateSchemaOption(propertyIndex: number, optionIndex: number, name: string): void {
    const property = schemaDraft?.properties[propertyIndex];
    if (property?.options === undefined) return;
    updateSchemaProperty(propertyIndex, {
      options: property.options.map((option, index) => index === optionIndex ? { ...option, name } : option),
    });
  }

  async function saveSchema(): Promise<void> {
    if (schemaDraft === null || schemaSaving) return;
    const generation = schemaGeneration.current;
    const isCurrentSelection = () => schemaGeneration.current === generation;
    const creating = schemaCreating;
    const targetId = schemaDraft.id;
    const targetHash = selected?.id === targetId ? selected.contentHash : '';
    const name = schemaDraft.name;
    if (name.trim() === '' || name.trim() !== name) {
      setSchemaError('Database name must be non-empty and have no leading or trailing spaces.');
      return;
    }
    const propertyNames = schemaDraft.properties.map((property) => property.name.normalize('NFC').toLowerCase());
    if (schemaDraft.properties.some((property) => property.name.trim() === '' || property.name.trim() !== property.name)) {
      setSchemaError('Each property needs a non-empty name without leading or trailing spaces.');
      return;
    }
    if (new Set(propertyNames).size !== propertyNames.length) {
      setSchemaError('Property names must be unique, ignoring case.');
      return;
    }
    for (const property of schemaDraft.properties) {
      const options = property.options ?? [];
      if (options.some((option) => option.name.trim() === '' || option.name.trim() !== option.name)) {
        setSchemaError(`Each option in “${property.name}” needs a non-empty name without leading or trailing spaces.`);
        return;
      }
      const optionNames = options.map((option) => option.name.normalize('NFC'));
      if (new Set(optionNames).size !== optionNames.length) {
        setSchemaError(`Option names in “${property.name}” must be unique.`);
        return;
      }
    }
    setSchemaSaving(true);
    setSchemaError(null);
    setSchemaNotice(null);
    try {
      const result = creating
        ? await api.createDatabase(schemaDraft)
        : await api.replaceDatabase(targetId, schemaDraft, targetHash);
      onDatabaseSaved(result.database, creating, creating && isCurrentSelection());
      if (isCurrentSelection()) {
        if (!creating) setReloadVersion((value) => value + 1);
        dismissSchemaEditor();
        setSchemaNotice(creating ? 'Database created.' : 'Database schema saved. Existing note values were not changed.');
        setSchemaNoticeDatabaseId(result.database.id);
      }
    } catch (cause) {
      if (isCurrentSelection()) {
        setSchemaError(cause instanceof Error ? cause.message : 'The database schema was not saved.');
        if (cause instanceof ApiError && cause.code === 'STALE_WRITE') {
          setSchemaStale(true);
          onRetry();
        }
      }
    } finally {
      if (isCurrentSelection()) setSchemaSaving(false);
    }
  }

  function beginEditing(noteId: string, property: Property, value: unknown): void {
    const row = currentRowData?.rows.find((item) => item.noteId === noteId);
    if (isDerivedProperty(property)) return;
    if (row === undefined) return;
    setActionError(null);
    setActionNotice(null);
    setActionIssues([]);
    setStale(false);
    setEditing({ noteId, propertyId: property.id, draft: valueForInput(property, value), source: 'row', baseHash: row.contentHash });
  }

  function renderRelatedValue(row: UiDatabaseRow, property: Property) {
    return <div className="flex flex-col gap-1"><RelationValue references={row.relations?.[property.id]} onOpen={openLayoutNote} />
      {!isDerivedProperty(property) ? <Button size="xs" variant="outline" disabled={saving || editing !== null || hasBlockingRowIssues(row, property)} aria-label={`Edit ${property.name} for ${row.title}`} onClick={() => beginEditing(row.noteId, property, row.values[property.id])}>Edit relations</Button> : <span className="text-xs text-muted-foreground">Reverse · read-only</span>}
    </div>;
  }

  function openLayoutNote(id: string): void {
    if (editing !== null) { setActionError('Save or cancel your property edit before opening a note.'); return; }
    onOpenNote(id);
  }

  function restoreCardFocus(noteId: string): void {
    if (viewConfiguration.type === 'table') return;
    const generation = mutationGeneration.current;
    window.requestAnimationFrame(() => {
      if (!mounted.current || mutationGeneration.current !== generation) return;
      const target = document.querySelector<HTMLElement>(`[data-note-open="${noteId}"]`);
      (target ?? document.getElementById(`saved-view-${selected?.id}`))?.focus();
    });
  }

  function beginAdd(noteId: string): void {
    setCandidateId(noteId);
    const property = selected?.properties.find((item) => !isDerivedProperty(item)) ?? null;
    setCandidatePropertyId(property?.id ?? null);
    setEditing(property === null ? null : {
      noteId,
      propertyId: property.id,
      draft: initialValue(property),
      source: 'add',
    });
    setConfirmedAdd(false);
    setActionError(null);
    setActionNotice(null);
    setActionIssues([]);
  }

  function changeCandidateProperty(propertyId: string): void {
    setCandidatePropertyId(propertyId);
    const property = selected?.properties.find((item) => item.id === propertyId);
    if (property !== undefined && candidateId !== null) {
      setEditing({ noteId: candidateId, propertyId, draft: initialValue(property), source: 'add' });
    }
  }

  async function submitMembership(): Promise<void> {
    if (!selected || !candidate || !confirmedAdd || saving || !currentRowData) return;
    const generation = mutationGeneration.current;
    const databaseId = selected.id;
    setSaving(true); setActionError(null); setActionNotice(null);
    try {
      const original = await api.noteProperties(candidate.id);
      if (!mounted.current || generation !== mutationGeneration.current) return;
      await api.addDatabaseNote(databaseId, candidate.id, original.contentHash);
      const rows = await api.databaseRows(databaseId, selected.contentHash);
      if (!mounted.current || generation !== mutationGeneration.current) return;
      setRowData(rows); setCandidateId(null); setAddOpen(false); setConfirmedAdd(false);
      setActionNotice('Note added to the database. Derived values were not stored.');
    } catch (cause) { if (mounted.current && generation === mutationGeneration.current) setActionError(cause instanceof Error ? cause.message : 'Could not add membership. Refresh before retrying.'); }
    finally { if (mounted.current && generation === mutationGeneration.current) setSaving(false); }
  }

  async function submitEdit(): Promise<void> {
    if (editing === null || selected === null || saving || viewsLoading || currentRowData === null) return;
    const generation = mutationGeneration.current;
    const isCurrentView = () => mutationGeneration.current === generation;
    const databaseId = selected.id;
    const property = selected.properties.find((item) => item.id === editing.propertyId);
    if (property === undefined) return;
    const row = currentRowData.rows.find((item) => item.noteId === editing.noteId);
    let baseHash = editing.source === 'row' ? editing.baseHash : undefined;
    if (editing.source === 'row' && (row === undefined || baseHash === undefined || row.contentHash !== baseHash)) {
      setActionError('The row changed since editing began. Reload the database and review your draft before saving.');
      setStale(true);
      return;
    }
    if (editing.source === 'add' && (row !== undefined || candidateId !== editing.noteId)) return;
    if (editing.source === 'add' && !confirmedAdd) {
      setActionError('Confirm adding this note to the database before saving.');
      return;
    }
    try {
      const value = editing.remove ? undefined : toApiValue(property, editing.draft);
      setSaving(true);
      setActionError(null);
      setActionNotice(null);
      setActionIssues([]);
      setStale(false);
      if (editing.source === 'add') {
        baseHash = (await api.noteProperties(editing.noteId)).contentHash;
        if (!isCurrentView() || currentRowData.databaseId !== databaseId || currentRowData.schemaHash !== selected.contentHash) return;
      }
      const saved = await api.setNoteProperty(editing.noteId, {
        databaseId,
        propertyId: property.id,
        ...(editing.remove ? { remove: true as const } : { value }),
        baseHash: baseHash ?? '',
        ...(editing.source === 'add' ? { confirmCreate: true } : {}),
      });
      if (!isCurrentView()) return;
      const updatedProjection = saved.rows.find((item) => item.databaseId === databaseId);
      const currentRow = currentRowData.rows.find((item) => item.noteId === editing.noteId);
      const summary = notes.find((item) => item.id === editing.noteId);
      if (updatedProjection !== undefined) {
        const updatedRow = {
          ...updatedProjection,
          title: currentRow?.title ?? summary?.title ?? 'Untitled note',
          updatedAt: currentRow?.updatedAt ?? summary?.updatedAt ?? '',
          contentHash: saved.contentHash,
          issues: saved.issues,
        };
        setRowData((previous) => previous === null || previous.databaseId !== databaseId || previous.schemaHash !== currentRowData.schemaHash
          ? previous
          : {
              ...previous,
              rows: previous.rows.some((item) => item.noteId === updatedRow.noteId)
                ? previous.rows.map((item) => item.noteId === updatedRow.noteId ? updatedRow : item)
                : [...previous.rows, updatedRow],
              diagnostics: [
                ...previous.diagnostics.filter((issue) => issue.noteId !== editing.noteId),
                ...saved.issues,
              ],
            });
      }
      setEditing(null);
      setAddOpen(false);
      setCandidateId(null);
      setConfirmedAdd(false);
      setActionNotice('Property saved.');
      if (selected.properties.some((item) => item.type === 'relation' || item.type === 'rollup')) {
        try {
          const refreshed = await api.databaseRows(databaseId, selected.contentHash);
          if (isCurrentView()) setRowData(refreshed);
        } catch (cause) {
          if (isCurrentView()) setRowsError(`Property saved, but derived values could not be refreshed: ${cause instanceof Error ? cause.message : 'Refresh the database.'}`);
        }
      }
      restoreCardFocus(editing.noteId);
    } catch (cause) {
      if (isCurrentView()) {
        setActionError(cause instanceof Error ? cause.message : 'The property was not saved.');
        setActionNotice(null);
        if (cause instanceof ApiError) {
          setActionIssues(cause.structuredDataIssues?.map((issue) => issueSummary(issue)) ?? []);
          if (cause.code === 'STALE_WRITE') setStale(true);
        }
      }
    } finally {
      if (isCurrentView()) setSaving(false);
    }
  }

  async function reloadLatestKeepDraft(): Promise<void> {
    if (selected === null) return;
    const generation = mutationGeneration.current;
    const isCurrentView = () => mutationGeneration.current === generation;
    setRowsLoading(true);
    setRowsError(null);
    try {
      const latest = await api.databaseRows(selected.id, selected.contentHash);
      if (!isCurrentView()) return;
      setRowData(latest);
      setEditing((previous) => {
        if (previous === null) return null;
        const latestRow = latest.rows.find((row) => row.noteId === previous.noteId);
        return latestRow === undefined ? previous : { ...previous, baseHash: latestRow.contentHash };
      });
      setStale(false);
      setActionError('Latest stored values loaded. Your draft is still here; review it and save again.');
      setActionNotice(null);
      setActionIssues([]);
    } catch (cause) {
      if (isCurrentView()) {
        setRowsError(cause instanceof Error ? cause.message : 'Could not reload the latest values.');
      }
    } finally {
      if (isCurrentView()) setRowsLoading(false);
    }
  }

  async function createDatedNote(): Promise<void> {
    if (selected === null || newDatedEntry === null || layoutProperty?.type !== 'date' || currentRowData === null || saving || viewIssues.length) return;
    const generation = mutationGeneration.current;
    const isCurrent = () => mutationGeneration.current === generation;
    const draft = { ...newDatedEntry };
    if (!isDateOnly(draft.date)) { setActionError('Choose a valid calendar date before creating the note.'); return; }
    setSaving(true); setActionError(null); setActionNotice(null);
    try {
      if (!draft.noteId) {
        const result = await api.createNote({ title: draft.title.trim() || 'Untitled note' });
        draft.noteId = result.note.id; draft.baseHash = result.note.contentHash;
        if (!mounted.current) return;
        onNoteCreated?.(result.note);
        if (isCurrent()) setNewDatedEntry(draft);
      }
      const result = await api.setNoteProperty(draft.noteId, {
        databaseId: selected.id, propertyId: layoutProperty.id, value: draft.date,
        baseHash: draft.baseHash ?? '', confirmCreate: true,
      });
      if (!isCurrent()) return;
      const projected = result.rows.find((row) => row.databaseId === selected.id);
      if (projected) setRowData((previous) => previous?.databaseId === selected.id && previous.schemaHash === currentRowData.schemaHash ? {
        ...previous, rows: [...previous.rows.filter((row) => row.noteId !== draft.noteId), { ...projected, title: draft.title.trim() || 'Untitled note', updatedAt: '', contentHash: result.contentHash, issues: result.issues }],
      } : previous);
      setNewDatedEntry(null); setActionNotice('Dated note created.');
    } catch (cause) {
      if (isCurrent()) {
        setActionError(`${cause instanceof Error ? cause.message : 'Could not create the dated entry.'}${draft.noteId ? ' The note was created and kept. Open it to inspect its content; no duplicate note will be created by retrying.' : ''}`);
        if (cause instanceof ApiError && cause.code === 'STALE_WRITE') setStale(true);
      }
    } finally { if (isCurrent()) setSaving(false); }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Databases" aria-busy={loading || rowsLoading || saving || schemaSaving || undefined}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-start gap-2">
          <SidebarToggle collapsed={sidebarCollapsed} onToggle={onToggleSidebar} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">Databases</h1>
              <Badge variant="outline" className="text-[10px]">Local Markdown data</Badge>
            </div>
            <p className="mt-1 max-w-[68ch] text-xs leading-relaxed text-muted-foreground">
              Properties stay in each note’s <code>nodus_data</code> frontmatter. Schema-valid values appear below.
            </p>
          </div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => openSchemaEditor(true)} disabled={schemaSaving}>
          <Plus data-icon="inline-start" /> New database
        </Button>
      </header>

      {error ? <ErrorNotice message={error} onRetry={onRetry} /> : null}

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-4 py-5 sm:px-6">
          {loading ? (
            <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
              <Skeleton className="h-52 rounded-lg" />
              <Skeleton className="h-80 rounded-lg" />
            </div>
          ) : databases.length === 0 ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
              <div className="mb-4 grid size-10 place-items-center rounded-md bg-muted/60 text-muted-foreground"><Database className="size-5" /></div>
              <h2 className="text-sm font-semibold">No database definitions</h2>
              <p className="mt-1 max-w-[48ch] text-xs leading-relaxed text-muted-foreground">
                Database schemas are portable JSON files under <code>databases/</code>. This vault has none yet.
              </p>
              <Button type="button" size="sm" className="mt-4" onClick={() => openSchemaEditor(true)} disabled={schemaSaving}>
                <Plus data-icon="inline-start" /> New database
              </Button>
            </div>
          ) : selected === null ? null : (
            <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)] xl:items-start">
              <aside className="overflow-hidden" aria-label="Database definitions">
                <div className="border-b px-2 py-2 text-[11px] font-medium text-muted-foreground">
                  {databases.length} {databases.length === 1 ? 'definition' : 'definitions'}
                </div>
                <div className="flex gap-1 overflow-x-auto py-1 xl:block xl:space-y-0.5 xl:overflow-visible">
                  {databases.map((database) => (
                    <DatabaseSelectorItem
                      key={database.id}
                      database={database}
                      selected={database.id === selected.id}
                      disabled={schemaSaving}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              </aside>

              <article className="min-w-0 overflow-hidden" aria-labelledby="database-title">
                <header className="flex flex-wrap items-start justify-between gap-3 border-b px-1 py-4">
                  <div className="min-w-0">
                    <div className="mb-1 truncate font-mono text-[10px] text-muted-foreground">{selected.path}</div>
                    <h2 id="database-title" className="truncate text-lg font-semibold tracking-tight" title={selected.name}>{selected.name}</h2>
                    <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
                      {rowsLoading && currentRowData === null
                        ? 'Loading rows…'
                        : `${displayRows.length} ${displayRows.length === 1 ? 'row' : 'rows'} shown · ${currentRowData?.rows.length ?? 0} ${currentRowData?.rows.length === 1 ? 'note' : 'notes'} in this database`}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={() => openSchemaEditor(false)} disabled={schemaSaving}>
                      Edit schema
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setReloadVersion((value) => value + 1)} disabled={rowsLoading || saving} title="Reload rows from disk">
                      <RefreshCw data-icon="inline-start" /> Refresh
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      aria-expanded={addOpen}
                      aria-controls="database-add-note"
                      title={notes.length === 0 ? 'Create a note first' : undefined}
                      onClick={() => { setAddOpen((open) => !open); setActionError(null); }}
                      disabled={notes.length === 0 || viewsLoading}
                    >
                      <Plus data-icon="inline-start" /> Add note
                    </Button>
                  </div>
                </header>

                <SavedViewControls key={`${vaultKey}:${selected.id}`} database={selected} vaultKey={vaultKey} configuration={viewConfiguration} onApply={applySavedView} onReady={() => setViewsLoading(false)} busy={saving || schemaSaving || newDatedEntry !== null} hasNoteDraft={editing !== null || candidateId !== null} />
                {viewConfiguration.type !== 'table' ? <div className="my-3 flex flex-wrap items-center gap-2 text-xs">
                  <span>{viewConfiguration.type === 'kanban' ? 'Group by Select property' : 'Calendar Date property'}</span>
                  <Select
                    value={layoutProperty?.id}
                    disabled={saving || editing !== null}
                    onValueChange={(id) => {
                      setSavedPresentation((previous) => previous === null ? previous : { ...previous, settings: viewConfiguration.type === 'kanban' ? { groupPropertyId: id } : { datePropertyId: id } });
                      setEditing(null);
                    }}
                  >
                    <SelectTrigger className="h-7 w-44" aria-label={viewConfiguration.type === 'kanban' ? 'Kanban grouping property' : 'Calendar date property'}>
                      <SelectValue placeholder="Choose a property" />
                    </SelectTrigger>
                    <SelectContent>
                      {selected.properties.filter((property) => property.type === (viewConfiguration.type === 'kanban' ? 'select' : 'date')).map((property) => (
                        <SelectItem key={property.id} value={property.id}>{property.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div> : null}
                {viewIssues.length ? <div role="alert" className="my-3 text-xs text-destructive"><p>This view has stale references. Its saved file is preserved. Repair the settings or explicitly reset them before using the view.</p><ul>{viewIssues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul></div> : null}

                {currentDiagnostics.length > 0 ? (
                  <Collapsible className="group/collapsible mx-1 mt-3 rounded-md border border-amber-700/20 bg-amber-500/5 px-3 py-2 text-xs text-foreground">
                    <CollapsibleTrigger asChild>
                      <Button type="button" variant="ghost" size="sm" className="h-auto w-full justify-between gap-2 whitespace-normal px-0 py-0 text-left font-medium hover:bg-transparent">
                        <span>
                          {currentDiagnostics.length} structured-data {currentDiagnostics.length === 1 ? 'diagnostic' : 'diagnostics'}; source values are preserved. Invalid stored values can block editing; missing relation targets can be removed.
                        </span>
                        <ChevronDown className="size-3.5 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-180" aria-hidden="true" />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <ul className="mt-2 flex flex-col gap-1.5 text-muted-foreground">
                        {currentDiagnostics.map((issue, index) => (
                          <li key={`${issue.noteId}-${issue.code}-${index}`} className="flex flex-wrap items-start gap-2">
                            <span className="min-w-0 flex-1">{issueSummary(issue)}</span>
                            <Button type="button" variant="link" size="xs" className="h-auto p-0" aria-label={`Open note ${issue.path}`} onClick={() => onOpenNote(issue.noteId)}>
                              Open note
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </CollapsibleContent>
                  </Collapsible>
                ) : null}

                {addOpen ? (
                  <section id="database-add-note" className="mx-1 mt-4 rounded-md border bg-card p-3" aria-label="Add note to database">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-medium">Add a note to {selected.name}</h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">Choose a note and its first property. This writes structured metadata into that note’s Markdown file.</p>
                      </div>
                      <Button type="button" size="sm" variant="ghost" onClick={() => { setAddOpen(false); setEditing(null); setCandidateId(null); setConfirmedAdd(false); }}>Cancel</Button>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="flex min-w-0 flex-col gap-1">
                        <label className="flex flex-col gap-1 text-xs font-medium">
                          Find a note
                          <Input value={addQuery} aria-label="Find a note to add" placeholder="Search titles and paths" autoFocus onChange={(event) => setAddQuery(event.currentTarget.value)} />
                        </label>
                        {candidates.length === 0 ? (
                          <p className="px-2 py-2 text-xs text-muted-foreground">
                            {notes.length === memberIds.size ? 'Every note is already in this database.' : 'No available notes match.'}
                          </p>
                        ) : (
                          <>
                            <ul className="max-h-52 overflow-y-auto rounded-md border p-1" aria-label="Notes not in this database">
                              {candidates.map((item) => (
                                <li key={item.id}>
                                  <Button type="button" variant="ghost" aria-pressed={candidateId === item.id} className={cn('h-auto w-full flex-col items-start px-2 py-1.5 text-left', candidateId === item.id && 'bg-muted')} onClick={() => beginAdd(item.id)}>
                                    <span className="max-w-full truncate text-xs font-medium">{item.title}</span>
                                    <span className="max-w-full truncate font-mono text-[10px] text-muted-foreground">{item.path}</span>
                                  </Button>
                                </li>
                              ))}
                            </ul>
                            <p className="text-[11px] text-muted-foreground" role="status">
                              {matchingCandidates.length > candidates.length
                                ? `Showing the first ${candidates.length} of ${matchingCandidates.length} matching notes. Refine the search.`
                                : `${candidates.length} ${candidates.length === 1 ? 'note' : 'notes'} available.`}
                            </p>
                          </>
                        )}
                      </div>
                      {candidate ? (
                        <div className="flex min-w-0 flex-col gap-3">
                          <div className="min-w-0 text-xs"><span className="text-muted-foreground">Selected note</span><p className="truncate font-medium">{candidate.title}</p></div>
                          {selected.properties.some((item) => !isDerivedProperty(item)) ? <PropertyChooser
                            properties={selected.properties.filter((item) => !isDerivedProperty(item))}
                            value={candidatePropertyId}
                            onChange={changeCandidateProperty}
                          /> : <p className="text-xs text-muted-foreground">This adds membership only; reverse and rollup values remain computed.</p>}
                          {candidateProperty && editing?.source === 'add' ? (
                            <div className="flex flex-col gap-1 text-xs font-medium">
                              {candidateProperty.name}
                              <PropertyControl relationOptions={currentRowData?.relationCandidates?.[candidateProperty.relation?.databaseId ?? '']} property={candidateProperty} value={editing.draft} label={`${candidateProperty.name} value for ${candidate.title}`} onChange={(draft) => setEditing({ ...editing, draft })} />
                            </div>
                          ) : null}
                          <Button type="button" variant={confirmedAdd ? 'secondary' : 'outline'} size="sm" aria-pressed={confirmedAdd} onClick={() => setConfirmedAdd((value) => !value)}>
                            {confirmedAdd ? <Check data-icon="inline-start" /> : null}
                            {confirmedAdd ? 'Adding this note is confirmed' : `Confirm add to ${selected.name}`}
                          </Button>
                          <Button type="button" size="sm" disabled={!confirmedAdd || saving || rowsLoading} onClick={() => void (candidateProperty ? submitEdit() : submitMembership())}>
                            {saving ? 'Adding…' : candidateProperty ? 'Add note and save property' : 'Add note to database'}
                          </Button>
                        </div>
                      ) : <p className="self-center text-xs text-muted-foreground">Choose a note to add.</p>}
                    </div>
                  </section>
                ) : null}

                {actionError ? (
                  <div className="mx-1 mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs" role="alert">
                    <p className="font-medium text-destructive">{actionError}</p>
                    {actionIssues.length > 0 ? <ul className="mt-1 flex flex-col gap-1 text-muted-foreground">{actionIssues.map((issue, index) => <li key={`${index}-${issue}`}>{issue}</li>)}</ul> : null}
                    {stale ? <Button type="button" size="xs" variant="outline" className="mt-2" disabled={rowsLoading} onClick={() => void reloadLatestKeepDraft()}>Reload latest note, keep draft</Button> : null}
                  </div>
                ) : null}
                {actionNotice ? <p className="mx-1 mt-3 text-xs text-muted-foreground" role="status">{actionNotice}</p> : null}

                {selected.properties.length === 0 ? (
                  <div className="mx-1 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-3 text-xs text-muted-foreground">
                    <span>This schema has no properties yet. Existing membership is still shown, but notes cannot be added or edited.</span>
                    <Button type="button" size="sm" variant="outline" onClick={() => openSchemaEditor(false)} disabled={schemaSaving}>
                      Add a property
                    </Button>
                  </div>
                ) : null}

                {currentRowData !== null && selected.properties.length > 0 ? (
                  <section className="mx-1 mt-4 flex flex-col gap-2 rounded-md border bg-card p-3" aria-label="Database table controls" inert={viewsLoading}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <div className="flex items-center gap-1.5" role="group" aria-label="Sort rows">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" size="sm" variant="outline" aria-label={`Sort rows by ${(sorts[0]?.propertyId ?? 'title') === 'title' ? 'note title' : selected.properties.find((property) => property.id === sorts[0]?.propertyId)?.name ?? 'note title'}`}>
                              Sort: {(sorts[0]?.propertyId ?? 'title') === 'title' ? 'Note title' : selected.properties.find((property) => property.id === sorts[0]?.propertyId)?.name ?? 'Note title'}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="min-w-48">
                            <DropdownMenuRadioGroup value={sorts[0]?.propertyId ?? 'title'} onValueChange={(value) => updateSort(0, { propertyId: value })}>
                              <DropdownMenuRadioItem value="title">Note title</DropdownMenuRadioItem>
                              {selected.properties.map((property) => (
                                <DropdownMenuRadioItem key={property.id} value={property.id}>
                                  {property.name}
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="outline"
                          aria-label={(sorts[0]?.direction ?? 'asc') === 'asc' ? 'Sort descending' : 'Sort ascending'}
                          title={(sorts[0]?.direction ?? 'asc') === 'asc' ? 'Ascending' : 'Descending'}
                          onClick={() => updateSort(0, { direction: (sorts[0]?.direction ?? 'asc') === 'asc' ? 'desc' : 'asc' })}
                        >
                          {(sorts[0]?.direction ?? 'asc') === 'asc' ? <ArrowUpAZ /> : <ArrowDownAZ />}
                        </Button>
                      </div>

                      {sorts.slice(1).map((sort, offset) => {
                        const index = offset + 1;
                        return <div key={index} className="flex items-center gap-1" role="group" aria-label={`Sort priority ${index + 1}`}>
                          <Select value={sort.propertyId} onValueChange={(propertyId) => updateSort(index, { propertyId })}>
                            <SelectTrigger className="h-8 w-36" aria-label={`Sort ${index + 1} property`}><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="title">Note title</SelectItem>{selected.properties.map((property) => <SelectItem key={property.id} value={property.id}>{property.name}</SelectItem>)}</SelectContent>
                          </Select>
                          <Button type="button" size="icon-sm" variant="outline" aria-label={`Sort ${index + 1} ${(sort.direction === 'asc' ? 'ascending' : 'descending')}; toggle direction`} onClick={() => updateSort(index, { direction: sort.direction === 'asc' ? 'desc' : 'asc' })}>{sort.direction === 'asc' ? <ArrowUpAZ /> : <ArrowDownAZ />}</Button>
                          <Button type="button" size="icon-sm" variant="ghost" aria-label={`Move sort ${index + 1} up`} disabled={index === 1} onClick={() => moveSort(index, -1)}>↑</Button>
                          <Button type="button" size="icon-sm" variant="ghost" aria-label={`Move sort ${index + 1} down`} disabled={index === sorts.length - 1} onClick={() => moveSort(index, 1)}>↓</Button>
                          <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove sort ${index + 1}`} onClick={() => setSorts((previous) => previous.filter((_, sortIndex) => sortIndex !== index))}><X /></Button>
                        </div>;
                      })}
                      <Button type="button" size="sm" variant="ghost" disabled={sorts.length >= selected.properties.length + 1} onClick={() => {
                        const available = ['title', ...selected.properties.map((property) => property.id)].find((id) => !sorts.some((sort) => sort.propertyId === id));
                        if (available) setSorts((previous) => [...previous, { propertyId: available, direction: 'asc' }]);
                      }}>Add sort</Button>

                      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />

                      <Popover onOpenChange={(open) => { if (!open) setFocusedFilterId(null); }}>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            aria-label={appliedFilterCount > 0 ? `Filter rows, ${appliedFilterCount} active` : 'Filter rows'}
                          >
                            <ListFilter data-icon="inline-start" /> Filter
                            {appliedFilterCount > 0 ? <span className="text-muted-foreground">({appliedFilterCount})</span> : null}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" aria-label="Filters" className="w-[min(calc(100vw-2rem),40rem)] p-0">
                          <div className="flex items-start justify-between gap-3 border-b px-3 py-2.5">
                            <div className="min-w-0">
                              <h3 className="text-xs font-semibold">Filters</h3>
                              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                                All filters must match. Incomplete filters stay inactive until their value is valid.
                              </p>
                            </div>
                            {filters.length > 0 ? (
                              <Button type="button" size="xs" variant="ghost" onClick={() => setFilters([])}>
                                Clear all
                              </Button>
                            ) : null}
                          </div>
                          <div className="max-h-[min(55vh,26rem)] overflow-y-auto p-3">
                            {filters.length === 0 ? (
                              <div className="flex flex-col items-center gap-1 px-4 py-6 text-center">
                                <ListFilter className="size-4 text-muted-foreground" aria-hidden="true" />
                                <p className="text-xs font-medium">No filters</p>
                                <p className="max-w-[36ch] text-[11px] leading-relaxed text-muted-foreground">
                                  Add a typed filter to narrow this table without changing the stored notes.
                                </p>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-2">
                                {filters.map((filter, index) => {
                                  const property = selected.properties.find((item) => item.id === filter.propertyId);
                                  if (property === undefined) return null;
                                  const invalid = !isValidFilter(property, filter.operator, filter.value);
                                  return (
                                    <div key={filter.id} className="flex flex-col gap-2 rounded-md border bg-background/60 p-2 sm:flex-row sm:items-start">
                                      <Select value={property.id} onValueChange={(value) => changeFilterProperty(filter.id, value)}>
                                        <SelectTrigger className="w-full sm:w-36" aria-label={`Filter ${index + 1} property`} autoFocus={filter.id === focusedFilterId}>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {selected.properties.map((item) => (
                                            <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                      <Select value={filter.operator} onValueChange={(value) => updateTableFilter(filter.id, { operator: value as DatabaseFilterOperator })}>
                                        <SelectTrigger className="w-full sm:w-32" aria-label={`Filter ${index + 1} operator`}>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {filterOperators(property).map((operator) => (
                                            <SelectItem key={operator} value={operator}>{filterOperatorLabel(operator)}</SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                                        {filter.operator !== 'is-empty' && filter.operator !== 'is-not-empty' ? <FilterValueControl
                                          relationOptions={currentRowData?.relationCandidates?.[property.relation?.databaseId ?? '']}
                                          property={property}
                                          value={filter.value}
                                          label={`Filter ${index + 1} value`}
                                          invalid={invalid}
                                          describedBy={invalid ? `filter-${filter.id}-hint` : undefined}
                                          className="w-full"
                                          onChange={(value) => updateTableFilter(filter.id, { value })}
                                        /> : null}
                                        {invalid ? (
                                          <p id={`filter-${filter.id}-hint`} className="text-[11px] text-muted-foreground">
                                            Not applied until this value is valid.
                                          </p>
                                        ) : null}
                                      </div>
                                      <Button
                                        type="button"
                                        size="icon-sm"
                                        variant="ghost"
                                        className="shrink-0 self-start"
                                        aria-label={`Remove filter ${index + 1}`}
                                        onClick={() => setFilters((previous) => previous.filter((item) => item.id !== filter.id))}
                                      >
                                        <X />
                                      </Button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
                            <Button type="button" size="sm" variant="outline" onClick={addTableFilter}>
                              <Plus data-icon="inline-start" /> Add filter
                            </Button>
                            <p className="text-[11px] text-muted-foreground">Use Save view to persist these filters.</p>
                          </div>
                        </PopoverContent>
                      </Popover>

                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            aria-label={`Columns, ${visibleProperties.length} of ${selected.properties.length} shown`}
                          >
                            <Columns3 data-icon="inline-start" /> Columns
                            <span className="text-muted-foreground">{visibleProperties.length}/{selected.properties.length}</span>
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" aria-label="Columns" className="w-64 p-0">
                          <div className="flex items-start justify-between gap-3 border-b px-3 py-2.5">
                            <div>
                              <h3 className="text-xs font-semibold">Columns</h3>
                              <p className="mt-0.5 text-[11px] text-muted-foreground">Note title always stays visible.</p>
                            </div>
                            <Button
                              type="button"
                              size="xs"
                              variant="ghost"
                              disabled={hiddenPropertyCount === 0}
                              onClick={() => setHiddenPropertyIds(new Set())}
                            >
                              Show all
                            </Button>
                          </div>
                          <div className="max-h-72 overflow-y-auto p-1" role="group" aria-label="Visible columns">
                            {selected.properties.map((property) => {
                              const checkboxId = `column-${property.id}`;
                              return (
                                <div key={property.id} className="flex h-8 items-center gap-2 rounded-md px-2 text-xs hover:bg-muted">
                                  <Checkbox
                                    id={checkboxId}
                                    checked={!hiddenPropertyIds.has(property.id)}
                                    onCheckedChange={(checked) => toggleVisibleProperty(property.id, checked === true)}
                                  />
                                  <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer truncate">{property.name}</label>
                                  <span className="shrink-0 text-[10px] text-muted-foreground">{propertyTypeLabel(property.type)}</span>
                                </div>
                              );
                            })}
                          </div>
                          {hiddenPropertyCount > 0 ? (
                            <p className="border-t px-3 py-2 text-[11px] text-muted-foreground" role="status">
                              {hiddenPropertyCount} of {selected.properties.length} hidden.
                            </p>
                          ) : null}
                        </PopoverContent>
                      </Popover>

                      {filters.length > 0 ? (
                        <Button type="button" size="xs" variant="ghost" className="ml-auto" onClick={() => setFilters([])}>
                          Clear filters
                        </Button>
                      ) : null}
                      <span className="text-[11px] text-muted-foreground" aria-live="polite">
                        {displayRows.length} of {currentRowData.rows.length} rows
                      </span>
                    </div>
                  </section>
                ) : null}

                {viewConfiguration.type !== 'table' && editing?.source === 'row' ? <section ref={cardEditorRef} tabIndex={-1} aria-label="Edit card property" className="my-3 flex flex-col gap-2 rounded-md border p-3 focus-visible:ring-2 focus-visible:ring-ring">
                  <h3 className="text-sm font-medium">{selected.properties.find((property) => property.id === editing.propertyId)?.name} for {currentRowData?.rows.find((row) => row.noteId === editing.noteId)?.title}</h3>
                  {selected.properties.filter((property) => property.id === editing.propertyId).map((property) => <PropertyControl relationOptions={currentRowData?.relationCandidates?.[property.relation?.databaseId ?? '']} key={property.id} property={property} value={editing.draft} label={`Edit card ${property.name}`} onChange={(draft) => setEditing({ ...editing, draft, remove: false })} />)}
                  {editing.remove ? <p className="text-xs text-muted-foreground">Saving will clear this value and keep the note in the database.</p> : null}
                  <div className="flex flex-wrap gap-2"><Button size="sm" disabled={saving || stale} onClick={() => void submitEdit()}>Save card</Button><Button size="sm" variant="outline" disabled={saving} onClick={() => setEditing({ ...editing, remove: true })}>Clear value</Button><Button size="sm" variant="ghost" disabled={saving} onClick={() => { restoreCardFocus(editing.noteId); setEditing(null); }}>Cancel card edit</Button></div>
                </section> : null}

                {viewIssues.length ? null : rowsLoading && currentRowData === null ? (
                  <div className="mt-4 flex flex-col gap-2" aria-hidden="true"><Skeleton className="h-10" /><Skeleton className="h-20" /></div>
                ) : rowsError !== null ? (
                  <div className="my-4"><ErrorNotice message={rowsError} onRetry={() => setReloadVersion((value) => value + 1)} /></div>
                ) : currentRowData === null ? null : viewConfiguration.type === 'kanban' && layoutProperty?.type === 'select' ? (
                  <KanbanView rows={displayRows} property={layoutProperty} visibleProperties={visibleProperties} disabled={saving || stale || editing !== null} onOpen={openLayoutNote} onEdit={(row, property) => beginEditing(row.noteId, property, row.values[property.id])} formatValue={formatPropertyValue} renderValue={(row, property) => property.type === 'relation' ? renderRelatedValue(row, property) : formatPropertyValue(property, row.values[property.id])} />
                ) : viewConfiguration.type === 'calendar' && layoutProperty?.type === 'date' ? (
                  <CalendarView key={savedPresentation?.id} rows={displayRows} property={layoutProperty} visibleProperties={visibleProperties} disabled={saving || stale || editing !== null} onOpen={openLayoutNote} onEdit={(row, property) => beginEditing(row.noteId, property, row.values[property.id])} formatValue={formatPropertyValue} renderValue={(row, property) => property.type === 'relation' ? renderRelatedValue(row, property) : formatPropertyValue(property, row.values[property.id])} onCreate={(date) => { datedTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setNewDatedEntry({ date, title: '' }); }} />
                ) : displayRows.length ? (
                  <>
                    <p className="mx-1 mt-4 text-[11px] text-muted-foreground xl:hidden">Scroll sideways to see every property column.</p>
                    <div className="mx-1 my-4 overflow-hidden rounded-md border">
                      <Table className="w-full min-w-[52rem] table-fixed">
                        <TableCaption className="sr-only">
                          {selected.name} rows. {displayRows.length} of {currentRowData.rows.length} shown.
                        </TableCaption>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[24%] whitespace-normal">Note</TableHead>
                            {visibleProperties.map((property) => <TableHead key={property.id} className={cn('whitespace-normal break-words', propertyColumnClass(property))}>{property.name}</TableHead>)}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {displayRows.map((row) => (
                            <TableRow key={row.noteId}>
                              <TableHead scope="row" className="h-auto w-[24%] p-2 align-top font-normal whitespace-normal">
                                <Button type="button" variant="link" size="sm" className="h-auto max-w-full justify-start truncate p-0 font-medium" title={row.title} onClick={() => openLayoutNote(row.noteId)}>{row.title}</Button>
                                <span className="block truncate font-mono text-[10px] text-muted-foreground">{row.path}</span>
                                {row.issues.length > 0 ? <Badge variant="destructive" className="mt-1">Needs attention</Badge> : null}
                              </TableHead>
                              {visibleProperties.map((property) => {
                                const isEditing = editing?.source === 'row' && editing.noteId === row.noteId && editing.propertyId === property.id;
                                const displayValue = formatPropertyValue(property, row.values[property.id]);
                                return (
                                  <TableCell key={property.id} className="min-w-0 align-top whitespace-normal">
                                    {isEditing && editing ? (
                                      <div className="flex min-w-0 flex-col gap-2">
                                        <PropertyControl relationOptions={currentRowData?.relationCandidates?.[property.relation?.databaseId ?? '']} property={property} value={editing.draft} label={`${property.name} for ${row.title}`} onChange={(draft) => setEditing({ ...editing, draft })} />
                                        <div className="flex gap-1">
                                          <Button type="button" size="xs" disabled={saving || stale} onClick={() => void submitEdit()}>{saving ? 'Saving…' : 'Save'}</Button>
                                          <Button type="button" size="xs" variant="ghost" disabled={saving} onClick={() => setEditing(null)}>Cancel</Button>
                                        </div>
                                      </div>
                                    ) : property.type === 'relation' ? renderRelatedValue(row, property) : property.type === 'rollup' ? <span aria-label={`${property.name} for ${row.title}`} className="text-xs">{displayValue}</span> : (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="group/edit flex h-auto min-h-7 w-full items-center justify-between gap-1.5 px-1.5 py-1 text-left font-normal whitespace-normal"
                                        disabled={hasBlockingRowIssues(row, property) || saving || viewsLoading}
                                        aria-label={`Edit ${property.name} for ${row.title}`}
                                        title={hasBlockingRowIssues(row, property) ? 'Resolve structured-data diagnostics before editing this note' : `Edit ${property.name}`}
                                        onClick={() => beginEditing(row.noteId, property, row.values[property.id])}
                                      >
                                        <span className={cn('min-w-0 text-xs', property.type === 'date' || property.type === 'number' ? 'whitespace-nowrap' : 'break-words', row.values[property.id] === undefined && 'text-muted-foreground')}>{displayValue}</span>
                                        <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/edit:opacity-70 group-focus-visible/edit:opacity-70 max-sm:opacity-60" aria-hidden="true" />
                                      </Button>
                                    )}
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                ) : (
                  <div className="mx-1 my-4 flex min-h-28 flex-col items-center justify-center rounded-md border border-dashed px-4 py-5 text-center">
                    <h3 className="text-sm font-medium">{currentRowData.rows.length > 0 ? 'No rows match these filters' : notes.length === 0 ? 'No notes in this vault yet' : 'No notes in this database yet'}</h3>
                    <p className="mt-1 max-w-[46ch] text-xs leading-relaxed text-muted-foreground">
                      {currentRowData.rows.length > 0
                        ? 'Adjust or remove a filter to show matching rows.'
                        : notes.length === 0
                          ? 'Create a Markdown note first, then add it to this database.'
                          : 'Add a note to create its first explicit structured-data row.'}
                    </p>
                    {currentRowData.rows.length > 0 ? (
                      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setFilters([])}>Clear filters</Button>
                    ) : notes.length > 0 ? (
                      <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => { setAddOpen(true); setActionError(null); }}>
                        <Plus data-icon="inline-start" /> Add note
                      </Button>
                    ) : null}
                  </div>
                )}

                {rowsLoading && currentRowData !== null ? <p className="mx-1 mb-3 text-xs text-muted-foreground" role="status">Refreshing rows…</p> : null}
                <Dialog open={newDatedEntry !== null} onOpenChange={(open) => { if (!open && !saving) setNewDatedEntry(null); }}><DialogContent showCloseButton={!saving} onCloseAutoFocus={(event) => { event.preventDefault(); if (datedTriggerRef.current?.isConnected) datedTriggerRef.current.focus(); }} onEscapeKeyDown={(event) => { if (saving) event.preventDefault(); }} onPointerDownOutside={(event) => { if (saving) event.preventDefault(); }}>
                  <DialogHeader><DialogTitle>Create a dated note</DialogTitle><DialogDescription>This creates a Markdown note and explicitly adds it to this database with a date. A failed date write keeps the new note for inspection.</DialogDescription></DialogHeader>
                  <label className="flex flex-col gap-1 text-xs">Title<Input value={newDatedEntry?.title ?? ''} disabled={saving || !!newDatedEntry?.noteId} onChange={(event) => { const title = event.currentTarget.value; setNewDatedEntry((previous) => previous === null ? null : { ...previous, title }); }} /></label>
                  <label className="flex flex-col gap-1 text-xs">Date<Input type="date" value={newDatedEntry?.date ?? ''} disabled={saving || !!newDatedEntry?.noteId} onChange={(event) => { const date = event.currentTarget.value; setNewDatedEntry((previous) => previous === null ? null : { ...previous, date }); }} /></label>
                  {actionError ? <p role="alert" className="text-xs text-destructive">{actionError}</p> : null}
                  {newDatedEntry?.noteId ? <Button variant="link" onClick={() => onOpenNote(newDatedEntry.noteId!)}>Open created note</Button> : null}
                  <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setNewDatedEntry(null)}>Close</Button><Button disabled={saving || stale || !newDatedEntry?.date} onClick={() => void createDatedNote()}>{saving ? 'Creating…' : newDatedEntry?.noteId ? 'Retry date assignment' : 'Create note and add date'}</Button></DialogFooter>
                </DialogContent></Dialog>
              </article>
            </div>
          )}
          {schemaDraft !== null ? (
            <Sheet open onOpenChange={(open) => { if (!open) closeSchemaEditor(); }}>
              <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-2xl" aria-busy={schemaSaving || undefined}>
                <SheetHeader>
                  <SheetTitle>{schemaCreating ? 'New database schema' : 'Edit database schema'}</SheetTitle>
                  <SheetDescription>
                    Schema edits never rewrite note values. Property IDs stay fixed; existing property types and options can be renamed but not removed. Adding fields does not change note membership.
                  </SheetDescription>
                </SheetHeader>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                  <div className="flex flex-col gap-4">
                    <label className="flex max-w-xl flex-col gap-1 text-xs font-medium">
                      Database name
                      <Input
                        aria-label="Database name"
                        aria-required="true"
                        autoFocus
                        value={schemaDraft.name}
                        onChange={(event) => setSchemaDraft({ ...schemaDraft, name: event.currentTarget.value })}
                      />
                    </label>

                    <section className="flex flex-col gap-3" aria-label="Database properties">
                      {schemaDraft.properties.length === 0 ? (
                        <p className="rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">
                          No properties yet. Notes can still join this database with explicit membership.
                        </p>
                      ) : null}
                      {schemaDraft.properties.map((property, index) => (
                        <fieldset key={property.id} className="flex min-w-0 flex-col gap-3 rounded-md border p-3">
                          <legend className="px-1 text-xs font-medium">Property {index + 1}</legend>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <label className="flex min-w-0 flex-col gap-1 text-xs font-medium">
                              Property name
                              <Input
                                aria-label={`Property ${index + 1} name`}
                                aria-required="true"
                                value={property.name}
                                onChange={(event) => updateSchemaProperty(index, { name: event.currentTarget.value })}
                              />
                            </label>
                            <div className="flex flex-col gap-1 text-xs font-medium">
                              Property type
                              {schemaCreating || newPropertyIds.has(property.id) ? (
                                <Select
                                  value={property.type}
                                  disabled={schemaSaving}
                                  onValueChange={(type) => changeSchemaPropertyType(index, type as PropertyType)}
                                >
                                  <SelectTrigger className="w-full" aria-label={`Property ${index + 1} type`}>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {PROPERTY_TYPES.map((type) => <SelectItem key={type} value={type}>{propertyTypeLabel(type)}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <p className="rounded-md border px-2.5 py-1.5 font-normal text-muted-foreground">
                                  {propertyTypeLabel(property.type)} · type and property ID are stable
                                </p>
                              )}
                            </div>
                          </div>
                          <RelationSchemaFields property={property} database={schemaDraft} databases={databases} onChange={(update) => updateSchemaProperty(index, update)} />
                          {(property.type === 'select' || property.type === 'multi-select') ? (
                            <div className="flex flex-col gap-2">
                              <div className="text-xs font-medium">Options <span className="font-normal text-muted-foreground">(option IDs are stable)</span></div>
                              {property.options?.length ? property.options.map((option, optionIndex) => (
                                <label key={option.id} className="flex max-w-xl flex-col gap-1 text-xs text-muted-foreground">
                                  Option {optionIndex + 1}
                                  <Input
                                    aria-label={`${property.name || `Property ${index + 1}`} option ${optionIndex + 1}`}
                                    aria-required="true"
                                    value={option.name}
                                    onChange={(event) => updateSchemaOption(index, optionIndex, event.currentTarget.value)}
                                  />
                                </label>
                              )) : (
                                <p className="text-[11px] text-muted-foreground">No options defined. Add one before saving.</p>
                              )}
                              <Button type="button" size="xs" variant="outline" className="self-start" onClick={() => addSchemaOption(index)} disabled={schemaSaving}>
                                <Plus data-icon="inline-start" /> Add option
                              </Button>
                            </div>
                          ) : null}
                        </fieldset>
                      ))}
                    </section>

                    <Button type="button" size="sm" variant="outline" className="self-start" onClick={addSchemaProperty} disabled={schemaSaving || schemaStale}>
                      <Plus data-icon="inline-start" /> Add property
                    </Button>

                    {schemaStale ? <p className="text-xs leading-relaxed text-muted-foreground">Your draft is preserved. Discard it to reopen the latest schema before making another change.</p> : null}
                    {schemaNotice && schemaNoticeDatabaseId === schemaDraft.id ? <p role="status" className="text-xs text-muted-foreground">{schemaNotice}</p> : null}
                  </div>
                </div>

                <SheetFooter className="flex-col items-stretch gap-2">
                  {schemaError ? <p id="database-schema-error" role="alert" className="text-xs text-destructive">{schemaError}</p> : null}
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={closeSchemaEditor} disabled={schemaSaving}>Cancel</Button>
                      {schemaStale ? (
                        <Button type="button" size="sm" variant="outline" onClick={closeSchemaEditor}>Discard draft</Button>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void saveSchema()}
                      disabled={schemaSaving || schemaStale}
                      aria-describedby={schemaError === null ? undefined : 'database-schema-error'}
                    >
                      {schemaSaving ? 'Saving schema…' : schemaCreating ? 'Create database' : 'Save schema'}
                    </Button>
                  </div>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          ) : schemaNotice && schemaNoticeDatabaseId === selected?.id ? <p className="mx-auto mt-3 max-w-3xl text-xs text-muted-foreground" role="status">{schemaNotice}</p> : null}
        </div>
      </ScrollArea>
    </section>
  );
}

function PropertyChooser({
  properties,
  value,
  onChange,
}: {
  properties: Property[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs font-medium">
      <span>Property to set</span>
      <Select
        value={value ?? undefined}
        onValueChange={onChange}
      >
        <SelectTrigger className="w-full" aria-label="Property to set">
          <SelectValue placeholder="Choose a property" />
        </SelectTrigger>
        <SelectContent>
          {properties.map((property) => (
            <SelectItem key={property.id} value={property.id}>
              {property.name} ({propertyTypeLabel(property.type)})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function DatabaseSelectorItem({
  database,
  selected,
  disabled,
  onSelect,
}: {
  database: UiDatabase;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
}) {
  const identity = databaseIdentityLabel(database);
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'h-auto min-w-[190px] shrink justify-start gap-2 rounded-[4px] whitespace-normal px-2 py-1.5 text-left font-normal xl:w-full xl:min-w-0',
        selected && 'bg-success/12 hover:bg-success/15',
      )}
      onClick={() => onSelect(database.id)}
      disabled={disabled}
      aria-current={selected ? 'page' : undefined}
      aria-label={identity}
      title={identity}
    >
      <span className={cn('grid size-7 shrink-0 place-items-center rounded-[4px] bg-muted', selected ? 'text-success' : 'text-muted-foreground')}>
        <Database className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{database.name}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          {database.properties.length} {database.properties.length === 1 ? 'property' : 'properties'}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground" title={database.path}>{database.path}</span>
      </span>
      <span className="sr-only" aria-label={`Database ID ${database.id}`}>{database.id}</span>
      {selected ? <Check className="size-3.5 shrink-0 text-success" aria-hidden="true" /> : null}
    </Button>
  );
}

function propertyColumnClass(property: Property): string {
  switch (property.type) {
    case 'text': return 'w-[22%]';
    case 'select':
    case 'multi-select':
    case 'relation': return 'w-[15%]';
    case 'date':
    case 'rollup': return 'w-[13%]';
    case 'number': return 'w-[11%]';
    case 'checkbox': return 'w-[10%]';
  }
}

function filterOperatorLabel(operator: DatabaseFilterOperator): string {
  const labels: Record<DatabaseFilterOperator, string> = {
    contains: 'contains',
    equals: 'is',
    greater: 'greater than',
    less: 'less than',
    is: 'is',
    before: 'before',
    after: 'after',
    includes: 'includes',
    'is-empty': 'is empty',
    'is-not-empty': 'is not empty',
  };
  return labels[operator];
}

function FilterValueControl({
  property,
  relationOptions,
  value,
  label,
  invalid,
  describedBy,
  className,
  onChange,
}: {
  property: Property;
  relationOptions?: RelationReference[];
  value: unknown;
  label: string;
  invalid: boolean;
  describedBy?: string;
  className?: string;
  onChange: (value: unknown) => void;
}) {
  if (property.type === 'relation') return <RelationControl inline property={{ ...property, relation: { ...property.relation!, cardinality: 'one' } }} value={value} label={label} options={relationOptions} onChange={onChange} />;
  if (property.type === 'checkbox') {
    const current = value === true ? 'true' : value === false ? 'false' : undefined;
    return (
      <Select value={current} onValueChange={(next) => onChange(next === 'true')}>
        <SelectTrigger
          className={cn('w-full', className)}
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        >
          <SelectValue placeholder="Choose value" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Yes</SelectItem>
          <SelectItem value="false">No</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (property.type === 'select' || property.type === 'multi-select') {
    const options = property.options ?? [];
    return (
      <Select
        value={typeof value === 'string' && value !== '' ? value : undefined}
        disabled={options.length === 0}
        onValueChange={onChange}
      >
        <SelectTrigger
          className={cn('w-full', className)}
          aria-label={label}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
        >
          <SelectValue placeholder={options.length === 0 ? 'No options defined' : 'Choose value'} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }

  const inputType = (property.type === 'number' || property.type === 'rollup') ? 'number' : property.type === 'date' ? 'date' : 'text';
  const inputValue = typeof value === 'number'
    ? Number.isFinite(value) ? value : ''
    : typeof value === 'string' ? value : '';
  return (
    <Input
      className={cn('w-40', className)}
      type={inputType}
      step={inputType === 'number' ? 'any' : undefined}
      value={inputValue}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onChange={(event) => {
        const raw = event.currentTarget.value;
        onChange((property.type === 'number' || property.type === 'rollup') ? (raw === '' ? '' : Number.isFinite(Number(raw)) ? Number(raw) : Number.NaN) : raw);
      }}
    />
  );
}

function ErrorNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-4 mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive sm:mx-6" role="alert">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      <Button type="button" variant="link" size="xs" className="h-auto p-0 text-xs text-destructive" onClick={onRetry}>Retry</Button>
    </div>
  );
}
