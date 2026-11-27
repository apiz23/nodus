import type { Property } from '../../src/database/schema';

/**
 * Single source of truth for displaying a database property value as text.
 * Shared by the database browser and embedded Markdown views so both render
 * select options, checkboxes and empty values identically.
 */
export function formatPropertyValue(property: Property, value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (property.type === 'rollup' && property.rollup?.operation === 'completion-percentage') return `${Number(value).toFixed(1)}%`;
  if (property.type === 'checkbox') return value === true ? 'Yes' : 'No';
  if (property.type === 'formula' && property.formula?.resultType === 'boolean') return value === true ? 'Yes' : value === false ? 'No' : String(value);
  if (property.type === 'select') {
    return property.options?.find((option) => option.id === value)?.name ?? String(value);
  }
  if (property.type === 'multi-select' && Array.isArray(value)) {
    return value
      .map((id) => property.options?.find((option) => option.id === id)?.name ?? String(id))
      .join(', ') || '—';
  }
  if (property.type === 'formula' && typeof value === 'object') return 'Formula error';
  return String(value);
}
