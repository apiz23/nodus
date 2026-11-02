/** Pure command-palette helpers: deduplication, ranking, grouping, execution. */

export type CommandCategory =
  | 'Recent notes'
  | 'Notes'
  | 'Navigation'
  | 'Databases'
  | 'Folders'
  | 'Appearance'
  | 'Help';

export interface CommandLike {
  id: string;
  title: string;
  keywords?: string;
  category: CommandCategory;
  /** Hide from the empty-query view; still searchable by name or keyword. */
  showInEmpty?: boolean;
}

export interface CommandRunResult {
  ok: boolean;
  error?: string;
}

/** Keep the first registration for each id so duplicate definitions cannot run twice. */
export function dedupeCommands<T extends { id: string }>(commands: readonly T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const command of commands) {
    if (seen.has(command.id)) continue;
    seen.add(command.id);
    result.push(command);
  }
  return result;
}

function normalize(value: string): string {
  return value.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function tokens(value: string): string[] {
  return normalize(value).split(' ').filter(Boolean);
}

export function commandSearchText(command: CommandLike): string {
  return normalize(`${command.title} ${command.keywords ?? ''} ${command.category}`);
}

/**
 * Rank commands by name and keywords. Every query token must occur somewhere
 * in the title, keywords, or category. Exact and prefix title matches win.
 */
export function scoreCommand(command: CommandLike, query: string): number | null {
  const normalized = normalize(query);
  if (normalized === '') return 0;
  const title = normalize(command.title);
  const haystack = commandSearchText(command);
  const queryTokens = tokens(query);
  if (!queryTokens.every((token) => haystack.includes(token))) return null;
  if (title === normalized) return 0;
  if (title.startsWith(normalized)) return 1;
  if (queryTokens.every((token) => title.includes(token))) return 2;
  if (queryTokens.some((token) => title.includes(token))) return 3;
  return 4;
}

export function searchCommands<T extends CommandLike>(
  commands: readonly T[],
  query: string,
): T[] {
  const normalized = normalize(query);
  if (normalized === '') {
    return commands.filter((command) => command.showInEmpty !== false);
  }
  return commands
    .map((command) => ({ command, score: scoreCommand(command, query) }))
    .filter((entry): entry is { command: T; score: number } => entry.score !== null)
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      const title = left.command.title.localeCompare(right.command.title);
      return title !== 0 ? title : left.command.id.localeCompare(right.command.id);
    })
    .map((entry) => entry.command);
}

export function groupCommands<T extends CommandLike>(
  commands: readonly T[],
): Array<{ category: CommandCategory; commands: T[] }> {
  const groups = new Map<CommandCategory, T[]>();
  for (const command of commands) {
    const group = groups.get(command.category) ?? [];
    group.push(command);
    groups.set(command.category, group);
  }
  return [...groups.entries()].map(([category, group]) => ({ category, commands: group }));
}

/**
 * Execute a command and normalize failures for the palette's error state.
 * Commands remain responsible for their own domain validation; this wrapper
 * only prevents a rejected promise from becoming an unhandled rejection.
 */
export async function executeCommand(command: { run: () => void | Promise<void> }): Promise<CommandRunResult> {
  try {
    await command.run();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error && error.message.trim() !== ''
        ? error.message
        : 'The command could not be completed.',
    };
  }
}
