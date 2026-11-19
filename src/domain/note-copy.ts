import { isTimestamp, validateNote, type Note } from './note.js';
import { isUuidV4 } from './ids.js';
import { normalizePageIcon } from './page-icon.js';
import { parser as markdownParser } from '@lezer/markdown';

/** The source fields permitted to flow into a future managed-note copy. */
export interface SupportedNoteCopyModel {
  readonly sourceId: string;
  readonly sourcePath: string;
  readonly sourceCreatedAt: string;
  readonly sourceUpdatedAt: string;
  readonly title: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly aliases: readonly string[];
  readonly icon: string | null;
}

/** In-memory copy intent. `note` intentionally has no destination path. */
export interface NoteCopyModel {
  readonly provenance: {
    readonly sourceId: string;
    readonly sourcePath: string;
    readonly sourceCreatedAt: string;
    readonly sourceUpdatedAt: string;
  };
  readonly note: {
    readonly id: string;
    readonly title: string;
    readonly body: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly tags: readonly string[];
    readonly aliases: readonly string[];
    readonly icon: string | null;
  };
}

export type NoteCopyRejectionCode =
  | 'INVALID_SOURCE'
  | 'PLAIN_MARKDOWN'
  | 'INVALID_IDENTITY'
  | 'INVALID_METADATA'
  | 'STRUCTURED_DATA'
  | 'UNCLASSIFIED_METADATA'
  | 'LOCAL_RESOURCE_REFERENCE'
  | 'UNCERTAIN_MARKUP'
  | 'INVALID_UNICODE';

export interface NoteCopyRejection {
  readonly code: NoteCopyRejectionCode;
  readonly message: string;
  readonly offset?: number;
}

export type NoteCopyValidationResult =
  | { readonly ok: true; readonly model: SupportedNoteCopyModel }
  | { readonly ok: false; readonly rejections: readonly NoteCopyRejection[] };

export interface NoteCopyModelOptions {
  /** Allocated by a future storage-owned operation and checked against its fresh inventory. */
  readonly copyId: string;
  /** One RFC 3339 UTC instant chosen for both creation and modification time. */
  readonly copyInstant: string;
  /** IDs from the same complete snapshot used to validate the source. */
  readonly existingIds: ReadonlySet<string>;
}

/**
 * Validates a parsed managed note and returns an isolated, read-only semantic
 * source model. This does not allocate a copy identity, serialize a copy, or
 * perform filesystem work. The caller must still validate uniqueness against
 * a complete vault snapshot before any later copy operation.
 */
export function validateNoteCopySource(input: unknown): NoteCopyValidationResult {
  if (!isNoteRecord(input)) return rejected('INVALID_SOURCE', 'Source note does not match the managed note shape.');
  const note = input;
  if (note.sourceFormat === 'plain-markdown') {
    return rejected('PLAIN_MARKDOWN', 'Plain Markdown notes are not supported for copying.');
  }

  const rejections: NoteCopyRejection[] = [];
  if (note.sourceFormat !== undefined) {
    rejections.push({ code: 'INVALID_SOURCE', message: 'Source note has an unsupported format marker.' });
  }
  if (typeof note.body !== 'string') {
    rejections.push({ code: 'INVALID_SOURCE', message: 'Source note body must be text.' });
  }
  if (typeof note.id !== 'string' || !isUuidV4(note.id)) {
    rejections.push({ code: 'INVALID_IDENTITY', message: 'Managed source identity must be a lowercase UUID v4.' });
  }

  try {
    validateNote(note);
  } catch (error) {
    rejections.push({
      code: 'INVALID_SOURCE',
      message: error instanceof Error ? error.message : 'Source note failed domain validation.',
    });
  }

  if (!isRecord(note.extraFrontmatter)) {
    rejections.push({ code: 'INVALID_METADATA', message: 'Source extension metadata must be a plain mapping.' });
  } else {
    if (Object.hasOwn(note.extraFrontmatter, 'nodus_data')) {
      rejections.push({ code: 'STRUCTURED_DATA', message: 'Notes with nodus_data, database membership, properties, or relations are not supported.' });
    }

    for (const key of Object.keys(note.extraFrontmatter).sort()) {
      if (key === 'nodus_data') continue;
      if (key !== 'icon') {
        rejections.push({
          code: 'UNCLASSIFIED_METADATA',
          message: `Extension metadata key "${key}" has no approved copy policy.`,
        });
        continue;
      }
      const icon = note.extraFrontmatter.icon;
      if (icon !== null && (typeof icon !== 'string' || !normalizePageIcon(icon).ok)) {
        rejections.push({ code: 'INVALID_METADATA', message: 'The supported icon metadata must be a valid string or null.' });
      }
    }
  }

  for (const [field, value] of [
    ['title', note.title], ['body', note.body],
    ...(Array.isArray(note.tags) ? note.tags.map((tag, index) => [`tags[${index}]`, tag] as const) : []),
    ...(Array.isArray(note.aliases) ? note.aliases.map((alias, index) => [`aliases[${index}]`, alias] as const) : []),
  ] as const) {
    if (typeof value === 'string' && !isUnicodeScalarString(value)) {
      rejections.push({ code: 'INVALID_UNICODE', message: `${field} contains an unpaired UTF-16 surrogate.` });
    }
  }

  if (typeof note.body === 'string' && isUnicodeScalarString(note.body)) {
    rejections.push(...findUnsupportedDependencies(note.body));
  }

  if (rejections.length > 0) return { ok: false, rejections: Object.freeze(rejections) };

  const iconValue = note.extraFrontmatter.icon;
  const normalizedIcon = normalizePageIcon(iconValue);
  if (!normalizedIcon.ok) {
    return rejected('INVALID_METADATA', 'The supported icon metadata must be a valid string or null.');
  }

  const model: SupportedNoteCopyModel = Object.freeze({
    sourceId: note.id,
    sourcePath: note.path,
    sourceCreatedAt: note.createdAt,
    sourceUpdatedAt: note.updatedAt,
    title: note.title,
    body: note.body,
    tags: Object.freeze([...note.tags]),
    aliases: Object.freeze([...note.aliases]),
    icon: normalizedIcon.value,
  });
  return { ok: true, model };
}

/** Builds only an immutable in-memory intent; it never writes or serializes a note. */
export function buildNoteCopyModel(input: unknown, options: unknown):
  | { readonly ok: true; readonly model: NoteCopyModel }
  | { readonly ok: false; readonly rejections: readonly NoteCopyRejection[] } {
  const sourceResult = validateNoteCopySource(input);
  if (!sourceResult.ok) return sourceResult;

  if (!isCopyModelOptions(options)) {
    return rejected('INVALID_SOURCE', 'Copy model requires a copy ID, copy instant, and identity inventory.');
  }

  const rejections: NoteCopyRejection[] = [];
  if (!isUuidV4(options.copyId) || options.copyId === sourceResult.model.sourceId) {
    rejections.push({ code: 'INVALID_IDENTITY', message: 'Copy identity must be a new lowercase UUID v4 distinct from the source.' });
  } else if (options.existingIds.has(options.copyId)) {
    rejections.push({ code: 'INVALID_IDENTITY', message: 'Copy identity already exists in the supplied vault identity inventory.' });
  }
  if (!isTimestamp(options.copyInstant)) {
    rejections.push({ code: 'INVALID_METADATA', message: 'Copy instant must be an RFC 3339 UTC timestamp ending in Z.' });
  }
  if (rejections.length > 0) return { ok: false, rejections: Object.freeze(rejections) };

  const source = sourceResult.model;
  const model: NoteCopyModel = Object.freeze({
    provenance: Object.freeze({
      sourceId: source.sourceId,
      sourcePath: source.sourcePath,
      sourceCreatedAt: source.sourceCreatedAt,
      sourceUpdatedAt: source.sourceUpdatedAt,
    }),
    note: Object.freeze({
      id: options.copyId,
      title: source.title,
      body: source.body,
      createdAt: options.copyInstant,
      updatedAt: options.copyInstant,
      tags: source.tags,
      aliases: source.aliases,
      icon: source.icon,
    }),
  });
  return { ok: true, model };
}

function findUnsupportedDependencies(body: string): NoteCopyRejection[] {
  const rejections: NoteCopyRejection[] = [];
  const tree = markdownParser.parse(body);
  tree.iterate({
    enter(node) {
      if (node.name === 'URL') {
        const destination = body.slice(node.from, node.to).trim();
        const classification = classifyDestination(destination);
        if (classification === 'local') {
          rejections.push({
            code: 'LOCAL_RESOURCE_REFERENCE',
            message: `Local Markdown destination "${destination}" is a dependent resource and is not supported.`,
            offset: node.from,
          });
        } else if (classification === 'uncertain') {
          rejections.push({
            code: 'UNCERTAIN_MARKUP',
            message: `Markdown destination "${destination}" uses a scheme without an approved copy policy.`,
            offset: node.from,
          });
        }
      } else if (node.name.startsWith('HTML')) {
        rejections.push({
          code: 'UNCERTAIN_MARKUP',
          message: 'HTML markup may contain local resource dependencies and is not supported for copying.',
          offset: node.from,
        });
      } else if ((node.name === 'Link' || node.name === 'Image') && /\]\(\s*(?:<\s*>)?\s*\)$/.test(body.slice(node.from, node.to))) {
        rejections.push({
          code: 'LOCAL_RESOURCE_REFERENCE',
          message: 'An empty relative Markdown destination depends on the source note location.',
          offset: node.from,
        });
      }
    },
  });
  return rejections;
}

function classifyDestination(destination: string): 'external' | 'local' | 'uncertain' {
  if (destination.startsWith('#') || destination.startsWith('//')) return 'external';
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(destination)?.[1]?.toLowerCase();
  if (scheme !== undefined) {
    if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') return 'external';
    if (scheme === 'file' || scheme === 'blob' || scheme === 'filesystem') return 'local';
    return 'uncertain';
  }
  return 'local';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNoteRecord(value: unknown): value is Note {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.path === 'string'
    && typeof value.body === 'string'
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
    && Array.isArray(value.tags) && value.tags.every((item) => typeof item === 'string')
    && Array.isArray(value.aliases) && value.aliases.every((item) => typeof item === 'string')
    && typeof value.extraFrontmatter === 'object' && value.extraFrontmatter !== null && !Array.isArray(value.extraFrontmatter)
    && (value.sourceFormat === undefined || value.sourceFormat === 'plain-markdown');
}

function isCopyModelOptions(value: unknown): value is NoteCopyModelOptions {
  if (!isRecord(value)
    || typeof value.copyId !== 'string'
    || typeof value.copyInstant !== 'string'
    || !(value.existingIds instanceof Set)) return false;
  return [...value.existingIds].every((id) => typeof id === 'string');
}

function isUnicodeScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function rejected(code: NoteCopyRejectionCode, message: string): { readonly ok: false; readonly rejections: readonly NoteCopyRejection[] } {
  return { ok: false, rejections: Object.freeze([{ code, message }]) };
}
