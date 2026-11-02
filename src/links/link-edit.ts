import {
  isValidLinkTarget,
  parseWikiLinks,
  resolveLink,
  type LinkableNote,
} from './wikilink.js';

export interface WikiLinkOccurrence {
  start: number;
  end: number;
  target: string;
  /** Present only when the source contains explicit display text. */
  display?: string;
}

export interface WikiLinkReplacement {
  target: string;
  /** Omit to preserve the source display text. */
  display?: string;
}

export interface RewrittenWikiLink {
  body: string;
  raw: string;
  display?: string;
}

export interface ChosenLinkTarget {
  /** ID-pinned or title target, ready to place between `[[` and `]]`. */
  target: string;
  pinned: boolean;
}

/** A stable-ID target survives renames and moves; a title target does not. */
export function chooseLinkTarget(
  replacement: Pick<LinkableNote, 'id' | 'title'> & { aliases?: readonly string[] },
  notes: readonly LinkableNote[],
  pin = true,
): ChosenLinkTarget {
  if (pin) return { target: replacement.id, pinned: true };
  if (!isValidLinkTarget(replacement.title)) return { target: replacement.id, pinned: true };
  const resolution = resolveLink(replacement.title, notes);
  if (resolution.status === 'resolved' && resolution.noteId === replacement.id) {
    return { target: replacement.title, pinned: false };
  }
  // Falling back to the stable ID avoids creating a new ambiguous or broken
  // link when the display title is shared by another note.
  return { target: replacement.id, pinned: true };
}

/**
 * Replace exactly one existing wiki-link occurrence. Offsets, target, and
 * optional display text are re-verified against the source body so a stale
 * discovery response cannot rewrite a different link that moved.
 */
export function rewriteWikiLink(
  body: string,
  occurrence: WikiLinkOccurrence,
  replacement: WikiLinkReplacement,
): RewrittenWikiLink {
  if (!Number.isSafeInteger(occurrence.start) || !Number.isSafeInteger(occurrence.end)) {
    throw new TypeError('Wiki-link offsets must be integers.');
  }
  if (occurrence.start < 0 || occurrence.end <= occurrence.start || occurrence.end > body.length) {
    throw new TypeError('Wiki-link offsets are outside the note body.');
  }
  if (!isValidLinkTarget(replacement.target)) {
    throw new TypeError('Replacement target must be a non-empty single-line link target without brackets or pipes.');
  }

  const slice = body.slice(occurrence.start, occurrence.end);
  const parsed = parseExactLink(slice);
  if (parsed === null) throw new TypeError('The selected range is not exactly one wiki link.');
  if (parsed.target !== occurrence.target) {
    throw new TypeError('The wiki-link target no longer matches the repair request.');
  }
  if (occurrence.display !== undefined && parsed.display !== occurrence.display) {
    throw new TypeError('The wiki-link display text no longer matches the repair request.');
  }

  const display = replacement.display ?? parsed.display;
  if (display !== undefined && !isValidDisplay(display)) {
    throw new TypeError('Wiki-link display text must be non-empty and contain no brackets or line breaks.');
  }
  const raw = display === undefined
    ? `[[${replacement.target}]]`
    : `[[${replacement.target}|${display}]]`;
  return {
    body: `${body.slice(0, occurrence.start)}${raw}${body.slice(occurrence.end)}`,
    raw,
    ...(display === undefined ? {} : { display }),
  };
}

/** Return a safe display string, or undefined when the value cannot be represented as link text. */
export function sanitizeLinkDisplay(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed !== '' && !/[\[\]\r\n]/.test(trimmed) ? trimmed : undefined;
}

function parseExactLink(slice: string): { target: string; display?: string } | null {
  // Discovery supplies offsets from the same scanner, so an exact slice must
  // contain exactly one whole link. Re-parsing verifies the stale-response
  // guard instead of trusting the caller's target text.
  const links = parseWikiLinks(slice);
  if (links.length !== 1) return null;
  const link = links[0]!;
  if (link.start !== 0 || link.end !== slice.length) return null;
  return { target: link.target, ...(link.display === undefined ? {} : { display: link.display }) };
}

function isValidDisplay(display: string): boolean {
  return display !== '' && !/[\[\]\r\n]/.test(display);
}
