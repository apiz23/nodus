import { StorageError } from '../errors.js';

export type PublicationPrimitiveSupport = 'supported' | 'unsupported' | 'unknown';
export type PublicationPlatform = 'darwin' | 'linux' | 'win32';

export interface FilesystemPublicationCapabilityTarget {
  readonly platform: PublicationPlatform;
  readonly filesystem: string;
  readonly operation: 'exclusive-create-no-replace';
}

export interface FilesystemPublicationCapabilityProbe {
  readonly requested: boolean;
  readonly platform: string | null;
  readonly filesystem: string | null;
  /** API availability is not filesystem qualification. */
  readonly primitiveSupport: PublicationPrimitiveSupport;
}

export type PublicationCapabilityAssessment =
  | { readonly status: 'supported'; readonly target: FilesystemPublicationCapabilityTarget }
  | { readonly status: 'unsupported'; readonly reason: string; readonly target?: FilesystemPublicationCapabilityTarget }
  | { readonly status: 'not-qualified'; readonly reason: string; readonly target: FilesystemPublicationCapabilityTarget }
  | { readonly status: 'unavailable'; readonly reason: string; readonly target?: FilesystemPublicationCapabilityTarget }
  | { readonly status: 'disabled'; readonly reason: string };

/**
 * Native publication qualification is intentionally empty. A suitable-looking
 * API or a positive runtime probe never adds a filesystem to this allowlist.
 */
export const FILESYSTEM_PUBLICATION_ALLOWLIST: readonly FilesystemPublicationCapabilityTarget[] = Object.freeze([]);

export function assessFilesystemPublicationCapability(input: unknown): PublicationCapabilityAssessment {
  try {
    if (isRecord(input) && Object.hasOwn(input, 'requested') && input.requested === false) {
      return { status: 'disabled', reason: 'Filesystem publication is explicitly disabled.' };
    }
    const parsed = parseFilesystemPublicationCapabilityProbe(input);
    if (parsed === undefined) return { status: 'unavailable', reason: 'Filesystem publication capability evidence is incomplete or malformed.' };
    if (parsed.platform === null || parsed.filesystem === null) {
      return { status: 'unavailable', reason: 'The runtime platform or filesystem could not be established.' };
    }
    if (!isPublicationPlatform(parsed.platform)) {
      return { status: 'unsupported', reason: `Runtime platform "${parsed.platform}" is unsupported.` };
    }
    const target: FilesystemPublicationCapabilityTarget = Object.freeze({
      platform: parsed.platform,
      filesystem: parsed.filesystem,
      operation: 'exclusive-create-no-replace',
    });
    if (parsed.primitiveSupport === 'unsupported') {
      return { status: 'unsupported', reason: 'The required exclusive no-replace primitive is unavailable.', target };
    }
    if (parsed.primitiveSupport === 'unknown') {
      return { status: 'unavailable', reason: 'The required exclusive no-replace primitive could not be inspected.', target };
    }
    if (!FILESYSTEM_PUBLICATION_ALLOWLIST.some((entry) => sameCapabilityTarget(entry, target))) {
      return { status: 'not-qualified', reason: 'No filesystem publication target has completed native qualification.', target };
    }
    return { status: 'supported', target };
  } catch {
    return { status: 'unavailable', reason: 'Filesystem publication capability evidence could not be read safely.' };
  }
}

/** Fail closed with a stable storage error; no fallback writer is attempted. */
export function requireFilesystemPublicationCapability(input: unknown): Extract<PublicationCapabilityAssessment, { status: 'supported' }> {
  const assessment = assessFilesystemPublicationCapability(input);
  if (assessment.status !== 'supported') {
    throw new StorageError('PUBLICATION_CAPABILITY_REFUSED', `Filesystem copy publication refused: ${assessment.status}. ${assessment.reason}`, {
      details: { issues: [assessment.status, assessment.reason] },
    });
  }
  return assessment;
}

export function parseFilesystemPublicationCapabilityProbe(input: unknown): FilesystemPublicationCapabilityProbe | undefined {
  if (!isRecord(input) || !hasExactlyKeys(input, ['requested', 'platform', 'filesystem', 'primitiveSupport'])
    || typeof input.requested !== 'boolean'
    || !(input.platform === null || (typeof input.platform === 'string' && input.platform.length <= 32))
    || !(input.filesystem === null || (typeof input.filesystem === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(input.filesystem)))
    || (input.primitiveSupport !== 'supported' && input.primitiveSupport !== 'unsupported' && input.primitiveSupport !== 'unknown')) return undefined;
  return Object.freeze({
    requested: input.requested,
    platform: input.platform,
    filesystem: input.filesystem,
    primitiveSupport: input.primitiveSupport,
  });
}

function sameCapabilityTarget(left: FilesystemPublicationCapabilityTarget, right: FilesystemPublicationCapabilityTarget): boolean {
  return left.platform === right.platform && left.filesystem === right.filesystem && left.operation === right.operation;
}

function hasExactlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length && actual.every((key, index) => key === sortedExpected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPublicationPlatform(value: string): value is PublicationPlatform {
  return value === 'darwin' || value === 'linux' || value === 'win32';
}
