/** Checks portable Markdown inline and reference links against a vault-relative target path. */
export function markdownReferencesPath(body: string, notePath: string, targetPath: string): boolean {
  const target = normalizeSegments(targetPath.split('/'));
  if (target === null) return false;
  const noteDirectory = notePath.split('/').slice(0, -1);
  const masked = maskCode(body);
  const definitions = new Map<string, string>();
  const definitionPattern = /^ {0,3}\[([^\]\r\n]+)\]:[ \t]*(?:<([^>\r\n]+)>|(\S+))/gm;
  for (const match of masked.matchAll(definitionPattern)) {
    const destination = match[2] ?? match[3];
    if (destination !== undefined) definitions.set(normalizeReference(match[1] ?? ''), destination);
  }
  const link = /!?(?:\[[^\]\r\n]*\])\((?:<([^>\r\n]+)>|((?:\\.|[^)\s])+))(?:\s+[^)]*)?\)/g;
  const candidates = [...masked.matchAll(link)].map((match) => match[1] ?? match[2] ?? '');
  const referenceUse = /!?\[([^\]\r\n]+)\](?:\[([^\]\r\n]*)\])?(?!\s*\()/g;
  const withoutDefinitions = masked.replace(definitionPattern, (line) => line.replace(/[^\r]/g, ' '));
  for (const match of withoutDefinitions.matchAll(referenceUse)) {
    const destination = definitions.get(normalizeReference(match[2] || match[1] || ''));
    if (destination !== undefined) candidates.push(destination);
  }
  for (const raw of candidates) {
    if (!raw || /^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith('//') || raw.startsWith('/')) continue;
    let decoded: string;
    try { decoded = decodeURIComponent(raw.replace(/\\([\\()])/g, '$1')); } catch { continue; }
    const resolved = normalizeSegments([...noteDirectory, ...decoded.split('/')]);
    if (resolved !== null && resolved === target) return true;
  }
  return false;
}

function normalizeReference(label: string): string {
  return label.replace(/\\([\\`*_{}\[\]()#+.!<>|])/g, '$1').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeSegments(segments: string[]): string | null {
  const normalized: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (normalized.length === 0) return null;
      normalized.pop();
    } else normalized.push(segment);
  }
  return normalized.join('/') || null;
}

function maskCode(body: string): string {
  let fence: string | null = null;
  return body.split('\n').map((line) => {
    if (fence !== null) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close?.[1] && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      return line.replace(/[^\r]/g, ' ');
    }
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (open?.[1]) { fence = open[1]; return line.replace(/[^\r]/g, ' '); }
    return line.replace(/(`+)[\s\S]*?\1/g, (code) => code.replace(/[^\r]/g, ' '));
  }).join('\n');
}
