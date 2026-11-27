/**
 * `nodus-view` fenced-block directive.
 *
 * A normal Markdown note can embed a saved database view by writing a standard
 * fenced code block:
 *
 * ```nodus-view
 * database: <database-uuid>
 * view: <view-uuid>
 * height: 320
 * ```
 *
 * The fence is ordinary Markdown text: it needs no new vault file, no schema
 * version and no migration. Older Nodus builds (and other Markdown editors)
 * simply show it as a code block. Database rows stay in their notes; this
 * directive only references a database and one of its saved views.
 */

export const NODUS_VIEW_FENCE_LANGUAGE = 'nodus-view';
export const DEFAULT_EMBED_HEIGHT = 320;
export const MIN_EMBED_HEIGHT = 160;
export const MAX_EMBED_HEIGHT = 1200;
const MAX_DIRECTIVE_LENGTH = 2048;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface NodusViewSpec {
  databaseId: string;
  viewId: string;
  height: number;
}

export type NodusViewParseResult =
  | { ok: true; spec: NodusViewSpec }
  | { ok: false; message: string };

export function parseNodusViewDirective(source: string): NodusViewParseResult {
  if (source.length > MAX_DIRECTIVE_LENGTH) return { ok: false, message: `Embed directive is longer than ${MAX_DIRECTIVE_LENGTH} characters.` };
  const values = new Map<string, string>();
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').trim();
    if (line === '') continue;
    const separator = line.indexOf(':');
    if (separator < 1) return { ok: false, message: `Line ${index + 1} is not "key: value".` };
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key !== 'database' && key !== 'view' && key !== 'height') {
      return { ok: false, message: `Unknown key "${key}". Use database, view or height.` };
    }
    if (values.has(key)) return { ok: false, message: `Key "${key}" appears twice.` };
    if (value === '') return { ok: false, message: `Key "${key}" has no value.` };
    values.set(key, value);
  }

  const databaseId = values.get('database');
  const viewId = values.get('view');
  if (databaseId === undefined) return { ok: false, message: 'Missing "database: <uuid>".' };
  if (viewId === undefined) return { ok: false, message: 'Missing "view: <uuid>".' };
  if (!UUID_V4.test(databaseId)) return { ok: false, message: 'database must be a lowercase UUID v4.' };
  if (!UUID_V4.test(viewId)) return { ok: false, message: 'view must be a lowercase UUID v4.' };

  const rawHeight = values.get('height');
  let height = DEFAULT_EMBED_HEIGHT;
  if (rawHeight !== undefined) {
    if (!/^\d{1,4}$/.test(rawHeight)) return { ok: false, message: 'height must be a whole number of pixels.' };
    height = Number(rawHeight);
    if (height < MIN_EMBED_HEIGHT || height > MAX_EMBED_HEIGHT) {
      return { ok: false, message: `height must be between ${MIN_EMBED_HEIGHT} and ${MAX_EMBED_HEIGHT}.` };
    }
  }

  return { ok: true, spec: { databaseId, viewId, height } };
}

/** Serialize a directive body for insertion into a note. */
export function serializeNodusViewDirective(spec: Pick<NodusViewSpec, 'databaseId' | 'viewId' | 'height'>): string {
  const lines = [`database: ${spec.databaseId}`, `view: ${spec.viewId}`];
  if (spec.height !== DEFAULT_EMBED_HEIGHT) lines.push(`height: ${spec.height}`);
  return lines.join('\n');
}

/** Pick the referenced saved view, or null when the database does not contain it. */
export function findEmbeddedView<T extends { view: { id: string } }>(views: readonly T[], viewId: string): T | null {
  return views.find((candidate) => candidate.view.id === viewId) ?? null;
}
