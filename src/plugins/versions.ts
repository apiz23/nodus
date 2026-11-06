export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
}

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_COMPONENT = Number.MAX_SAFE_INTEGER;

export function parseSemanticVersion(value: string): SemanticVersion | null {
  const match = VERSION.exec(value);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if ([major, minor, patch].some((part) => !Number.isSafeInteger(part) || part > MAX_COMPONENT)) return null;
  return { major, minor, patch };
}

export function compareSemanticVersions(left: SemanticVersion, right: SemanticVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/** Supported range subset: exact, ^, ~, or whitespace-separated comparator conjunctions. */
export function isSupportedVersionRange(range: string): boolean {
  if (range.startsWith('^') || range.startsWith('~')) return parseSemanticVersion(range.slice(1)) !== null;
  if (parseSemanticVersion(range)) return true;
  const terms = range.split(' ');
  return terms.length > 0 && terms.every((term) => {
    const match = /^(>=|>|<=|<)(.+)$/.exec(term);
    return match !== null && parseSemanticVersion(match[2] ?? '') !== null;
  });
}

export function satisfiesVersionRange(versionValue: string, range: string): boolean {
  const version = parseSemanticVersion(versionValue);
  if (!version || !isSupportedVersionRange(range)) return false;
  if (range.startsWith('^') || range.startsWith('~')) {
    const target = parseSemanticVersion(range.slice(1));
    if (!target) return false;
    if (compareSemanticVersions(version, target) < 0) return false;
    if (range.startsWith('~')) return version.major === target.major && version.minor === target.minor;
    if (target.major > 0) return version.major === target.major;
    if (target.minor > 0) return version.major === 0 && version.minor === target.minor;
    return version.major === 0 && version.minor === 0 && version.patch === target.patch;
  }
  if (parseSemanticVersion(range)) return compareSemanticVersions(version, parseSemanticVersion(range)!) === 0;
  return range.split(' ').every((term) => {
    const match = /^(>=|>|<=|<)(.+)$/.exec(term);
    if (!match) return false;
    const target = parseSemanticVersion(match[2] ?? '');
    if (!target) return false;
    const comparison = compareSemanticVersions(version, target);
    switch (match[1]) {
      case '>=': return comparison >= 0;
      case '>': return comparison > 0;
      case '<=': return comparison <= 0;
      case '<': return comparison < 0;
      default: return false;
    }
  });
}
