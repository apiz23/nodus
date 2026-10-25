import { describe, expect, it } from 'vitest';
import {
  PAGE_ICON_MAX_CODE_POINTS,
  applyPageIcon,
  normalizePageIcon,
  readPageIcon,
} from '../src/ui-server/page-icon.js';

describe('page icon', () => {
  it('reads a valid icon', () => {
    expect(readPageIcon({ icon: '📘' })).toBe('📘');
  });

  it('returns null when icon is absent', () => {
    expect(readPageIcon({})).toBeNull();
  });

  it('returns null for an invalid external value while preserving it', () => {
    const extra = { icon: 123, project: 'Research' };
    expect(readPageIcon(extra)).toBeNull();
    expect(extra.icon).toBe(123);
  });

  it('normalizes null to remove', () => {
    expect(normalizePageIcon(null)).toEqual({ ok: true, value: null });
  });

  it('normalizes a whitespace-only icon to remove', () => {
    expect(normalizePageIcon('   ')).toEqual({ ok: true, value: null });
  });

  it('rejects leading or trailing whitespace', () => {
    const result = normalizePageIcon(' 📘');
    expect(result.ok).toBe(false);
  });

  it('rejects control characters', () => {
    const result = normalizePageIcon('📘\n');
    expect(result.ok).toBe(false);
  });

  it('rejects icons that are too long', () => {
    const result = normalizePageIcon('🇦🇧🇨🇩🇪🇫🇬🇭🇮');
    expect(result.ok).toBe(false);
  });

  it('accepts icons up to the code point limit', () => {
    const result = normalizePageIcon('🇦🇧🇨🇩🇪🇫🇬🇭');
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) throw new Error('expected a valid icon');
    expect(result.value.length).toBeGreaterThan(0);
  });

  it('applies a string icon', () => {
    expect(applyPageIcon({ project: 'Research' }, '📘')).toEqual({ project: 'Research', icon: '📘' });
  });

  it('removes the icon without touching other keys', () => {
    expect(applyPageIcon({ icon: '📘', project: 'Research' }, null)).toEqual({ project: 'Research' });
  });
});
