import type { UiAttachment } from '../../../src/ui-server/dto.js';

export function relativeAttachmentPath(notePath: string, attachmentPath: string): string {
  const from = notePath.split('/').slice(0, -1).filter(Boolean);
  const to = attachmentPath.split('/').filter(Boolean);
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1;
  return [...Array(from.length - shared).fill('..'), ...to.slice(shared)].join('/');
}

export function attachmentMarkdown(notePath: string, attachment: UiAttachment): string {
  const destination = relativeAttachmentPath(notePath, attachment.path).split('/').map(encodeURIComponent).join('/');
  const label = attachment.name.replace(/([\\[\]])/g, '\\$1');
  return attachment.contentType.startsWith('image/') ? `![${label}](${destination})` : `[${label}](${destination})`;
}

export function insertAttachmentMarkdown(source: string, at: number, values: readonly string[]): { value: string; at: number; cursor: number; inserted: string } {
  if (values.length === 0) return { value: source, at, cursor: at, inserted: '' };
  // Insert the block at a line boundary so dropping into a word or existing
  // Markdown link cannot split the source construct and make it invalid.
  const lineEnd = source.indexOf('\n', at);
  const insertionAt = lineEnd < 0 ? source.length : lineEnd;
  const insertion = values.join('\n');
  const before = source.slice(0, insertionAt);
  const after = source.slice(insertionAt);
  const prefix = before.length > 0 && !before.endsWith('\n') ? '\n' : '';
  const suffix = after.length > 0 && !after.startsWith('\n') ? '\n' : '';
  const text = `${prefix}${insertion}${suffix}`;
  return { value: `${before}${text}${after}`, at: insertionAt, cursor: before.length + text.length, inserted: text };
}
