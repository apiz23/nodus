import { NodusError } from './errors.js';

const MAX_PATH_LENGTH = 260;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`),
]);

export function validateNotePath(path: string): string {
  const fail = (reason: string): never => {
    throw new NodusError('UNSAFE_PATH', `Unsafe note path "${path}": ${reason}`);
  };

  if (typeof path !== 'string' || path.length === 0) fail('must be a non-empty string');
  if (path.length > MAX_PATH_LENGTH) fail(`longer than ${MAX_PATH_LENGTH} characters`);
  if (CONTROL_CHARACTERS.test(path)) fail('contains control characters');
  if (path.includes('\\')) fail('contains backslashes');
  if (path.includes(':')) fail('contains a colon');
  if (path.startsWith('/')) fail('is absolute');

  const segments = path.split('/');
  for (const segment of segments) {
    if (segment === '') fail('contains an empty segment');
    if (segment === '.' || segment === '..') fail('contains a relative traversal segment');
    if (segment.endsWith(' ') || segment.endsWith('.')) fail('has a segment ending in a space or dot');
    if (RESERVED_NAMES.has(segment.split('.')[0]?.toUpperCase() ?? '')) {
      fail('uses a reserved Windows device name');
    }
  }

  const fileName = segments[segments.length - 1] ?? '';
  if (!fileName.endsWith('.md') || fileName === '.md') fail('must end with ".md" and have a file name');

  return path;
}

/** Validates a vault-relative directory path (without a trailing slash). */
export function validateFolderPath(path: string): string {
  const fail = (reason: string): never => {
    throw new NodusError('UNSAFE_PATH', `Unsafe folder path "${path}": ${reason}`);
  };

  if (typeof path !== 'string' || path.length === 0) fail('must be a non-empty string');
  if (path.length > MAX_PATH_LENGTH) fail(`longer than ${MAX_PATH_LENGTH} characters`);
  if (CONTROL_CHARACTERS.test(path)) fail('contains control characters');
  if (path.includes('\\')) fail('contains backslashes');
  if (path.includes(':')) fail('contains a colon');
  if (path.startsWith('/')) fail('is absolute');

  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') fail('contains an invalid path segment');
    if (segment.startsWith('.')) fail('hidden folders are excluded from the vault');
    if (segment.endsWith(' ') || segment.endsWith('.')) fail('has a segment ending in a space or dot');
    if (RESERVED_NAMES.has(segment.split('.')[0]?.toUpperCase() ?? '')) {
      fail('uses a reserved Windows device name');
    }
  }
  return path;
}
