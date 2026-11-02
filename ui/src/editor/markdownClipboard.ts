/** Convert rectangular spreadsheet clipboard text to a Markdown table. */
export function spreadsheetTextToMarkdownTable(source: string): string | null {
  const normalized = source.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!normalized.includes('\t')) return null;
  const rows = normalized.split('\n').map((line) => line.split('\t'));
  const columns = rows[0]?.length ?? 0;
  if (rows.length < 2 || columns < 2 || rows.some((row) => row.length !== columns)) return null;
  const cell = (value: string) => value.trim().replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  const formatted = rows.map((row) => `| ${row.map(cell).join(' | ')} |`);
  formatted.splice(1, 0, `| ${Array.from({ length: columns }, () => '---').join(' | ')} |`);
  return formatted.join('\n');
}
