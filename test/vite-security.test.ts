import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isFileLoadingAllowed, resolveConfig } from 'vite';
import viteConfig from '../ui/vite.config.js';
import { withTempDir } from './tmp.js';

describe('Vite development file policy', () => {
  it('denies vault/backup data even inside allowed source directories, while allowing application assets', async () => {
    await withTempDir(async (cacheDir) => {
      const config = await resolveConfig({ ...viteConfig, configFile: false, plugins: [], envDir: false, cacheDir }, 'serve');
      for (const path of [
        'vault/notes/a.md', 'backup/databases/example.json', '.impeccable/review/example.png',
        'ui/private/a.md', 'ui/private/A.MD', 'src/private/a.md',
        'ui/recovery/databases/example.json', 'ui/recovery/DATABASES/example.json',
        'ui/recovery/database-views/db/view.json', 'src/private/DATABASE-VIEWS/db/view.json',
        'ui/recovery/nodus-backup.json', 'src/private/.nodus-tmp-example',
        'ui/.env', 'ui/.env.local', 'ui/private.key', 'ui/.git/config',
      ]) {
        expect(isFileLoadingAllowed(config, resolve(path)), path).toBe(false);
      }
      for (const path of ['ui/index.html', 'ui/src/App.tsx', 'src/links/wikilink.ts', 'node_modules/@fontsource-variable/geist/index.css']) {
        expect(isFileLoadingAllowed(config, resolve(path)), path).toBe(true);
      }
    });
  });

  it('limits static CORS access to the Nodus UI origins', () => {
    const cors = viteConfig.server?.cors;
    expect(cors).toEqual({ origin: [
      'http://127.0.0.1:5173', 'http://localhost:5173',
      'http://127.0.0.1:4173', 'http://localhost:4173',
    ] });
  });
});
