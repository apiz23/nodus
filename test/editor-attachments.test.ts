import { describe, expect, it } from 'vitest';
import type { UiAttachment } from '../src/ui-server/dto.js';
import { attachmentMarkdown, insertAttachmentMarkdown, relativeAttachmentPath } from '../ui/src/editor/attachmentMarkdown.js';

const base: UiAttachment = {
  id: '11111111-1111-4111-8111-111111111111', path: 'attachments/11111111-1111-4111-8111-111111111111-my-photo.png',
  name: 'my-photo.png', contentType: 'image/png', size: 20, references: [],
};

describe('portable attachment Markdown', () => {
  it('builds note-relative destinations from root and nested note paths', () => {
    expect(relativeAttachmentPath('notes/a.md', base.path)).toBe('../attachments/11111111-1111-4111-8111-111111111111-my-photo.png');
    expect(relativeAttachmentPath('a/b/c.md', 'a/files/doc.pdf')).toBe('../files/doc.pdf');
    expect(attachmentMarkdown('notes/a.md', base)).toBe(`![my-photo.png](../${base.path})`);
    expect(attachmentMarkdown('notes/a.md', { ...base, name: 'manual.pdf', contentType: 'application/pdf', path: base.path.replace('.png', '.pdf') })).toMatch(/^\[manual\.pdf\]\(/);
  });

  it('inserts multiple references at the preserved cursor and keeps surrounding draft text', () => {
    const source = 'before after';
    const result = insertAttachmentMarkdown(source, 7, ['![one](one.png)', '![two](two.png)']);
    expect(result.value).toBe('before after\n![one](one.png)\n![two](two.png)');
    expect(result.value.slice(result.cursor)).toBe('');
    expect(result.value.slice(0, result.cursor)).toContain('![two]');
  });
});
