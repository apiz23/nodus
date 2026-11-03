import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = await mkdtemp(join(tmpdir(), 'nodus-graph-canvas-'));
process.env.NODUS_VAULT = root;
let server, browser;
try {
  server = await createServer({ configFile: 'ui/vite.config.ts', server: { port: 0, strictPort: false } });
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  process.env.NODUS_ALLOWED_ORIGINS = base;
  const request = async (path, method = 'GET', body) => {
    const response = await fetch(`${base}/api${path}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
    const data = await response.json();
    assert(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
    return data;
  };
  const create = async (title, body = '') => {
    const { note } = await request('/notes', 'POST', { title });
    if (body !== '') await request(`/notes/${note.id}`, 'PUT', { title: note.title, body, baseHash: note.contentHash });
    return note;
  };
  await create('Canvas alpha', '[[Canvas beta]] [[Canvas gamma]]');
  await create('Canvas beta', '[[Canvas gamma]]');
  await create('Canvas gamma', '');
  await create('Canvas lone', '');

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${base}/app`);
  await page.getByRole('button', { name: 'Local graph', exact: true }).click();
  await page.getByRole('heading', { name: 'Local graph', exact: true }).waitFor();
  const canvas = page.locator('[data-graph-canvas]');
  const viewGroup = page.locator('[data-graph-viewport]');
  await canvas.waitFor();
  const box = await canvas.boundingBox();
  assert(box);

  const beforePan = await viewGroup.getAttribute('transform');
  await page.mouse.move(box.x + 12, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + 112, box.y + 72, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  const afterPan = await viewGroup.getAttribute('transform');
  assert.notEqual(afterPan, beforePan, 'Canvas pan did not change the viewport');

  const node = page.getByRole('button', { name: 'Select Canvas alpha' });
  const circle = node.locator('circle').first();
  const beforeNode = { cx: Number(await circle.getAttribute('cx')), cy: Number(await circle.getAttribute('cy')) };
  const viewportBeforeNode = await viewGroup.getAttribute('transform');
  const nodeBox = await node.boundingBox();
  assert(nodeBox);
  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(nodeBox.x + nodeBox.width / 2 + 90, nodeBox.y + nodeBox.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const afterNode = { cx: Number(await circle.getAttribute('cx')), cy: Number(await circle.getAttribute('cy')) };
  assert(Math.abs(afterNode.cx - beforeNode.cx) > 10 || Math.abs(afterNode.cy - beforeNode.cy) > 10, 'Node drag did not move the node');
  assert.equal(await viewGroup.getAttribute('transform'), viewportBeforeNode, 'Node drag panned the canvas');
  await page.getByRole('heading', { name: 'Local graph', exact: true }).waitFor();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Select Canvas alpha' }).locator('circle').first().dblclick();
  await page.waitForFunction(() => document.querySelector('#note-title')?.value === 'Canvas alpha');
  await page.getByRole('button', { name: 'Local graph', exact: true }).click();
  await page.getByRole('heading', { name: 'Local graph', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Select Canvas alpha' }).click();
  await page.getByRole('heading', { name: 'Incoming links (0)', exact: true }).waitFor();

  await page.getByRole('button', { name: 'Fit graph to screen' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  const scaleAfterZoom = Number(await viewGroup.getAttribute('data-scale'));
  assert(scaleAfterZoom > 0, 'Zoom in did not change scale');
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.4);
  await page.mouse.wheel(0, -800);
  await page.waitForTimeout(100);
  const scaleAfterWheel = Number(await viewGroup.getAttribute('data-scale'));
  assert(scaleAfterWheel >= scaleAfterZoom, 'Pointer wheel zoom did not zoom in');
  assert(scaleAfterWheel <= 3, 'Zoom exceeded maximum scale');
  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.waitForTimeout(100);
  assert.equal(Number(await viewGroup.getAttribute('data-scale')), 1);

  await page.getByRole('button', { name: 'Save current graph view' }).click();
  await page.getByLabel('Name').fill('Canvas positions');
  await page.getByRole('button', { name: 'Save view', exact: true }).click();
  const savedPosition = { cx: Number(await circle.getAttribute('cx')), cy: Number(await circle.getAttribute('cy')) };
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Local graph', exact: true }).click();
  await page.getByRole('combobox', { name: 'Saved graph view' }).click();
  await page.getByRole('option', { name: 'Canvas positions' }).click();
  await page.waitForTimeout(150);
  const restoredCircle = page.getByRole('button', { name: 'Select Canvas alpha' }).locator('circle').first();
  assert(Math.abs(Number(await restoredCircle.getAttribute('cx')) - savedPosition.cx) < 1);
  assert(Math.abs(Number(await restoredCircle.getAttribute('cy')) - savedPosition.cy) < 1);

  await page.getByRole('button', { name: 'Reset view' }).click();
  await page.getByRole('button', { name: 'Fit graph to screen' }).click();
  assert.deepEqual(errors, []);
  console.log('Graph canvas smoke passed: canvas pan, pointer zoom, zoom limits/reset, node drag without pan, selection, fit, and saved node positions.');
} finally {
  await browser?.close();
  await server?.close();
  await rm(root, { recursive: true, force: true });
}
