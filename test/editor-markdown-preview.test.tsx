import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownPreview, localImagePath } from '../ui/src/editor/MarkdownPreview.js';

const notes = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'Target', aliases: ['Alias'] },
];

function render(value: string, notePath = 'notes/page.md'): string {
  return renderToStaticMarkup(createElement(MarkdownPreview, {
    value, notePath, notes, onOpenNote: (id) => { void id; },
  }));
}

describe('Markdown preview', () => {
  it('renders heading levels, paragraphs, hard breaks, inline marks, horizontal rules, and safe heading anchors', () => {
    const html = render('# One\n\n## Two\n\n### Three\n\n#### Four\n\n##### Five\n\n###### Six\n\nparagraph\nsoft line  \nhard line **bold** _italic_ ~~gone~~ `code`\n\n---\n');
    for (const level of [1, 2, 3, 4, 5, 6]) expect(html).toContain(`<h${level}`);
    expect(html).toContain('id="one"');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<del>gone</del>');
    expect(html).toContain('<code class=');
    expect(html).toContain('<br');
    expect(html).toContain('<hr');
    expect(html).toContain('soft line<br/>hard line');
  });

  it('renders ordered, unordered, nested, task lists, blockquotes, and GFM tables', () => {
    const html = render('1. first\n2. second\n   - child\n\n- [x] done\n- [ ] next\n\n> quote\n\n| Name | Count |\n| --- | ---: |\n| Nodus | 2 |');
    expect(html).toContain('<ol');
    expect(html).toContain('<ul');
    expect(html).toContain('start="1"');
    expect(html).toMatch(/type="checkbox"[^>]*checked=""/);
    expect(html).toMatch(/type="checkbox"(?![^>]*checked)/);
    expect(html).toContain('<blockquote');
    expect(html).toContain('<table');
    expect(html).toContain('<th');
    expect(html).toContain('<td');
    expect(html).toContain('Nodus');
  });

  it('labels and highlights fenced code, keeps long lines scrollable, and escapes source', () => {
    const source = '```typescript\nconst result = "<script>";\n' + 'longLine '.repeat(40) + '\n```';
    const html = render(source);
    expect(html).toContain('typescript');
    expect(html).toContain('aria-label="Copy code block"');
    expect(html).toContain('text-success');
    expect(html).toContain('overflow-x-auto');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('resolves stable wiki links and aliases, labels broken/ambiguous links, and safely handles links', () => {
    const html = render('é [[11111111-1111-4111-8111-111111111111|stable]] [[Alias]] [[missing]] [site](https://example.test) [bad](javascript:alert(1))');
    expect(html).toContain('aria-label="Open stable"');
    expect(html).toContain('aria-label="Open Alias"');
    expect(html).toContain('title="Unresolved wiki link"');
    expect(html).toContain('href="https://example.test"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('Invalid link destination');
  });

  it('renders safe external and vault-relative images with fallback and responsive sizing', () => {
    const html = render('![local](./images/cover%20one.png) ![remote](https://images.example/cover.webp) ![bad](data:image/png;base64,AA)');
    expect(html).toContain('/api/assets/image?path=notes%2Fimages%2Fcover%20one.png');
    expect(html).toContain('src="https://images.example/cover.webp"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain('Image unavailable: bad');
    expect(html).toContain('max-h-[70vh]');
    expect(localImagePath('notes/folder/page.md', '../assets/a.png')).toBe('notes/assets/a.png');
    expect(localImagePath('notes/page.md', '../../../escape.png')).toBeNull();
    expect(localImagePath('notes/page.md', '/absolute/a.png')).toBeNull();
  });

  it('opens managed vault attachments through the bounded local attachment route', () => {
    const path = 'attachments/11111111-1111-4111-8111-111111111111-guide.pdf';
    const html = render(`[PDF](../${path}) [unsafe](../attachments/not-managed.pdf)`);
    expect(html).toContain(`/api/attachments/open?path=${encodeURIComponent(path)}`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('/api/attachments/open?path=attachments%2Fnot-managed.pdf');
  });

  it('treats malformed Markdown and raw HTML as text without executable markup', () => {
    const html = render('<script>alert(1)</script>\n\n[broken](javascript:)\n\n```unterminated\ncode');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('unterminated');
    expect(html).toContain('code');
  });

  it('creates stable, unique heading anchors for duplicate titles', () => {
    const html = render('# Same\n\n## Same');
    expect(html).toContain('id="same"');
    expect(html).toContain('id="same-2"');
  });

  it('renders Setext headings and reference-style links without leaking definitions into the body', () => {
    const html = render('Chapter\n=======\n\n[reference][site]\n\n[site]: https://example.test/docs');
    expect(html).toContain('<h1 id="chapter"');
    expect(html).toContain('>Chapter</h1>');
    expect(html).toContain('href="https://example.test/docs"');
    expect(html).toContain('>reference</a>');
    expect(html).not.toContain('[site]:');
  });
});
