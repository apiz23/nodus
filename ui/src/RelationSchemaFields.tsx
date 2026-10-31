import type { DatabaseDefinition, Property } from '../../src/database/schema';
import { ROLLUP_OPERATIONS } from '../../src/database/schema';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

export function RelationSchemaFields({ property, database, databases, onChange }: {
  property: Property; database: DatabaseDefinition; databases: DatabaseDefinition[]; onChange: (update: Partial<Property>) => void;
}) {
  const schemas = [...databases.filter((item) => item.id !== database.id), database];
  const choice = (label: string, value: string | undefined, items: { id: string; name: string; disabled?: boolean }[], select: (id: string) => void) => <label className="flex flex-col gap-1 text-xs">{label}
    <Select value={value || ''} onValueChange={select}><SelectTrigger aria-label={`${property.name} ${label}`}><SelectValue placeholder="Choose…" /></SelectTrigger><SelectContent>{items.map((item) => <SelectItem key={item.id} value={item.id} disabled={item.disabled}>{item.name}</SelectItem>)}</SelectContent></Select>
  </label>;
  if (property.type === 'relation') {
    const relation = property.relation!;
    const target = schemas.find((item) => item.id === relation.databaseId);
    const forward = target?.properties.filter((item) => item.type === 'relation' && !item.relation?.reversePropertyId && item.relation?.databaseId === database.id) ?? [];
    const targetChoices = target ? schemas : [...schemas, { id: relation.databaseId, name: 'Unavailable target database' }];
    const forwardChoices = relation.reversePropertyId && !forward.some((item) => item.id === relation.reversePropertyId)
      ? [...forward.map((item) => ({ id: item.id, name: item.name })), { id: relation.reversePropertyId, name: 'Unavailable forward relation' }]
      : forward.map((item) => ({ id: item.id, name: item.name }));
    return <div className="grid gap-2 sm:grid-cols-2">
      {choice('Target database', relation.databaseId, targetChoices, (databaseId) => onChange({ relation: { ...relation, databaseId, reversePropertyId: undefined } }))}
      {choice('Direction', relation.reversePropertyId === undefined ? 'forward' : 'reverse', [{ id: 'forward', name: 'Forward (editable)' }, { id: 'reverse', name: 'Reverse (computed)', disabled: forward.length === 0 && relation.reversePropertyId === undefined }], (direction) => onChange({ relation: { ...relation, cardinality: direction === 'reverse' ? 'many' : relation.cardinality, reversePropertyId: direction === 'reverse' ? forward[0]?.id ?? '' : undefined } }))}
      {relation.reversePropertyId !== undefined ? choice('Forward property', relation.reversePropertyId, forwardChoices, (reversePropertyId) => onChange({ relation: { ...relation, reversePropertyId } })) : choice('Cardinality', relation.cardinality, [{ id: 'one', name: 'One record' }, { id: 'many', name: 'Multiple records' }], (cardinality) => onChange({ relation: { ...relation, cardinality: cardinality as 'one' | 'many' } }))}
      {target ? <p className="text-xs text-muted-foreground sm:col-span-2">Links point to records in <span className="font-medium text-foreground">{target.name}</span>. {relation.reversePropertyId === undefined ? relation.cardinality === 'one' ? 'Each note can link to one record.' : 'Each note can link to multiple records.' : 'This mirrors the selected forward relation and is read-only.'} Changing the target or cardinality keeps stored note values; links that no longer fit must be repaired.</p>
        : <p className="text-xs text-destructive sm:col-span-2" role="alert">The configured target database is unavailable. Stored references remain intact. Choose an available database to repair this property.</p>}
      {relation.reversePropertyId !== undefined && !forward.some((item) => item.id === relation.reversePropertyId) ? <p className="text-xs text-destructive sm:col-span-2" role="alert">The configured forward relation is unavailable or no longer points to this database. Choose a valid forward relation; stored references are preserved.</p> : null}
    </div>;
  }
  if (property.type !== 'rollup') return null;
  const config = property.rollup!;
  const relation = database.properties.find((item) => item.id === config.relationPropertyId && item.type === 'relation');
  const target = schemas.find((item) => item.id === relation?.relation?.databaseId);
  const fields = target?.properties.filter((item) => config.operation === 'sum' ? item.type === 'number' || item.type === 'rollup' : ['completed-task-count', 'completion-percentage'].includes(config.operation) ? item.type === 'checkbox' : item.type !== 'relation') ?? [];
  const fieldId = config.targetPropertyId ?? config.condition?.propertyId;
  const field = fields.find((item) => item.id === fieldId);
  return <div className="grid gap-2 sm:grid-cols-2">
    {choice('Relation', config.relationPropertyId, database.properties.filter((item) => item.type === 'relation'), (relationPropertyId) => onChange({ rollup: { relationPropertyId, operation: 'count' } }))}
    {choice('Operation', config.operation, ROLLUP_OPERATIONS.map((id) => ({ id, name: id.replaceAll('-', ' ') })), (operation) => onChange({ rollup: { relationPropertyId: config.relationPropertyId, operation: operation as typeof config.operation,
      ...(operation === 'conditional-count' ? { condition: { propertyId: '', value: '' } } : operation === 'count' ? {} : { targetPropertyId: '' }) } }))}
    {config.operation !== 'count' ? choice('Target property', fieldId, fields, (id) => onChange({ rollup: { ...config, ...(config.operation === 'conditional-count' ? { condition: { propertyId: id, value: fields.find((item) => item.id === id)?.type === 'checkbox' ? true : '' } } : { targetPropertyId: id }) } })) : null}
    {config.operation === 'conditional-count' && config.condition ? field?.type === 'checkbox'
      ? choice('Equals', String(config.condition.value), [{ id: 'true', name: 'Yes' }, { id: 'false', name: 'No' }], (value) => onChange({ rollup: { ...config, condition: { ...config.condition!, value: value === 'true' } } }))
      : field?.type === 'select' || field?.type === 'multi-select'
        ? choice('Equals', String(config.condition.value), field.options ?? [], (value) => onChange({ rollup: { ...config, condition: { ...config.condition!, value } } }))
        : <label className="flex flex-col gap-1 text-xs">Equals<Input aria-label={`${property.name} Equals`} type={field?.type === 'number' || field?.type === 'rollup' ? 'number' : 'text'} value={String(config.condition.value)} onChange={(event) => onChange({ rollup: { ...config, condition: { ...config.condition!, value: field?.type === 'number' || field?.type === 'rollup' ? Number(event.currentTarget.value) : event.currentTarget.value } } })} /></label>
      : null}
    <p className="text-xs text-muted-foreground sm:col-span-2">Derived and read-only. Completion uses a Checkbox on related task records; percentages range from 0 to 100. Invalid or circular configurations show diagnostics.</p>
  </div>;
}
