import { NodusError } from '../domain/errors.js';
import { isUuidV4 } from '../domain/ids.js';

/** Canonical vault location; portable backup/export integration is a later milestone. */
export const PROPERTY_CATALOG_PATH = 'properties/catalog.json';
export const PROPERTY_CATALOG_FORMAT = 'nodus-property-catalog';
export const PROPERTY_CATALOG_VERSION = 1;

export const NOTE_PROPERTY_TYPES = ['text', 'number', 'checkbox', 'date', 'select', 'multi-select', 'url'] as const;
export type NotePropertyType = (typeof NOTE_PROPERTY_TYPES)[number];

export interface PropertyOption {
  id: string;
  label: string;
  /** Previous labels remain valid stored values after a label change. */
  aliases?: string[];
}

export interface NotePropertyDefinition {
  id: string;
  /** Stable YAML key. It does not change when the display name changes. */
  key: string;
  name: string;
  type: NotePropertyType;
  options?: PropertyOption[];
}

export interface PropertyCatalog {
  properties: NotePropertyDefinition[];
}

export type PropertyCatalogMutation =
  | { type: 'create-property'; property: NotePropertyDefinition }
  | { type: 'rename-property'; propertyId: string; name: string }
  | { type: 'add-option'; propertyId: string; option: PropertyOption }
  | { type: 'rename-option'; propertyId: string; optionId: string; label: string }
  | { type: 'remove-option'; propertyId: string; optionId: string; confirmUnregisterValues: true }
  | { type: 'delete-property'; propertyId: string; confirmUnregisterValues: true };

export type NotePropertyValue = string | number | boolean | string[];

export interface PropertyValueIssue {
  key: string;
  propertyId: string;
  code: 'TYPE_MISMATCH' | 'INVALID_VALUE';
  message: string;
}

export interface PropertyValueProjection {
  /** Values are returned without coercion or mutation of source frontmatter. */
  values: Record<string, NotePropertyValue>;
  issues: PropertyValueIssue[];
  /** Preserved frontmatter keys that have not been explicitly registered. */
  unregisteredKeys: string[];
}

const ENVELOPE_KEYS = new Set(['format', 'version', 'properties']);
const PROPERTY_KEYS = new Set(['id', 'key', 'name', 'type', 'options']);
const OPTION_KEYS = new Set(['id', 'label', 'aliases']);
const RESERVED_KEYS = new Set(['title', 'tags', 'aliases', 'nodus', 'nodus_data', 'icon']);
const RESERVED_YAML_SCALARS = new Set(['true', 'false', 'null', '~', '__proto__', 'prototype', 'constructor']);

export function createPropertyCatalog(properties: NotePropertyDefinition[] = []): PropertyCatalog {
  return parsePropertyCatalog(JSON.stringify({ format: PROPERTY_CATALOG_FORMAT, version: PROPERTY_CATALOG_VERSION, properties }));
}

/** Parse and validate the independently versioned, vault-wide property catalog. */
export function parsePropertyCatalog(json: string): PropertyCatalog {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    throw invalidCatalog(`Property catalog is not valid JSON: ${(error as Error).message}`);
  }
  if (!isRecord(raw)) throw invalidCatalog('Property catalog must be a JSON object');
  if (raw.format !== PROPERTY_CATALOG_FORMAT) throw invalidCatalog(`format must be "${PROPERTY_CATALOG_FORMAT}"`);
  if (typeof raw.version !== 'number' || !Number.isInteger(raw.version) || raw.version < 1) {
    throw invalidCatalog('version must be a positive integer');
  }
  if (raw.version > PROPERTY_CATALOG_VERSION) {
    throw new NodusError(
      'UNSUPPORTED_VERSION',
      `Property catalog version ${raw.version} is newer than supported version ${PROPERTY_CATALOG_VERSION}; upgrade Nodus to read it`,
    );
  }
  rejectUnknownKeys(raw, ENVELOPE_KEYS, 'property catalog');
  if (!Array.isArray(raw.properties)) throw invalidCatalog('properties must be an array');

  const properties = raw.properties.map((item, index) => parseProperty(item, index));
  assertUnique(properties.map((item) => item.id), 'property ID');
  assertUnique(properties.map((item) => item.key), 'YAML key');
  assertUnique(properties.map((item) => fold(item.name)), 'property display name');

  const optionIds = properties.flatMap((item) => item.options?.map((option) => option.id) ?? []);
  assertUnique(optionIds, 'option ID');
  return { properties };
}

/** Canonical JSON: properties sort by stable key, options by stable ID. */
export function serializePropertyCatalog(catalog: PropertyCatalog): string {
  const normalized = parsePropertyCatalog(JSON.stringify({
    ...catalog,
    format: PROPERTY_CATALOG_FORMAT,
    version: PROPERTY_CATALOG_VERSION,
  }));
  const properties = [...normalized.properties]
    .sort((a, b) => compare(a.key, b.key))
    .map((property) => ({
      id: property.id,
      key: property.key,
      name: property.name,
      type: property.type,
      ...(property.options === undefined ? {} : {
        options: [...property.options].sort((a, b) => compare(a.id, b.id)).map((option) => ({
          id: option.id,
          label: option.label,
          ...(option.aliases === undefined || option.aliases.length === 0
            ? {}
            : { aliases: [...option.aliases].sort(compare) }),
        })),
      }),
    }));
  return `${JSON.stringify({ format: PROPERTY_CATALOG_FORMAT, version: PROPERTY_CATALOG_VERSION, properties }, null, 2)}\n`;
}

/** Validate one YAML value. Missing values are represented by an absent key and are not passed here. */
export function validateNotePropertyValue(
  property: NotePropertyDefinition,
  value: unknown,
): { ok: true; value: NotePropertyValue } | { ok: false; issue: Omit<PropertyValueIssue, 'key' | 'propertyId'> } {
  const mismatch = (expected: string) => ({
    ok: false as const,
    issue: { code: 'TYPE_MISMATCH' as const, message: `Property "${property.name}" (${property.type}) must be ${expected}` },
  });
  const invalid = (reason: string) => ({
    ok: false as const,
    issue: { code: 'INVALID_VALUE' as const, message: `Property "${property.name}" ${reason}` },
  });

  switch (property.type) {
    case 'text':
      return typeof value === 'string' ? { ok: true, value } : mismatch('a string');
    case 'number':
      if (typeof value !== 'number') return mismatch('a number');
      return Number.isFinite(value) ? { ok: true, value } : invalid('must be a finite number');
    case 'checkbox':
      return typeof value === 'boolean' ? { ok: true, value } : mismatch('a boolean');
    case 'date':
      if (typeof value !== 'string') return mismatch('a YYYY-MM-DD string');
      return isCalendarDate(value) ? { ok: true, value } : invalid('must be a valid YYYY-MM-DD calendar date');
    case 'select':
      if (typeof value !== 'string') return mismatch('a configured option string');
      return optionForValue(property, value) ? { ok: true, value } : invalid('must match a configured option label');
    case 'multi-select':
      if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return mismatch('an array of configured option strings');
      if (new Set(value.map(fold)).size !== value.length) return invalid('must not contain duplicate option labels');
      return value.every((item) => optionForValue(property, item))
        ? { ok: true, value: [...value] as string[] }
        : invalid('must contain only configured option labels');
    case 'url':
      if (typeof value !== 'string') return mismatch('an absolute HTTP or HTTPS URL string');
      return isPermittedUrl(value) ? { ok: true, value } : invalid('must be a valid absolute HTTP or HTTPS URL');
  }
}

/**
 * Resolve a validated select or multi-select value to the option's current
 * label, so filters treat current labels and retained aliases as one option.
 */
export function canonicalizePropertyValue(
  property: NotePropertyDefinition,
  value: NotePropertyValue,
): NotePropertyValue {
  if (property.type === 'select' && typeof value === 'string') {
    return optionForValue(property, value)?.label ?? value;
  }
  if (property.type === 'multi-select' && Array.isArray(value)) {
    return value.map((item) => optionForValue(property, item)?.label ?? item);
  }
  return value;
}

/** Every current and retained label for the options a stored value resolves to. */
export function propertyOptionLabels(
  property: NotePropertyDefinition,
  value: NotePropertyValue,
): string[] {
  const values = Array.isArray(value) ? value : [value];
  const labels = new Set<string>();
  for (const item of values) {
    if (typeof item !== 'string') continue;
    const option = optionForValue(property, item);
    if (option === undefined) continue;
    labels.add(option.label);
    for (const alias of option.aliases ?? []) labels.add(alias);
  }
  return [...labels];
}

/** Read-only projection; invalid and unregistered frontmatter is reported, never rewritten. */
export function projectPropertyValues(
  catalog: PropertyCatalog,
  frontmatter: Record<string, unknown>,
): PropertyValueProjection {
  const values: Record<string, NotePropertyValue> = {};
  const issues: PropertyValueIssue[] = [];
  const registered = new Set(catalog.properties.map((property) => property.key));
  for (const property of catalog.properties) {
    if (!Object.hasOwn(frontmatter, property.key)) continue;
    const result = validateNotePropertyValue(property, frontmatter[property.key]);
    if (result.ok) values[property.id] = result.value;
    else issues.push({ key: property.key, propertyId: property.id, ...result.issue });
  }
  const unregisteredKeys = Object.keys(frontmatter)
    .filter((key) => !registered.has(key) && !RESERVED_KEYS.has(key))
    .sort(compare);
  return { values, issues, unregisteredKeys };
}

/** Label changes retain the previous readable YAML value as a valid alias. */
export function renamePropertyOptionLabel(
  catalog: PropertyCatalog,
  propertyId: string,
  optionId: string,
  label: string,
): PropertyCatalog {
  const next = structuredClone(catalog);
  const property = next.properties.find((candidate) => candidate.id === propertyId);
  const option = property?.options?.find((candidate) => candidate.id === optionId);
  if (!property || !option) throw invalidCatalog('Property or option was not found');
  const normalizedLabel = requireName(label, `Option label for "${property.name}"`);
  const previousLabel = option.label;
  if (previousLabel !== normalizedLabel) {
    option.label = normalizedLabel;
    // Renaming back to a retained label must remove that label from the alias
    // list instead of producing a self-referential alias that fails validation.
    const aliases = [...new Set([...(option.aliases ?? []), previousLabel])]
      .filter((alias) => fold(alias) !== fold(normalizedLabel));
    if (aliases.length === 0) delete option.aliases;
    else option.aliases = aliases;
  }
  return parsePropertyCatalog(JSON.stringify({ format: PROPERTY_CATALOG_FORMAT, version: PROPERTY_CATALOG_VERSION, properties: next.properties }));
}

/** Apply one explicit catalog operation without mutating the caller's snapshot. */
export function mutatePropertyCatalog(catalog: PropertyCatalog, mutation: PropertyCatalogMutation): PropertyCatalog {
  const next = structuredClone(catalog);
  if (mutation.type === 'create-property') {
    next.properties.push(structuredClone(mutation.property));
    return validateCatalogObject(next);
  }

  const property = next.properties.find((candidate) => candidate.id === mutation.propertyId);
  if (!property) throw invalidCatalog(`Property "${mutation.propertyId}" was not found`);

  switch (mutation.type) {
    case 'rename-property':
      property.name = requireName(mutation.name, `Display name for "${property.key}"`);
      break;
    case 'add-option':
      if (property.type !== 'select' && property.type !== 'multi-select') throw invalidCatalog('Only select properties accept options');
      property.options!.push(structuredClone(mutation.option));
      break;
    case 'rename-option':
      return renamePropertyOptionLabel(next, property.id, mutation.optionId, mutation.label);
    case 'remove-option': {
      const optionIndex = property.options?.findIndex((option) => option.id === mutation.optionId) ?? -1;
      if (optionIndex < 0) throw invalidCatalog(`Option "${mutation.optionId}" was not found`);
      if (mutation.confirmUnregisterValues !== true) throw invalidCatalog('Removing an option requires confirmUnregisterValues: true; matching note values will remain unchanged and become invalid until explicitly repaired');
      property.options!.splice(optionIndex, 1);
      break;
    }
    case 'delete-property':
      if (mutation.confirmUnregisterValues !== true) throw invalidCatalog('Deleting a property requires confirmUnregisterValues: true; note values will remain unchanged as unregistered frontmatter');
      next.properties = next.properties.filter((candidate) => candidate.id !== property.id);
      break;
    default:
      throw invalidCatalog('Unsupported property catalog operation');
  }
  return validateCatalogObject(next);
}

function validateCatalogObject(catalog: PropertyCatalog): PropertyCatalog {
  return parsePropertyCatalog(JSON.stringify({ format: PROPERTY_CATALOG_FORMAT, version: PROPERTY_CATALOG_VERSION, properties: catalog.properties }));
}

function parseProperty(value: unknown, index: number): NotePropertyDefinition {
  const where = `properties[${index}]`;
  if (!isRecord(value)) throw invalidCatalog(`${where} must be an object`);
  rejectUnknownKeys(value, PROPERTY_KEYS, where);
  const id = requireUuid(value.id, `${where}.id`);
  const key = requireKey(value.key, `${where}.key`);
  const name = requireName(value.name, `${where}.name`);
  if (typeof value.type !== 'string' || !(NOTE_PROPERTY_TYPES as readonly string[]).includes(value.type)) {
    throw invalidCatalog(`${where}.type must be one of ${NOTE_PROPERTY_TYPES.join(', ')}`);
  }
  const type = value.type as NotePropertyType;
  const hasOptions = value.options !== undefined;
  if ((type === 'select' || type === 'multi-select') !== hasOptions) {
    throw invalidCatalog(`${where}.options is required only for select and multi-select properties`);
  }
  const options = hasOptions
    ? (Array.isArray(value.options) ? value.options.map((option, optionIndex) => parseOption(option, `${where}.options[${optionIndex}]`)) : (() => { throw invalidCatalog(`${where}.options must be an array`); })())
    : undefined;
  if (options) {
    const optionValues = options.flatMap((option) => [option.label, ...(option.aliases ?? [])]);
    assertUnique(optionValues.map(fold), `option label or alias in ${where}`);
  }
  return { id, key, name, type, ...(options === undefined ? {} : { options }) };
}

function parseOption(value: unknown, where: string): PropertyOption {
  if (!isRecord(value)) throw invalidCatalog(`${where} must be an object`);
  rejectUnknownKeys(value, OPTION_KEYS, where);
  const id = requireUuid(value.id, `${where}.id`);
  const label = requireName(value.label, `${where}.label`);
  let aliases: string[] | undefined;
  if (value.aliases !== undefined) {
    if (!Array.isArray(value.aliases)) throw invalidCatalog(`${where}.aliases must be an array of strings`);
    aliases = value.aliases.map((alias, index) => requireName(alias, `${where}.aliases[${index}]`));
    assertUnique(aliases.map(fold), `${where} alias`);
    if (aliases.some((alias) => fold(alias) === fold(label))) throw invalidCatalog(`${where}.aliases must not repeat its label`);
  }
  return { id, label, ...(aliases === undefined ? {} : { aliases }) };
}

function requireKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 64 || !/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/.test(value)) {
    throw invalidCatalog(`${label} must be a lowercase ASCII YAML key (letters, numbers, hyphens, underscores; 1–64 characters)`);
  }
  if (RESERVED_KEYS.has(value) || RESERVED_YAML_SCALARS.has(value)) throw invalidCatalog(`${label} "${value}" is reserved`);
  return value;
}

function requireName(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.trim() !== value || /[\r\n]/.test(value)) {
    throw invalidCatalog(`${label} must be a non-empty single-line string without surrounding whitespace`);
  }
  return value;
}

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isUuidV4(value)) throw invalidCatalog(`${label} must be a lowercase UUID v4`);
  return value;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: Set<string>, where: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw invalidCatalog(`Unknown key "${key}" in ${where}`);
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw invalidCatalog(`Duplicate ${label}`);
}

function optionForValue(property: NotePropertyDefinition, value: string): PropertyOption | undefined {
  const normalized = fold(value);
  return property.options?.find((option) => fold(option.label) === normalized || option.aliases?.some((alias) => fold(alias) === normalized));
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isPermittedUrl(value: string): boolean {
  if (!value || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
  } catch {
    return false;
  }
}

function fold(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidCatalog(message: string): NodusError {
  return new NodusError('INVALID_FIELD', `Invalid property catalog: ${message}`);
}
