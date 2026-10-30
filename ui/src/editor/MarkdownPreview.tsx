import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { markdownLanguage } from '@codemirror/lang-markdown';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { parseWikiLinks, createLinkResolver, type LinkableNote } from '../../../src/links/wikilink.js';

const IMAGE_TYPES = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp']);

interface MarkdownNode {
  from: number;
  to: number;
  name: string;
  firstChild: MarkdownNode | null;
  nextSibling: MarkdownNode | null;
}

function children(node: MarkdownNode): MarkdownNode[] {
  const result: MarkdownNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

function safeHref(raw: string): string | null {
  const href = raw.trim().replace(/\\([\\`*_{}\[\]()#+.!<>|])/g, '$1');
  if (!href || /[\u0000-\u001f\u007f]/.test(href) || href.startsWith('//')) return null;
  if (/^(?:https?:|mailto:)/i.test(href) || href.startsWith('#') || href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) return href;
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) return null;
  return href;
}

export function localImagePath(notePath: string, rawSource: string): string | null {
  const path = localVaultPath(notePath, rawSource);
  if (path === null) return null;
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
  return IMAGE_TYPES.has(extension) ? path : null;
}

function localVaultPath(notePath: string, rawSource: string): string | null {
  let source: string;
  try { source = decodeURIComponent(rawSource); } catch { return null; }
  if (!source || source.startsWith('/') || source.startsWith('\\') || source.includes('\\') || /[?#\u0000-\u001f]/.test(source)) return null;
  const base = notePath.split('/').slice(0, -1);
  const parts = [...base];
  for (const segment of source.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    if (segment.startsWith('.') || segment.includes(':')) return null;
    parts.push(segment);
  }
  return parts.join('/') || null;
}

function localAttachmentUrl(notePath: string, rawSource: string): string | null {
  const path = localVaultPath(notePath, rawSource);
  return path && /^attachments\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[a-z0-9_-]{1,64}\.(?:png|jpe?g|gif|webp|avif|pdf|txt)$/.test(path)
    ? `/api/attachments/open?path=${encodeURIComponent(path)}` : null;
}

function imageSource(notePath: string, source: string): string | null {
  const href = safeHref(source);
  if (href && /^https:\/\//i.test(href)) return href;
  const path = localImagePath(notePath, source);
  return path === null ? null : `/api/assets/image?path=${encodeURIComponent(path)}`;
}

function normalizeReference(label: string): string {
  return label.replace(/^\[|\]$/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

const KEYWORDS = new Set('async await break case catch class const continue def else export extends false finally for from function if import in interface let new null of return static switch this throw true try type undefined var while yield'.split(' '));
const TOKEN = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b/g;

function highlighted(code: string): ReactNode[] {
  const result: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of code.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    const text = match[0];
    if (at > cursor) result.push(code.slice(cursor, at));
    const kind = text.startsWith('//') || text.startsWith('/*') || text.startsWith('#')
      ? 'text-muted-foreground italic'
      : /^(?:"|'|`)/.test(text) ? 'text-success'
        : /^\d/.test(text) ? 'text-destructive'
          : KEYWORDS.has(text) ? 'text-primary font-medium'
            : /[A-Za-z_$][\w$]*$/.test(text) && code.slice(at + text.length).match(/^\s*\(/) ? 'text-foreground font-semibold' : '';
    result.push(kind ? <span key={index} className={kind}>{text}</span> : text);
    cursor = at + text.length;
    index += 1;
  }
  if (cursor < code.length) result.push(code.slice(cursor));
  return result;
}

function FencedCode({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setCopyError(false);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { setCopyError(true); }
  }
  return <figure className="my-4 overflow-hidden rounded-md border bg-muted/50 text-sm">
    <figcaption className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
      <span>{language || 'Code'}</span>
      <Button type="button" size="xs" variant="ghost" onClick={() => void copy()} aria-label="Copy code block">
        {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}{copyError ? 'Copy failed' : copied ? 'Copied' : 'Copy'}
      </Button>
    </figcaption>
    <pre className="max-w-full overflow-x-auto p-3 font-mono text-[0.85em] leading-relaxed [tab-size:4]"><code>{highlighted(code)}</code></pre>
  </figure>;
}

interface MarkdownPreviewProps {
  value: string;
  notePath: string;
  notes: readonly LinkableNote[];
  onOpenNote: (id: string) => void;
}

/** Read-only, escaped Markdown view. The original Markdown remains the only saved representation. */
export function MarkdownPreview({ value, notePath, notes, onOpenNote }: MarkdownPreviewProps) {
  const rendered = useMemo(() => {
    const links = parseWikiLinks(value);
    const resolve = createLinkResolver(notes);
    // Mask link delimiters and targets with plain text while retaining exact offsets for Lezer.
    const masked = value.split('');
    for (const link of links) for (let offset = link.start; offset < link.end; offset += 1) {
      if (masked[offset] !== '\n' && masked[offset] !== '\r') masked[offset] = 'x';
    }
    const root = markdownLanguage.parser.parse(masked.join(''));
    const usedHeadings = new Map<string, number>();
    const references = new Map<string, string>();
    const visitReferences = (node: MarkdownNode) => {
      if (node.name === 'LinkReference') {
        const parts = children(node);
        const label = parts.find((child) => child.name === 'LinkLabel');
        const url = parts.find((child) => child.name === 'URL');
        if (label && url) references.set(normalizeReference(value.slice(label.from, label.to)), value.slice(url.from, url.to));
      }
      for (const child of children(node)) visitReferences(child);
    };
    visitReferences(root.topNode);

    const inlineText = (from: number, to: number): React.ReactNode[] => {
      const matching = links.filter((link) => link.start >= from && link.end <= to);
      if (matching.length === 0) return [value.slice(from, to).replace(/\r?\n/g, ' ')];
      const output: React.ReactNode[] = [];
      let cursor = from;
      for (const link of matching) {
        if (cursor < link.start) output.push(value.slice(cursor, link.start).replace(/\r?\n/g, ' '));
        const resolution = resolve(link.target);
        const display = link.display ?? link.target;
        if (resolution.status === 'resolved') output.push(<button key={link.start} type="button" className="inline border-0 bg-transparent p-0 font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Open ${display}`} onClick={() => onOpenNote(resolution.noteId)}>{display}</button>);
        else output.push(<span key={link.start} className="text-muted-foreground underline decoration-dashed underline-offset-2" title={resolution.status === 'ambiguous' ? 'Ambiguous wiki link' : 'Unresolved wiki link'}>{display}</span>);
        cursor = link.end;
      }
      if (cursor < to) output.push(value.slice(cursor, to).replace(/\r?\n/g, ' '));
      return output;
    };

    const inline = (node: MarkdownNode): ReactNode => {
      const name = node.name;
      if (name === 'StrongEmphasis') {
        const marks = children(node).filter((child) => child.name === 'EmphasisMark');
        return <strong>{inlineBetween(node, marks[0]?.to ?? node.from, marks.at(-1)?.from ?? node.to)}</strong>;
      }
      if (name === 'Emphasis') {
        const marks = children(node).filter((child) => child.name === 'EmphasisMark');
        return <em>{inlineBetween(node, marks[0]?.to ?? node.from, marks.at(-1)?.from ?? node.to)}</em>;
      }
      if (name === 'Strikethrough') {
        const marks = children(node).filter((child) => child.name === 'StrikethroughMark');
        return <del>{inlineBetween(node, marks[0]?.to ?? node.from, marks.at(-1)?.from ?? node.to)}</del>;
      }
      if (name === 'InlineCode') {
        const raw = value.slice(node.from, node.to);
        const match = /^(\`+)([\s\S]*?)\1$/.exec(raw);
        return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.88em]">{match?.[2]?.replace(/^ | $/g, '') ?? raw}</code>;
      }
      if (name === 'HardBreak') return <br />;
      if (name === 'Link') {
        const parts = children(node);
        const url = parts.find((child) => child.name === 'URL');
        const labelNode = parts.find((child) => child.name === 'LinkLabel');
        const destination = url ? value.slice(url.from, url.to) : labelNode ? references.get(normalizeReference(value.slice(labelNode.from, labelNode.to))) : undefined;
        const href = destination ? safeHref(destination.replace(/^<|>$/g, '')) : null;
        const attachmentHref = destination ? localAttachmentUrl(notePath, destination.replace(/^<|>$/g, '')) : null;
        const marks = children(node).filter((child) => child.name === 'LinkMark');
        const labelFrom = marks[0]?.to ?? node.from;
        const labelTo = marks[1]?.from ?? labelFrom;
        const label = inlineBetween(node, labelFrom, labelTo);
        return href ? <a href={attachmentHref ?? href} className="text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary" {...(/^https?:/i.test(href) || attachmentHref ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{label}</a> : <span className="underline decoration-dashed" title="Invalid link destination">{label}</span>;
      }
      if (name === 'Image') {
        const parts = children(node);
        const url = parts.find((child) => child.name === 'URL');
        const reference = parts.find((child) => child.name === 'LinkLabel');
        const destination = url ? value.slice(url.from, url.to) : reference ? references.get(normalizeReference(value.slice(reference.from, reference.to))) : undefined;
        const alt = value.slice(node.from, node.to).replace(/^!\[/, '').split(']')[0] ?? 'Markdown image';
        const src = destination ? imageSource(notePath, destination.replace(/^<|>$/g, '')) : null;
        return src ? <PreviewImage key={src} src={src} alt={alt} /> : <span role="img" aria-label={alt} className="text-sm text-muted-foreground">Image unavailable: {alt}</span>;
      }
      if (name === 'LinkMark' || name === 'URL' || name === 'EmphasisMark' || name === 'StrikethroughMark' || name === 'CodeMark') return null;
      if (name === 'Text' || name === 'LinkLabel') return inlineText(node.from, node.to);
      return inlineBetween(node, node.from, node.to);
    };

    function inlineBetween(parent: MarkdownNode, from: number, to: number): ReactNode[] {
      const output: ReactNode[] = [];
      let cursor = from;
      let key = 0;
      for (const child of children(parent)) {
        if (child.to <= from || child.from >= to) continue;
        const start = Math.max(from, child.from);
        const end = Math.min(to, child.to);
        if (start > cursor) output.push(<Fragment key={`t${key++}`}>{inlineText(cursor, start)}</Fragment>);
        if (child.name === 'EmphasisMark' || child.name === 'StrikethroughMark' || child.name === 'CodeMark' || child.name === 'LinkMark' || child.name === 'URL' || child.name === 'HeaderMark') {
          cursor = Math.max(cursor, end);
          continue;
        }
        output.push(<Fragment key={`n${key++}`}>{inline(child)}</Fragment>);
        cursor = Math.max(cursor, end);
      }
      if (cursor < to) output.push(<Fragment key={`t${key}`}>{inlineText(cursor, to)}</Fragment>);
      return output;
    }

    const block = (node: MarkdownNode, key: string): ReactNode => {
      const name = node.name;
      const kids = children(node);
      const childBlocks = (skip: (child: MarkdownNode) => boolean = () => false) => kids.filter((child) => !skip(child)).map((child, index) => block(child, `${key}-${index}`));
      const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(name);
      if (heading) {
        const level = Number(heading[1]);
        const mark = kids.find((child) => child.name === 'HeaderMark');
        let contentFrom = node.name.startsWith('ATX') ? mark?.to ?? node.from : node.from;
        let contentTo = node.name.startsWith('ATX') ? node.to : mark?.from ?? node.to;
        while (contentFrom < contentTo && /[ \t]/.test(value[contentFrom] ?? '')) contentFrom += 1;
        while (contentTo > contentFrom && /[ \t\r\n]/.test(value[contentTo - 1] ?? '')) contentTo -= 1;
        const content = inlineBetween(node, contentFrom, contentTo);
        const plain = value.slice(contentFrom, contentTo).replace(/[*_`~]/g, '').trim();
        const base = plain.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/[\s]+/g, '-');
        const count = usedHeadings.get(base) ?? 0;
        usedHeadings.set(base, count + 1);
        const id = `${base || 'section'}${count ? `-${count + 1}` : ''}`;
        return level === 1 ? <h1 key={key} id={id} className="mt-7 scroll-mt-6 text-3xl font-semibold tracking-tight">{content}</h1>
          : level === 2 ? <h2 key={key} id={id} className="mt-6 scroll-mt-6 text-2xl font-semibold tracking-tight">{content}</h2>
            : level === 3 ? <h3 key={key} id={id} className="mt-5 scroll-mt-6 text-xl font-semibold">{content}</h3>
              : level === 4 ? <h4 key={key} id={id} className="mt-4 scroll-mt-6 text-lg font-semibold">{content}</h4>
                : level === 5 ? <h5 key={key} id={id} className="mt-4 scroll-mt-6 font-semibold">{content}</h5>
                  : <h6 key={key} id={id} className="mt-3 scroll-mt-6 text-sm font-semibold uppercase tracking-wide">{content}</h6>;
      }
      if (name === 'Paragraph') return <p key={key} className="my-3 leading-7">{inlineBetween(node, node.from, node.to)}</p>;
      if (name === 'Document') return <>{childBlocks()}</>;
      if (name === 'BulletList' || name === 'OrderedList') {
        const ordered = name === 'OrderedList';
        const first = value.slice(node.from, node.to).match(/^\s*(\d+)[.)]/);
        const items = kids.filter((child) => child.name === 'ListItem').map((child, index) => block(child, `${key}-${index}`));
        return ordered ? <ol key={key} start={first ? Number(first[1]) : undefined} className="my-3 list-decimal space-y-1 pl-6 marker:text-muted-foreground">{items}</ol>
          : <ul key={key} className="my-3 list-disc space-y-1 pl-6 marker:text-muted-foreground">{items}</ul>;
      }
      if (name === 'ListItem') {
        const task = kids.find((child) => child.name === 'Task');
        if (!task) return <li key={key} className="pl-1">{childBlocks((child) => child.name === 'ListMark')}</li>;
        const marker = children(task).find((child) => child.name === 'TaskMarker');
        const checked = marker ? /\[[xX]\]/.test(value.slice(marker.from, marker.to)) : false;
        const afterTask = marker ? inlineText(marker.to, task.to) : [value.slice(task.from, task.to)];
        return <li key={key} className="list-none"><span className="inline-flex items-baseline gap-2"><input type="checkbox" checked={checked} readOnly aria-label={checked ? 'Completed task' : 'Incomplete task'} className="accent-primary" />{afterTask}</span>{childBlocks((child) => child.name === 'ListMark' || child.name === 'Task')}</li>;
      }
      if (name === 'Blockquote') return <blockquote key={key} className="my-4 border-l-2 border-border pl-4 text-muted-foreground">{childBlocks((child) => child.name === 'QuoteMark')}</blockquote>;
      if (name === 'HorizontalRule') return <hr key={key} className="my-6 border-border" />;
      if (name === 'FencedCode') {
        const code = kids.find((child) => child.name === 'CodeText');
        const info = kids.find((child) => child.name === 'CodeInfo');
        const language = info ? value.slice(info.from, info.to).trim().split(/\s+/, 1)[0] ?? '' : '';
        return <FencedCode key={key} code={code ? value.slice(code.from, code.to) : ''} language={language} />;
      }
      if (name === 'Table') {
        const header = kids.find((child) => child.name === 'TableHeader');
        const rows = kids.filter((child) => child.name === 'TableRow');
        const cells = (row: MarkdownNode, tag: 'th' | 'td') => children(row).filter((child) => child.name === 'TableCell').map((cell, index) => tag === 'th'
          ? <th key={index} className="border px-3 py-2 text-left font-semibold">{inlineBetween(cell, cell.from, cell.to)}</th>
          : <td key={index} className="border px-3 py-2">{inlineBetween(cell, cell.from, cell.to)}</td>);
        return <div key={key} className="my-4 max-w-full overflow-x-auto"><table className="w-full border-collapse text-sm"><thead><tr>{header ? cells(header, 'th') : null}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="even:bg-muted/40">{cells(row, 'td')}</tr>)}</tbody></table></div>;
      }
      if (name === 'HTMLBlock' || name === 'HTMLTag') return <pre key={key} className="my-3 overflow-x-auto rounded bg-muted p-3 text-sm">{value.slice(node.from, node.to)}</pre>;
      if (name === 'LinkReference') return null;
      if (name === 'CodeText') return null;
      return <div key={key}>{childBlocks((child) => child.name === 'ListMark' || child.name === 'HeaderMark' || child.name === 'QuoteMark' || child.name === 'CodeMark' || child.name === 'TableDelimiter')}</div>;
    };

    return { tree: block(root.topNode, 'root') };
  }, [value, notePath, notes, onOpenNote]);

  return <article aria-label="Markdown preview" className="min-w-0 break-words text-[16px] text-foreground [&_a]:break-all [&_img]:h-auto [&_img]:max-h-[70vh] [&_img]:max-w-full [&_img]:rounded-md">{rendered.tree}</article>;
}

function PreviewImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span role="img" aria-label={alt} className="inline-block text-sm text-muted-foreground">Image unavailable: {alt}</span>;
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
