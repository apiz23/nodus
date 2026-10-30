export type TagOperation =
  | { type: 'add'; tag: string }
  | { type: 'remove'; tag: string }
  | { type: 'replace'; tags: string[] };

export type TagValidationCode = 'INVALID_TAG' | 'DUPLICATE_TAG';

export class TagValidationError extends Error {
  constructor(readonly code: TagValidationCode, message: string) {
    super(message);
    this.name = 'TagValidationError';
  }
}

/** Normalize only an explicit tag edit. Parsed legacy tags remain unchanged. */
export function normalizeTag(value: unknown): string {
  if (typeof value !== 'string') throw new TagValidationError('INVALID_TAG', 'A tag must be a string.');
  const normalized = value.normalize('NFC').trim();
  if (normalized === '') throw new TagValidationError('INVALID_TAG', 'A tag cannot be empty.');
  return normalized;
}

export function tagIdentity(value: string): string {
  return normalizeTag(value).toLowerCase();
}

/** Normalize an explicitly supplied list, preserving the first stored spelling for matches. */
export function normalizeTagList(values: readonly unknown[], existing: readonly string[] = []): string[] {
  const existingSpellings = new Map<string, string>();
  for (const tag of existing) {
    const identity = tagIdentity(tag);
    if (!existingSpellings.has(identity)) existingSpellings.set(identity, tag);
  }

  const seen = new Set<string>();
  return values.map((value) => {
    const normalized = normalizeTag(value);
    const identity = tagIdentity(normalized);
    if (seen.has(identity)) throw new TagValidationError('DUPLICATE_TAG', `The tag "${normalized}" is already in this list.`);
    seen.add(identity);
    return existingSpellings.get(identity) ?? normalized;
  });
}

export function addTag(tags: readonly string[], value: unknown): string[] {
  const normalized = normalizeTag(value);
  const identity = tagIdentity(normalized);
  if (tags.some((tag) => tagIdentity(tag) === identity)) {
    throw new TagValidationError('DUPLICATE_TAG', `The tag "${normalized}" already exists on this note.`);
  }
  return [...tags, normalized];
}

/** Removing a legacy duplicate removes that tag identity in one explicit action. */
export function removeTag(tags: readonly string[], value: unknown): string[] {
  const identity = tagIdentity(normalizeTag(value));
  return tags.filter((tag) => tagIdentity(tag) !== identity);
}
