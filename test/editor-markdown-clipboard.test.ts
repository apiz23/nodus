import { describe, expect, it } from 'vitest';
import { spreadsheetTextToMarkdownTable } from '../ui/src/editor/markdownClipboard.js';

describe('Markdown clipboard conversion', () => {
  it('converts rectangular tab-separated clipboard content to a header and body table', () => {
    expect(spreadsheetTextToMarkdownTable('Name\tCount\r\nNodus\t2\r\n')).toBe('| Name | Count |\n| --- | --- |\n| Nodus | 2 |');
  });

  it('escapes pipes and backslashes while preserving empty cells', () => {
    expect(spreadsheetTextToMarkdownTable('A\tB\n\\path\tleft|right\n\tlast')).toBe('| A | B |\n| --- | --- |\n| \\\\path | left\\|right |\n|  | last |');
  });

  it.each(['plain text', 'A\tB', 'A\tB\n1', 'A\tB\n1\t2\t3'])('leaves non-table clipboard text untouched: %s', (source) => {
    expect(spreadsheetTextToMarkdownTable(source)).toBeNull();
  });
});
