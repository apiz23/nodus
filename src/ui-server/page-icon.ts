export const PAGE_ICON_MAX_CODE_POINTS = 8;

export function readPageIcon(extra: Record<string, unknown>): string | null {
  const normalized = normalizePageIcon(extra.icon);
  if (!normalized.ok) return null;
  return normalized.value;
}

export function normalizePageIcon(
  value: unknown,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value !== 'string') {
    return { ok: false, message: 'Icon must be a string or null' };
  }
  const trimmed = value.trim();
  if (trimmed === '') return { ok: true, value: null };
  if (trimmed !== value) {
    return { ok: false, message: 'Icon must not have leading or trailing whitespace' };
  }
  if (/[\u0000-\u001F\u007F-\u009F]/.test(trimmed)) {
    return { ok: false, message: 'Icon contains control characters' };
  }
  if (Array.from(trimmed).length > PAGE_ICON_MAX_CODE_POINTS) {
    return { ok: false, message: `Icon exceeds ${PAGE_ICON_MAX_CODE_POINTS} code points` };
  }
  return { ok: true, value: trimmed };
}

export function applyPageIcon(
  extra: Record<string, unknown>,
  icon: string | null,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...extra };
  if (icon === null) {
    delete next.icon;
  } else {
    next.icon = icon;
  }
  return next;
}
