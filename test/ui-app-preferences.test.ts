import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applicationPreferencesPath, gettingStartedCompleted, readLastVaultPreference, setGettingStartedCompleted, writeLastVaultPreference } from '../src/ui-server/app-preferences.js';
import { withTempDir } from './tmp.js';

describe('application vault preferences', () => {
  it('uses a per-user configuration location outside vault contents', () => {
    expect(applicationPreferencesPath({ APPDATA: 'C:\\Users\\A\\AppData\\Roaming' } as NodeJS.ProcessEnv, 'win32', 'C:\\Users\\A'))
      .toBe(win32.join('C:\\Users\\A\\AppData\\Roaming', 'Nodus', 'preferences.json'));
    expect(applicationPreferencesPath({ XDG_CONFIG_HOME: '/home/a/.config-test' } as NodeJS.ProcessEnv, 'linux', '/home/a'))
      .toBe(posix.join('/home/a/.config-test', 'nodus', 'preferences.json'));
    expect(applicationPreferencesPath({ XDG_CONFIG_HOME: 'relative-config' } as NodeJS.ProcessEnv, 'linux', '/home/a'))
      .toBe(posix.join('/home/a/.config', 'nodus', 'preferences.json'));
  });

  it('reads a missing preference as first-run and round-trips a selected path', async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, 'config', 'preferences.json');
      expect(await readLastVaultPreference(file)).toEqual({ kind: 'missing' });
      await writeLastVaultPreference(file, join(dir, 'vault'));
      expect(await readLastVaultPreference(file)).toEqual({ kind: 'valid', path: join(dir, 'vault') });
      const stored = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
      expect(stored).toEqual({
        format: 'nodus-application-preferences',
        version: 1,
        lastVaultPath: join(dir, 'vault'),
      });
      if (process.platform !== 'win32') expect((await stat(file)).mode & 0o077).toBe(0);
    });
  });

  it('rejects malformed, unsupported, and relative preference data without rewriting it', async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, 'preferences.json');
      await writeFile(file, '{broken', 'utf8');
      expect(await readLastVaultPreference(file)).toEqual({ kind: 'invalid' });
      await writeFile(file, JSON.stringify({ format: 'nodus-application-preferences', version: 7, lastVaultPath: '/vault' }), 'utf8');
      expect(await readLastVaultPreference(file)).toEqual({ kind: 'invalid' });
      await writeFile(file, JSON.stringify({ format: 'nodus-application-preferences', version: 1, lastVaultPath: 'relative' }), 'utf8');
      expect(await readLastVaultPreference(file)).toEqual({ kind: 'invalid' });
      await writeFile(file, JSON.stringify({ format: 'nodus-application-preferences', version: 1, lastVaultPath: '/vault', futureField: true }), 'utf8');
      expect(await readLastVaultPreference(file)).toEqual({ kind: 'invalid' });
    });
  });

  it('writes atomically and leaves an existing preference untouched when the write fails', async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, 'preferences.json');
      await writeLastVaultPreference(file, join(dir, 'old-vault'));
      const before = await readFile(file, 'utf8');
      const blocker = join(dir, 'blocker');
      await writeFile(blocker, 'not a directory', 'utf8');
      await expect(writeLastVaultPreference(join(blocker, 'preferences.json'), join(dir, 'next-vault'))).rejects.toBeDefined();
      expect(await readFile(file, 'utf8')).toBe(before);
      expect(JSON.parse(before)).toMatchObject({ version: 1, lastVaultPath: join(dir, 'old-vault') });
    });
  });

  it('persists getting-started completion per vault and preserves it when the last vault changes', async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, 'preferences.json');
      const firstVault = join(dir, 'first');
      const secondVault = join(dir, 'second');
      expect(await gettingStartedCompleted(file, firstVault)).toBe(false);
      await setGettingStartedCompleted(file, firstVault, true);
      expect(await gettingStartedCompleted(file, firstVault)).toBe(true);
      expect(await gettingStartedCompleted(file, secondVault)).toBe(false);
      await writeLastVaultPreference(file, secondVault);
      expect(await gettingStartedCompleted(file, firstVault)).toBe(true);
      expect(await readLastVaultPreference(file)).toEqual({ kind: 'valid', path: secondVault });
    });
  });
});
