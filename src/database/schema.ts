import { NodusError } from '../domain/errors.js';
import { isUuidV4 } from '../domain/ids.js';

export const DATABASE_FORMAT = 'nodus-database';
export const DATABASE_FORMAT_VERSION = 1;

export const PROPERTY_TYPES = ['text', 'number', 'checkbox', 'date', 'select', 'multi-select'] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export interface SelectOption {
  id: string;
  name: string;
}

export interface Property {
  id: string;
  name: string;
  type: PropertyType;
  options?: SelectOption[];
}

export interface DatabaseDefinition {
  id: string;
  name: string;
  properties: Property[];
}

const ENVELOPE_KEYS = ['format', 'version', 'id', 'name', 'properties'];
const PROPERTY_KEYS = ['id', 'name', 'type', 'options'];
const OPTION_KEYS = ['id', 'name'];

export function parseDatabase(json: string): DatabaseDefinition {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (error) {
    throw invalidDatabase(`Database file is not valid JSON: ${(error as Error).message}`);
  }
  if (!isPlainObject(data)) throw invalidDatabase('Database definition must be a JSON object');
  if (data.format !== DATABASE_FORMAT) throw invalidDatabase(`format must be "${DATABASE_FORMAT}"`);

  const version = data.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new NodusError('INVALID_FIELD', 'Database version must be a positive integer');
  }
  if (version > DATABASE_FORMAT_VERSION) {
    throw new NodusError(
      'UNSUPPORTED_VERSION',
      `Database format version ${version} is newer than supported version ${DATABASE_FORMAT_VERSION}; upgrade Nodus to read it`,
    );
  }

  rejectUnknownKeys(data, ENVELOPE_KEYS, 'database');
  const id = requireUuid(data.id, 'database id');
  const name = requireName(data.name, 'database name');
  if (!Array.isArray(data.properties)) throw invalidDatabase('properties must be an array');

  const properties = data.properties.map((property, index) => parseProperty(property, index));
  assertUnique(
    properties.map((property) => property.id),
    'property id',
  );
  assertUnique(
    properties.map((property) => caseInsensitiveName(property.name)),
    'property name',
  );

  return { id, name, properties };
}

export function serializeDatabase(database: DatabaseDefinition): string {
  const envelope = {
    format: DATABASE_FORMAT,
    version: DATABASE_FORMAT_VERSION,
    id: database.id,
    name: database.name,
    properties: database.properties.map((property) => ({
      id: property.id,
      name: property.name,
      type: property.type,
      ...(property.options === undefined ? {} : { options: property.options }),
    })),
  };
  const json = `${JSON.stringify(envelope, null, 2)}\n`;
  parseDatabase(json);
  return json;
}

function parseProperty(value: unknown, index: number): Property {
  const where = `properties[${index}]`;
  if (!isPlainObject(value)) throw invalidDatabase(`${where} must be an object`);
  rejectUnknownKeys(value, PROPERTY_KEYS, where);

  const id = requireUuid(value.id, `${where} id`);
  const name = requireName(value.name, `${where} name`);
  const type = value.type;
  if (!isPropertyType(type)) {
    throw invalidDatabase(`Unsupported property type "${String(type)}" on property "${name}"`);
  }

  if (type === 'select' || type === 'multi-select') {
    if (!Array.isArray(value.options)) throw invalidDatabase(`Property "${name}" of type ${type} requires options`);
    const options = value.options.map((option, optionIndex) => parseOption(option, name, optionIndex));
    assertUnique(
      options.map((option) => option.id),
      `option id in property "${name}"`,
    );
    assertUnique(
      options.map((option) => normalizeName(option.name)),
      `option name in property "${name}"`,
    );
    return { id, name, type, options };
  }

  if (value.options !== undefined) throw invalidDatabase(`Property "${name}" of type ${type} cannot have options`);
  return { id, name, type };
}

function parseOption(value: unknown, propertyName: string, index: number): SelectOption {
  const where = `option ${index} of property "${propertyName}"`;
  if (!isPlainObject(value)) throw invalidDatabase(`${where} must be an object`);
  rejectUnknownKeys(value, OPTION_KEYS, where);
  return {
    id: requireUuid(value.id, `${where} id`),
    name: requireName(value.name, `${where} name`),
  };
}

function isPropertyType(value: unknown): value is PropertyType {
  return typeof value === 'string' && (PROPERTY_TYPES as readonly string[]).includes(value);
}

function requireUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isUuidV4(value)) {
    throw invalidDatabase(`${label} must be a lowercase UUID v4`);
  }
  return value;
}

function requireName(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.trim() !== value) {
    throw invalidDatabase(`${label} must be a non-empty string without leading or trailing whitespace`);
  }
  return value;
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw invalidDatabase(`Unknown key "${key}" in ${where}`);
  }
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw invalidDatabase(`Duplicate ${label}`);
}

function normalizeName(name: string): string {
  return name.normalize('NFC');
}

function caseInsensitiveName(name: string): string {
  return normalizeName(name).toLowerCase();
}

function invalidDatabase(message: string): NodusError {
  return new NodusError('INVALID_DATABASE', message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
