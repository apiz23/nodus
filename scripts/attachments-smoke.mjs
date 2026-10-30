import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createViteServer } from 'vite';
import { chromium } from 'playwright';

const vault = await mkdtemp(join(tmpdir(), 'nodus-attachments-smoke-'));
const png = [137, 80, 78, 71, 13, 10, 26, 10, 0];
process.env.NODUS_VAULT = vault;
let vite;
let browser;
try {
  vite = await createViteServer({ configFile: 'ui/vite.config.ts', server: { host: '127.0.0.1', port: 0 } });
  await vite.listen();
  const address = vite.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not bind a local port');
  const base = `http://127.0.0.1:${address.port}`;
  process.env.NODUS_ALLOWED_ORIGINS = base;
  const request = async (path, init = {}) => {
    const response = await fetch(`${base}/api${path}`, init);
    const text = await response.text();
    assert(response.ok, `${init.method ?? 'GET'} ${path}: ${response.status} ${text}`);
    return JSON.parse(text);
  };
  const { note } = await request('/notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Attachment smoke' }) });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/app`);
  await page.getByRole('treeitem', { name: 'Attachment smoke (attachment-smoke.md)', exact: true }).click();
  await page.getByRole('textbox', { name: 'Markdown body', exact: true }).waitFor();
  const readEditor = async () => page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('@codemirror_view.js'));
    const { EditorView } = await import(url);
    return EditorView.findFromDOM(document.querySelector('.cm-editor')).state.doc.toString();
  });
  const dispatchFile = async (mode, name, bytes, size = bytes.length) => page.evaluate(({ mode, name, bytes, size }) => {
    const editor = document.querySelector('.cm-content');
    const transfer = new DataTransfer();
    const content = size === bytes.length ? new Uint8Array(bytes) : new Uint8Array(size);
    transfer.items.add(new File([content], name, { type: 'image/png' }));
    const event = mode === 'paste'
      ? new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
      : new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: editor.getBoundingClientRect().left + 30, clientY: editor.getBoundingClientRect().top + 20 });
    return editor.dispatchEvent(event);
  }, { mode, name, bytes: png, size });

  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await dispatchFile('paste', 'pasted-image.png', png);
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('pasted-image.png'));
  await dispatchFile('drop', 'dropped-image.png', png);
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('dropped-image.png'));

  const beforeFailure = await readEditor();
  await dispatchFile('paste', 'oversized.png', png, 10 * 1024 * 1024 + 1);
  await page.getByRole('status').filter({ hasText: 'limited to 10 files' }).waitFor();
  assert.equal(await readEditor(), beforeFailure, 'oversized paste must not change the current draft');
  await dispatchFile('paste', 'spoofed.png', [60, 115, 99, 114, 105, 112, 116, 62]);
  await page.getByRole('status').filter({ hasText: 'spoofed.png' }).waitFor();
  assert.equal(await readEditor(), beforeFailure, 'rejected image upload must not change the current draft');

  await page.getByRole('button', { name: 'Open attachments', exact: true }).click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload files', exact: true }).click();
  await (await chooserPromise).setFiles([
    { name: 'uploaded-image.png', mimeType: 'image/png', buffer: Buffer.from(png) },
    { name: 'uploaded-second.png', mimeType: 'image/png', buffer: Buffer.from(png) },
  ]);
  await page.getByText('2 attachments uploaded and added to the note.', { exact: true }).waitFor();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.waitForFunction(() => document.querySelector('.cm-content')?.textContent?.includes('uploaded-image.png'));
  const finalSource = await readEditor();
  assert(finalSource.includes('pasted-image.png') && finalSource.includes('dropped-image.png') && finalSource.includes('uploaded-image.png') && finalSource.includes('uploaded-second.png'));
  const savedPath = `/notes/${note.id}`;
  let persisted = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { note: saved } = await request(savedPath);
    if (saved.body === finalSource) { persisted = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert(persisted, 'autosave did not persist inserted attachment references');
  const { attachments } = await request('/attachments');
  assert.equal(attachments.length, 4);
  assert(attachments.every((attachment) => attachment.references.includes(note.path)));
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log('Attachment browser smoke passed: paste, drop, upload, Markdown references, and failed-upload draft preservation.');
} finally {
  await browser?.close();
  await vite?.close();
  await rm(vault, { recursive: true, force: true });
}
