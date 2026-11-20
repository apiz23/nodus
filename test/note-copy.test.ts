import { describe, expect, it } from 'vitest';
import { parseNote } from '../src/format/note-format.js';
import { buildNoteCopyModel, validateNoteCopySource } from '../src/domain/note-copy.js';

const ID = '6f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c';
const COPY_ID = '7f1c2a9e-3b7d-4c8e-9f0a-1d2e3f4a5b6c';
const NOW = '2026-11-16T09:00:00Z';

function managed(body = 'Body with [[A note]]\n'): ReturnType<typeof parseNote> {
  return parseNote(`---\ntitle: Source\ntags:\n  - planning\naliases:\n  - Older name\nicon: 📘\nnodus:\n  version: 1\n  id: ${ID}\n  createdAt: ${NOW}\n  updatedAt: ${NOW}\n---\n${body}`, 'notes/source.md');
}

function codes(result: { readonly ok: true; readonly model: unknown } | { readonly ok: false; readonly rejections: readonly { readonly code: string }[] }): string[] {
  return result.ok ? [] : result.rejections.map((item) => item.code);
}

describe('managed note copy model and dependency validation', () => {
  it('returns an isolated semantic model for a supported managed note', () => {
    const source = managed('Keep [[Target|label]] unchanged.\n');
    const result = validateNoteCopySource(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model).toEqual({
      sourceId: ID,
      sourcePath: 'notes/source.md',
      sourceCreatedAt: NOW,
      sourceUpdatedAt: NOW,
      title: 'Source',
      body: 'Keep [[Target|label]] unchanged.\n',
      tags: ['planning'],
      aliases: ['Older name'],
      icon: '📘',
    });
    expect(Object.isFrozen(result.model)).toBe(true);
    expect(Object.isFrozen(result.model.tags)).toBe(true);
    expect(() => (result.model.tags as string[]).push('mutated')).toThrow();
    expect(source.tags).toEqual(['planning']);
    expect(source.body).toBe('Keep [[Target|label]] unchanged.\n');
  });

  it('builds a pure copy intent with a distinct ID, copy timestamps, and separate source provenance', () => {
    const source = managed('[[Target]]\n');
    const result = buildNoteCopyModel(source, { copyId: COPY_ID, copyInstant: NOW, existingIds: new Set([ID]) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model).toEqual({
      provenance: { sourceId: ID, sourcePath: 'notes/source.md', sourceCreatedAt: NOW, sourceUpdatedAt: NOW },
      note: {
        id: COPY_ID, title: 'Source', body: '[[Target]]\n', createdAt: NOW, updatedAt: NOW,
        tags: ['planning'], aliases: ['Older name'], icon: '📘',
      },
    });
    expect('path' in result.model.note).toBe(false);
    expect(Object.isFrozen(result.model)).toBe(true);
    expect(Object.isFrozen(result.model.note.tags)).toBe(true);
    expect(source.id).toBe(ID);
    expect(source.body).toBe('[[Target]]\n');
  });

  it('rejects invalid, source-equal, or already-used copy identities and invalid timestamps', () => {
    expect(codes(buildNoteCopyModel(managed(), { copyId: 'bad', copyInstant: NOW, existingIds: new Set([ID]) }))).toContain('INVALID_IDENTITY');
    expect(codes(buildNoteCopyModel(managed(), { copyId: ID, copyInstant: NOW, existingIds: new Set([ID]) }))).toContain('INVALID_IDENTITY');
    expect(codes(buildNoteCopyModel(managed(), { copyId: COPY_ID, copyInstant: 'tomorrow', existingIds: new Set([ID, COPY_ID]) }))).toEqual(['INVALID_IDENTITY', 'INVALID_METADATA']);
    expect(codes(buildNoteCopyModel(managed(), null as unknown as Parameters<typeof buildNoteCopyModel>[1]))).toContain('INVALID_SOURCE');
  });

  it('keeps outgoing wiki-link text and allows external Markdown links', () => {
    const result = validateNoteCopySource(managed('[[Unresolved]] and [site](https://example.com)\n'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.model.body).toBe('[[Unresolved]] and [site](https://example.com)\n');
  });

  it('rejects plain Markdown even when its derived identity is UUID-shaped', () => {
    const plain = parseNote('Plain body\n', 'notes/plain.md');
    expect(codes(validateNoteCopySource(plain))).toEqual(['PLAIN_MARKDOWN']);
  });

  it.each([
    ['inline local link', '[note](./other.md)'],
    ['local image', '![diagram](../attachments/diagram.png)'],
    ['reference definition', '[diagram][asset]\n\n[asset]: attachments/missing.png'],
    ['absolute local reference', '[file](/vault/file.pdf)'],
    ['file URI', '[file](file:///vault/file.pdf)'],
    ['empty relative destination', '[same note]()'],
  ])('rejects %s as a dependent local resource', (_name, body) => {
    const result = validateNoteCopySource(managed(body));
    expect(codes(result)).toContain('LOCAL_RESOURCE_REFERENCE');
  });

  it('rejects HTML markup because local resource attributes are not classified', () => {
    expect(codes(validateNoteCopySource(managed('<img src="./image.png">')))).toContain('UNCERTAIN_MARKUP');
    expect(codes(validateNoteCopySource(managed('<a href="./other.md">local</a>')))).toContain('UNCERTAIN_MARKUP');
  });

  it('rejects unknown URI schemes whose resource semantics are not approved', () => {
    expect(codes(validateNoteCopySource(managed('[resource](custom:opaque-id)')))).toContain('UNCERTAIN_MARKUP');
  });

  it('does not mistake fenced or inline code examples for dependencies', () => {
    const body = '`![x](./image.png)`\n\n```html\n<img src="local.png">\n```\n';
    expect(validateNoteCopySource(managed(body)).ok).toBe(true);
  });

  it('rejects structured note data before copying any database membership or relation values', () => {
    const source = { ...managed(), extraFrontmatter: { nodus_data: { format: 'nodus-note-properties', version: 1, databases: {} } } };
    expect(codes(validateNoteCopySource(source))).toContain('STRUCTURED_DATA');
  });

  it('rejects unknown extension metadata deterministically, including nested identity-like values', () => {
    const source = { ...managed(), extraFrontmatter: { workspace: { id: 'stable-id' }, pluginState: ['x'] } };
    const first = validateNoteCopySource(source);
    const second = validateNoteCopySource(source);
    expect(first).toEqual(second);
    expect(codes(first)).toEqual(['UNCLASSIFIED_METADATA', 'UNCLASSIFIED_METADATA']);
  });

  it('rejects malformed identity, metadata, and malformed object inputs', () => {
    expect(codes(validateNoteCopySource(null))).toEqual(['INVALID_SOURCE']);
    expect(codes(validateNoteCopySource({ ...managed(), id: 'not-a-uuid' }))).toContain('INVALID_IDENTITY');
    expect(codes(validateNoteCopySource({ ...managed(), tags: ['ok', 7] }))).toContain('INVALID_SOURCE');
    expect(codes(validateNoteCopySource({ ...managed(), body: 7 }))).toContain('INVALID_SOURCE');
    expect(codes(validateNoteCopySource({ ...managed(), extraFrontmatter: { icon: 17 } }))).toContain('INVALID_METADATA');
    expect(codes(validateNoteCopySource({ ...managed(), extraFrontmatter: Object.create({ inherited: 'x' }) }))).toContain('INVALID_METADATA');
  });

  it('rejects unpaired surrogates rather than allowing UTF-8 replacement during later serialization', () => {
    expect(codes(validateNoteCopySource(managed(`bad \ud800 text`)))).toContain('INVALID_UNICODE');
  });

  it('leaves malformed YAML rejection to the existing strict parser', () => {
    expect(() => parseNote(`---\ntitle: [bad\nnodus:\n  version: 1\n  id: ${ID}\n  createdAt: ${NOW}\n  updatedAt: ${NOW}\n---\nBody`, 'bad.md')).toThrow();
  });
});
