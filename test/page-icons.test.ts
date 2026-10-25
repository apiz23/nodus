import { describe, expect, it } from 'vitest';
import { PAGE_ICONS } from '../ui/src/pageIcons.js';
import { normalizePageIcon } from '../src/ui-server/page-icon.js';

describe('page icon choices', () => {
  it('contains unique valid icons with labels', () => {
    const emojis = PAGE_ICONS.map((choice) => choice.emoji);
    expect(new Set(emojis).size).toBe(emojis.length);
    for (const choice of PAGE_ICONS) {
      expect(choice.name.trim()).not.toBe('');
      expect(normalizePageIcon(choice.emoji).ok).toBe(true);
    }
  });
});
