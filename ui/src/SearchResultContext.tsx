import type { UiSearchResult } from '../../src/ui-server/dto';

/** Shared display of the server-ranked matching field; React escapes all Markdown text. */
export function SearchResultContext({ result }: { result: UiSearchResult }) {
  const match = result.match;
  if (!match) return <>{result.snippet}</>;
  // Property match text already includes the property name, so labeling it with
  // the name too would duplicate the context.
  const label = { title: 'Title', alias: 'Alias', content: 'Content', path: 'Path', tag: 'Tag', property: 'Property', filter: 'Filter' }[match.field];
  return <>{label}: {match.text.slice(0, match.start)}<mark className="rounded-sm bg-accent text-accent-foreground">{match.text.slice(match.start, match.end)}</mark>{match.text.slice(match.end)}</>;
}
