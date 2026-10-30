import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { StorageError } from '../errors.js';
import { markdownReferencesPath } from '../../links/markdown-paths.js';

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_BATCH_MAX_BYTES = 25 * 1024 * 1024;
export const ATTACHMENT_BATCH_MAX_FILES = 10;
export const ATTACHMENTS_DIR = 'attachments';

export interface AttachmentInfo {
  id: string;
  path: string;
  name: string;
  contentType: string;
  size: number;
  references: string[];
}

const TYPES: Record<string, { contentType: string; matches(bytes: Uint8Array): boolean }> = {
  '.png': { contentType: 'image/png', matches: (bytes) => bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a },
  '.jpg': { contentType: 'image/jpeg', matches: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  '.jpeg': { contentType: 'image/jpeg', matches: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  '.gif': { contentType: 'image/gif', matches: (bytes) => ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a' },
  '.webp': { contentType: 'image/webp', matches: (bytes) => ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP' },
  '.avif': { contentType: 'image/avif', matches: (bytes) => ascii(bytes, 4, 4) === 'ftyp' && /^(?:avif|avis)$/.test(ascii(bytes, 8, 4)) },
  '.pdf': { contentType: 'application/pdf', matches: (bytes) => ascii(bytes, 0, 5) === '%PDF-' },
  '.txt': { contentType: 'text/plain; charset=utf-8', matches: (bytes) => {
    if (bytes.includes(0)) return false;
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true; } catch { return false; }
  } },
};

export function attachmentPathId(path: string): string | undefined {
  const match = /^attachments\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-[a-z0-9_-]{1,64}\.(?:png|jpe?g|gif|webp|avif|pdf|txt)$/.exec(path);
  return match?.[1];
}

export function createAttachmentPath(originalName: string): { id: string; path: string; name: string } {
  if (typeof originalName !== 'string' || originalName.length < 1 || originalName.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(originalName) || basename(originalName) !== originalName) {
    throw new StorageError('INVALID_INPUT', 'Choose a file with a valid filename.');
  }
  const extension = extname(originalName).toLowerCase();
  if (!(extension in TYPES)) throw new StorageError('INVALID_INPUT', 'Supported files are PNG, JPEG, GIF, WebP, AVIF, PDF, and UTF-8 text.');
  const stem = originalName.slice(0, originalName.length - extname(originalName).length)
    .normalize('NFKD').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'file';
  const id = randomUUID();
  return { id, path: `${ATTACHMENTS_DIR}/${id}-${stem}${extension}`, name: `${stem}${extension}` };
}

export function validateAttachmentBytes(path: string, bytes: Uint8Array): { id: string; name: string; contentType: string } {
  const id = attachmentPathId(path);
  if (!id || path.split('/').some((part) => part.startsWith('.') || part === '..') || path.includes('\\') || /[\u0000-\u001f\u007f:]/.test(path)) {
    throw new StorageError('UNSAFE_PATH', 'Invalid attachment path', { path });
  }
  if (bytes.byteLength > ATTACHMENT_MAX_BYTES) throw new StorageError('INVALID_INPUT', 'Attachments must be 10 MiB or smaller.', { path });
  const extension = extname(path).toLowerCase();
  const format = TYPES[extension];
  if (!format || !format.matches(bytes)) throw new StorageError('INVALID_CONTENT', `File content does not match the supported ${extension} format.`, { path });
  return { id, name: basename(path).replace(`${id}-`, ''), contentType: format.contentType };
}

/** Resolve an ordinary relative Markdown destination and test if it names this attachment. */
export function markdownReferencesAttachment(body: string, notePath: string, attachmentPath: string): boolean {
  return markdownReferencesPath(body, notePath, attachmentPath);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
