import { describe, expect, it } from 'vitest';
import { saveResultDisposition } from '../ui/src/saveResultDisposition.js';

describe('save result disposition', () => {
  it('keeps edits made while the matching note save was pending', () => {
    expect(saveResultDisposition('note-a', 'note-a', 4, 5)).toBe('keep-draft');
  });

  it('ignores a save response after another note becomes active', () => {
    expect(saveResultDisposition('note-a', 'note-b', 4, 4)).toBe('ignore');
    expect(saveResultDisposition('note-a', null, 4, 4)).toBe('ignore');
  });

  it('replaces the draft only when its note and revision still match', () => {
    expect(saveResultDisposition('note-a', 'note-a', 4, 4)).toBe('replace-draft');
  });
});
