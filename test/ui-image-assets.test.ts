import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';

describe('local Markdown image assets', () => {
  let server: Server | undefined;
  let root: string | undefined;
  afterEach(async () => {
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it('serves only bounded, supported, regular image files inside the vault', async () => {
    root = await mkdtemp(join(tmpdir(), 'nodus-images-'));
    const vault = join(root, 'vault');
    await mkdir(join(vault, 'assets'), { recursive: true });
    await writeFile(join(vault, 'assets', 'cover.png'), Buffer.from([137, 80, 78, 71]));
    await writeFile(join(root, 'outside.png'), Buffer.from('outside'));
    await symlink(join(root, 'outside.png'), join(vault, 'assets', 'linked.png'));
    const middleware = createLocalApiMiddleware({ vaultPath: vault });
    server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');
    const base = `http://127.0.0.1:${address.port}`;

    const image = await fetch(`${base}/api/assets/image?path=assets%2Fcover.png`);
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(image.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(Buffer.from([137, 80, 78, 71]));

    const traversal = await fetch(`${base}/api/assets/image?path=..%2Foutside.png`);
    expect(traversal.status).toBe(400);
    const symlinked = await fetch(`${base}/api/assets/image?path=assets%2Flinked.png`);
    expect(symlinked.status).toBe(400);
    const wrongType = await fetch(`${base}/api/assets/image?path=assets%2Fcover.md`);
    expect(wrongType.status).toBe(400);
  });
});
