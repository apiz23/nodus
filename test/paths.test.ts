import { describe, expect, it } from 'vitest';
import { validateNotePath } from '../src/domain/paths.js';
import { errorCode } from './helpers.js';

describe('validateNotePath', () => {
  it.each(['notes/a/b.md', 'root.md', 'Notes/Café.md', 'notes/日本語.md'])('accepts %s', (path) => {
    expect(validateNotePath(path)).toBe(path);
  });

  it.each([
    ['absolute POSIX path', '/abs/a.md'],
    ['drive letter with slash', 'C:/a.md'],
    ['drive letter without slash', 'C:a.md'],
    ['colon in segment', 'notes/a:b.md'],
    ['parent traversal', 'notes/../x.md'],
    ['current-directory segment', './x.md'],
    ['backslash separator', 'notes\\a.md'],
    ['empty segment', 'notes//a.md'],
    ['trailing slash', 'notes/'],
    ['missing extension', 'notes/a.txt'],
    ['only extension', '.md'],
    ['reserved device name', 'CON.md'],
    ['reserved device name in folder', 'nul/x.md'],
    ['reserved COM port', 'notes/com1.md'],
    ['reserved LPT port', 'lpt9.md'],
    ['control character', 'a\u0000.md'],
    ['trailing space in segment', 'notes/a.md '],
    ['trailing dot in segment', 'notes./a.md'],
    ['empty string', ''],
  ])('rejects %s', (_label, path) => {
    expect(errorCode(() => validateNotePath(path))).toBe('UNSAFE_PATH');
  });

  it('rejects paths longer than 260 characters', () => {
    const long = `${'a'.repeat(256)}/b.md`;
    expect(long.length).toBeGreaterThan(260);
    expect(errorCode(() => validateNotePath(long))).toBe('UNSAFE_PATH');
  });
});
