import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

describe('local attachment API', () => {
  let server: Server | undefined;
  let root: string | undefined;
  afterEach(async () => {
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it('uploads, lists, opens, and deletes validated active-vault attachments', async () => {
    root = await mkdtemp(join(tmpdir(), 'nodus-attachments-'));
    const vault = join(root, 'vault');
    const middleware = createLocalApiMiddleware({ vaultPath: vault });
    server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');
    const base = `http://127.0.0.1:${address.port}`;
    const upload = await fetch(`${base}/api/attachments?name=${encodeURIComponent('scene.png')}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: PNG });
    expect(upload.status).toBe(201);
    const { attachment } = await upload.json() as { attachment: { path: string; contentType: string } };
    expect(attachment.path).toMatch(/^attachments\//);
    const list = await (await fetch(`${base}/api/attachments`)).json() as { attachments: unknown[] };
    expect(list.attachments).toHaveLength(1);
    const opened = await fetch(`${base}/api/attachments/open?path=${encodeURIComponent(attachment.path)}`);
    expect(opened.status).toBe(200);
    expect(opened.headers.get('content-type')).toBe('image/png');
    expect(opened.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await opened.arrayBuffer())).toEqual(PNG);
    const pdfBytes = Buffer.from('%PDF-1.4\n%Nodus attachment\n');
    const pdfResponse = await fetch(`${base}/api/attachments?name=guide.pdf`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: pdfBytes });
    const { attachment: pdf } = await pdfResponse.json() as { attachment: { path: string } };
    const pdfOpen = await fetch(`${base}/api/attachments/open?path=${encodeURIComponent(pdf.path)}`);
    expect(pdfOpen.status).toBe(200);
    expect(pdfOpen.headers.get('content-type')).toBe('application/pdf');
    expect(pdfOpen.headers.get('content-disposition')).toContain('inline');
    expect(pdfOpen.headers.get('content-security-policy')).toContain('sandbox');
    expect(Buffer.from(await pdfOpen.arrayBuffer())).toEqual(pdfBytes);
    expect((await fetch(`${base}/api/attachments/open?path=${encodeURIComponent('../outside.png')}`)).status).toBe(400);
    const deleted = await fetch(`${base}/api/attachments`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: attachment.path }) });
    expect(deleted.status).toBe(200);
  });

  it('rejects unsupported and spoofed uploads without storing them', async () => {
    root = await mkdtemp(join(tmpdir(), 'nodus-attachments-'));
    const middleware = createLocalApiMiddleware({ vaultPath: join(root, 'vault') });
    server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');
    const base = `http://127.0.0.1:${address.port}`;
    const unsupported = await fetch(`${base}/api/attachments?name=payload.svg`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: PNG });
    expect(unsupported.status).toBe(400);
    const traversal = await fetch(`${base}/api/attachments?name=${encodeURIComponent('../outside.png')}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: PNG });
    expect(traversal.status).toBe(400);
    const spoofed = await fetch(`${base}/api/attachments?name=payload.png`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('<script>') });
    expect(spoofed.status).toBe(422);
    expect((await (await fetch(`${base}/api/attachments`)).json() as { attachments: unknown[] }).attachments).toHaveLength(0);
    const large = await fetch(`${base}/api/attachments?name=large.png`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.alloc(10 * 1024 * 1024 + 1) });
    expect(large.status).toBe(413);
  });

  it('refuses symlinked attachment opens', async () => {
    root = await mkdtemp(join(tmpdir(), 'nodus-attachments-'));
    const vault = join(root, 'vault');
    await mkdir(join(vault, 'attachments'), { recursive: true });
    const outside = join(root, 'outside.png');
    await writeFile(outside, PNG);
    const path = 'attachments/11111111-1111-4111-8111-111111111111-outside.png';
    await symlink(outside, join(vault, path));
    const middleware = createLocalApiMiddleware({ vaultPath: vault });
    server = createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/attachments/open?path=${encodeURIComponent(path)}`);
    expect(response.status).toBe(400);
  });
});
