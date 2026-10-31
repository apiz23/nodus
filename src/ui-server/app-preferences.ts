import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, posix, resolve, win32 } from 'node:path';
import { writeFileAtomic } from '../storage/fs/atomic.js';

const FORMAT = 'nodus-application-preferences';
const VERSION = 1;

export type LastVaultPreference =
  | { kind: 'missing' }
  | { kind: 'valid'; path: string }
  | { kind: 'invalid' };

interface ApplicationPreferences {
  format: string;
  version: number;
  lastVaultPath?: string;
  completedGettingStartedVaults?: string[];
}

export function applicationPreferencesPath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home = homedir(),
): string {
  const paths = platform === 'win32' ? win32 : posix;
  const applicationDirectory = platform === 'linux' ? 'nodus' : 'Nodus';
  const appData = env.APPDATA;
  const xdgConfig = env.XDG_CONFIG_HOME;
  const base = platform === 'win32'
    ? appData && paths.isAbsolute(appData) ? appData : paths.join(home, 'AppData', 'Roaming')
    : platform === 'darwin'
      ? paths.join(home, 'Library', 'Application Support')
      : xdgConfig && paths.isAbsolute(xdgConfig) ? xdgConfig : paths.join(home, '.config');
  return paths.join(base, applicationDirectory, 'preferences.json');
}

export async function readLastVaultPreference(path: string): Promise<LastVaultPreference> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    throw error;
  }

  try {
    const value: unknown = JSON.parse(text);
    if (
      value === null || typeof value !== 'object' || Array.isArray(value) ||
      (value as Record<string, unknown>).format !== FORMAT ||
      (value as Record<string, unknown>).version !== VERSION ||
      typeof (value as Record<string, unknown>).lastVaultPath !== 'string' ||
      !isAbsolute((value as Record<string, unknown>).lastVaultPath as string) ||
      Object.keys(value as Record<string, unknown>).some((key) => !['format', 'version', 'lastVaultPath', 'completedGettingStartedVaults'].includes(key)) ||
      ((value as Record<string, unknown>).completedGettingStartedVaults !== undefined &&
        (!Array.isArray((value as Record<string, unknown>).completedGettingStartedVaults) ||
          ((value as Record<string, unknown>).completedGettingStartedVaults as unknown[]).some((entry) => typeof entry !== 'string')))
    ) return { kind: 'invalid' };
    return { kind: 'valid', path: resolve((value as { lastVaultPath: string }).lastVaultPath) };
  } catch {
    return { kind: 'invalid' };
  }
}

export async function writeLastVaultPreference(path: string, vaultPath: string): Promise<void> {
  const preferences = await readPreferences(path);
  await writePreferences(path, { ...preferences, lastVaultPath: resolve(vaultPath) });
}

export async function gettingStartedCompleted(path: string, vaultPath: string): Promise<boolean> {
  const preferences = await readPreferences(path);
  return preferences.completedGettingStartedVaults?.includes(resolve(vaultPath)) ?? false;
}

export async function setGettingStartedCompleted(path: string, vaultPath: string, completed: boolean): Promise<void> {
  const preferences = await readPreferences(path);
  const vault = resolve(vaultPath);
  const completedVaults = new Set(preferences.completedGettingStartedVaults ?? []);
  if (completed) completedVaults.add(vault);
  else completedVaults.delete(vault);
  await writePreferences(path, { ...preferences, completedGettingStartedVaults: [...completedVaults] });
}

async function readPreferences(path: string): Promise<ApplicationPreferences> {
  let text: string;
  try { text = await readFile(path, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { format: FORMAT, version: VERSION };
    throw error;
  }
  const value: unknown = JSON.parse(text);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Application preferences are invalid.');
  const record = value as Record<string, unknown>;
  if (record.format !== FORMAT || record.version !== VERSION) throw new Error('Application preferences are invalid.');
  const completed = record.completedGettingStartedVaults;
  if (completed !== undefined && (!Array.isArray(completed) || completed.some((item) => typeof item !== 'string'))) {
    throw new Error('Application preferences are invalid.');
  }
  return {
    format: FORMAT,
    version: VERSION,
    ...(typeof record.lastVaultPath === 'string' ? { lastVaultPath: record.lastVaultPath } : {}),
    ...(Array.isArray(completed) ? { completedGettingStartedVaults: completed as string[] } : {}),
  };
}

async function writePreferences(path: string, preferences: ApplicationPreferences): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFileAtomic(path, `${JSON.stringify(preferences, null, 2)}\n`, { mode: 0o600 });
}
