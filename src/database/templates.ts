import { NodusError } from '../domain/errors.js';
import { isUuidV4 } from '../domain/ids.js';
import type { DatabaseDefinition } from './schema.js';
import { parseDatabase, serializeDatabase } from './schema.js';
import type { DatabaseView } from './database-view.js';
import { parseDatabaseView, validateViewReferences } from './database-view.js';
import { projectNoteProperties } from './note-properties.js';

export const TEMPLATE_FORMAT = 'nodus-templates';
export const TEMPLATE_VERSION = 1;
export type TemplateVariable = { name: string; type: 'text' | 'date' | 'number'; required?: boolean; default?: string | number };
export interface NoteTemplate {
  id: string; type: 'note'; name: string; description?: string; title: string; body: string;
  tags: string[]; aliases: string[]; icon?: string; frontmatter: Record<string, unknown>;
  variables: TemplateVariable[]; createdAt: string; updatedAt: string;
}
export interface DatabaseTemplate {
  id: string; type: 'database'; name: string; description?: string; database: DatabaseDefinition;
  views: DatabaseView[]; starterRows: Array<{ title: string; values: Record<string, unknown> }>;
  createdAt: string; updatedAt: string;
}
export type NodusTemplate = NoteTemplate | DatabaseTemplate;

export function parseTemplates(text: string): NodusTemplate[] {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (error) { throw invalid(`Template file is not valid JSON: ${(error as Error).message}`); }
  if (!object(raw) || raw.format !== TEMPLATE_FORMAT || raw.version !== TEMPLATE_VERSION || !Array.isArray(raw.templates)) throw invalid('Template file must use nodus-templates version 1 and contain a templates array.');
  exact(raw, ['format', 'version', 'templates'], 'template catalog');
  const templates = raw.templates.map(parseTemplate);
  unique(templates.map((item) => item.id), 'template ID');
  return templates;
}
export function serializeTemplates(templates: NodusTemplate[]): string {
  const normalized = parseTemplates(JSON.stringify({ format: TEMPLATE_FORMAT, version: TEMPLATE_VERSION, templates }));
  return `${JSON.stringify({ format: TEMPLATE_FORMAT, version: TEMPLATE_VERSION, templates: normalized }, null, 2)}\n`;
}
export function parseTemplate(value: unknown): NodusTemplate {
  if (!object(value)) throw invalid('Template must be an object.');
  const common = ['id', 'type', 'name', 'description', 'createdAt', 'updatedAt'];
  if (value.type === 'note') {
    exact(value, [...common, 'title', 'body', 'tags', 'aliases', 'icon', 'frontmatter', 'variables'], 'note template');
    if (!Array.isArray(value.tags) || !value.tags.every(string) || !Array.isArray(value.aliases) || !value.aliases.every(string) || !Array.isArray(value.variables)) throw invalid('Note template tags, aliases, and variables must be arrays of valid values.');
    if (!object(value.frontmatter)) throw invalid('Note template frontmatter must be an object.');
    for (const key of Object.keys(value.frontmatter)) if (['title', 'tags', 'aliases', 'nodus', 'nodus_data', '__proto__', 'constructor', 'prototype'].includes(key)) throw invalid(`Frontmatter key "${key}" is reserved.`);
    if (value.icon !== undefined && !string(value.icon)) throw invalid('Template icon must be a string.');
    if (value.variables.length > 50) throw invalid('Note templates support at most 50 variables.');
    const variables = value.variables.map(parseVariable);
    unique(variables.map((item) => item.name), 'variable name');
    if (!string(value.title) || value.title.length > 500 || !string(value.body) || value.body.length > 1_000_000) throw invalid('Template title must be up to 500 characters and body up to 1000000 characters.');
    return { id: uuid(value.id, 'template id'), type: 'note', name: name(value.name), ...(value.description === undefined ? {} : { description: description(value.description) }), title: value.title, body: value.body, tags: value.tags, aliases: value.aliases, ...(value.icon === undefined ? {} : { icon: value.icon }), frontmatter: value.frontmatter, variables, createdAt: iso(value.createdAt), updatedAt: iso(value.updatedAt) };
  }
  if (value.type === 'database') {
    exact(value, [...common, 'database', 'views', 'starterRows'], 'database template');
    let database: DatabaseDefinition;
    try { database = parseDatabase(serializeDatabase(value.database as DatabaseDefinition)); } catch (error) { throw invalid(`Database template schema is invalid: ${message(error)}`); }
    if (!Array.isArray(value.views) || value.views.length > 100 || !Array.isArray(value.starterRows) || value.starterRows.length > 1000) throw invalid('Database template supports up to 100 saved views and 1000 starter rows.');
    const views = value.views.map((view) => { try { const parsed = parseDatabaseView(JSON.stringify(view)); validateViewReferences(parsed, database); return parsed; } catch (error) { throw invalid(`Database template view is invalid: ${message(error)}`); } });
    if (views.some((view) => view.databaseId !== database.id)) throw invalid('Every template view must reference its template database.');
    unique(views.map((view) => view.id), 'view ID');
    const starterRows = value.starterRows.map((row, index) => {
      if (!object(row) || !string(row.title) || !object(row.values)) throw invalid(`starterRows[${index}] is invalid.`);
      return { title: row.title, values: row.values };
    });
    for (const row of starterRows) {
      const projection = projectNoteProperties({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', path: 'notes/template-validation.md', extraFrontmatter: { nodus_data: { format: 'nodus-note-properties', version: 1, databases: { [database.id]: row.values } } } }, new Map([[database.id, database]]));
      if (projection.issues.length) throw invalid(`Starter row "${row.title}" is invalid: ${projection.issues.map((issue) => issue.message).join(' ')}`);
    }
    return { id: uuid(value.id, 'template id'), type: 'database', name: name(value.name), ...(value.description === undefined ? {} : { description: description(value.description) }), database, views, starterRows, createdAt: iso(value.createdAt), updatedAt: iso(value.updatedAt) };
  }
  throw invalid('Template type must be note or database.');
}
export function resolveNoteTemplate(template: NoteTemplate, supplied: Record<string, unknown> = {}): { title: string; body: string; tags: string[]; aliases: string[]; icon?: string; frontmatter: Record<string, unknown> } {
  const vars = new Map(template.variables.map((item) => [item.name, item]));
  for (const key of Object.keys(supplied)) if (!vars.has(key)) throw invalid(`Unknown template variable "${key}".`);
  const values: Record<string, string> = {};
  for (const variable of template.variables) {
    const value = supplied[variable.name] ?? variable.default;
    if (value === undefined || value === '') { if (variable.required) throw invalid(`Template variable "${variable.name}" is required.`); values[variable.name] = ''; continue; }
    if (variable.type === 'text') { if (!string(value) || value.length > 10000) throw invalid(`Template variable "${variable.name}" must be text up to 10000 characters.`); values[variable.name] = value; }
    else if (variable.type === 'number') { const n = typeof value === 'number' ? value : Number(value); if (!Number.isFinite(n)) throw invalid(`Template variable "${variable.name}" must be a finite number.`); values[variable.name] = String(n); }
    else { if (!string(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw invalid(`Template variable "${variable.name}" must be a date in YYYY-MM-DD format.`); values[variable.name] = value; }
  }
  const render = (text: string) => {
    const result = text.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_match, key: string) => { if (!vars.has(key)) throw invalid(`Unknown placeholder "${key}".`); return values[key]!; });
    if (/\{\{[^{}]*\}\}/.test(result)) throw invalid('Template contains an invalid placeholder.');
    return result;
  };
  return { title: render(template.title), body: render(template.body), tags: [...template.tags], aliases: template.aliases.map(render), ...(template.icon === undefined ? {} : { icon: render(template.icon) }), frontmatter: Object.fromEntries(Object.entries(template.frontmatter).map(([key, value]) => [key, typeof value === 'string' ? render(value) : value])) };
}
function parseVariable(value: unknown): TemplateVariable {
  if (!object(value)) throw invalid('Template variable must be an object.');
  exact(value, ['name', 'type', 'required', 'default'], 'template variable');
  if (!string(value.name) || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value.name) || !['text', 'date', 'number'].includes(String(value.type))) throw invalid('Template variable name or type is invalid.');
  if (value.required !== undefined && typeof value.required !== 'boolean') throw invalid('Template variable required must be boolean.');
  if (value.default !== undefined && !['string', 'number'].includes(typeof value.default)) throw invalid('Template variable default must be text or number.');
  return { name: value.name, type: value.type as TemplateVariable['type'], ...(value.required === undefined ? {} : { required: value.required }), ...(value.default === undefined ? {} : { default: value.default as string | number }) };
}
function object(value: unknown): value is Record<string, any> { return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function exact(value: Record<string, any>, keys: string[], where: string) { for (const key of Object.keys(value)) if (!keys.includes(key)) throw invalid(`${where} contains unsupported field "${key}".`); }
function unique(items: string[], label: string) { if (new Set(items).size !== items.length) throw invalid(`Duplicate ${label}.`); }
function uuid(value: unknown, where: string): string { if (typeof value !== 'string' || !isUuidV4(value)) throw invalid(`${where} must be a lowercase UUID v4.`); return value; }
function string(value: unknown): value is string { return typeof value === 'string'; }
function name(value: unknown): string { if (!string(value) || !value.trim() || value.length > 120) throw invalid('Template name must be 1–120 characters.'); return value.trim(); }
function description(value: unknown): string { if (!string(value) || value.length > 2000) throw invalid('Template description must be up to 2000 characters.'); return value; }
function iso(value: unknown): string { if (!string(value) || Number.isNaN(Date.parse(value))) throw invalid('Template timestamps must be valid dates.'); return value; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function invalid(message: string) { return new NodusError('INVALID_FIELD', message); }
