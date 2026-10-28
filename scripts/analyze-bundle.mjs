import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const repository = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const temporary = await mkdtemp(join(tmpdir(), 'nodus-bundle-analysis-'));
const output = join(await realpath(temporary), 'build');
const relativeOutput = relative(repository, output);
if (relativeOutput.split(sep)[0] !== '..' && !isAbsolute(relativeOutput)) {
  await rm(temporary, { recursive: true, force: true });
  throw new Error('Bundle output must be outside the repository');
}
const chunks = [];
try {
  await build({
    configFile: join(repository, 'ui/vite.config.ts'),
    build: { outDir: output, emptyOutDir: true, sourcemap: 'hidden' },
    plugins: [{
      name: 'nodus-bundle-measurements',
      generateBundle(_options, bundle) {
        for (const item of Object.values(bundle)) {
          if (item.type === 'chunk') chunks.push({ file: item.fileName, entry: item.isEntry, imports: item.imports, dynamicImports: item.dynamicImports });
        }
      },
    }],
  });
  const initial = new Set();
  function include(file) {
    if (initial.has(file)) return;
    initial.add(file);
    for (const imported of chunks.find((chunk) => chunk.file === file)?.imports ?? []) include(imported);
  }
  for (const chunk of chunks.filter((chunk) => chunk.entry)) include(chunk.file);
  const moduleBytes = new Map();
  const assets = [];
  for (const chunk of chunks) {
    const code = await readFile(join(output, chunk.file), 'utf8');
    const map = JSON.parse(await readFile(join(output, `${chunk.file}.map`), 'utf8'));
    assets.push({ ...chunk, initial: initial.has(chunk.file), bytes: Buffer.byteLength(code), gzipBytes: gzipSync(code, { level: 6 }).byteLength });
    if (initial.has(chunk.file)) {
      for (const [source, bytes] of attribute(code, map)) moduleBytes.set(source, (moduleBytes.get(source) ?? 0) + bytes);
    }
  }
  const modules = [...moduleBytes].map(([source, bytes]) => ({ source, bytes })).sort((a, b) => b.bytes - a.bytes);
  const packages = new Map();
  for (const { source, bytes } of modules) {
    const name = packageName(source);
    packages.set(name, (packages.get(name) ?? 0) + bytes);
  }
  const groups = [...packages].map(([name, bytes]) => ({ name, bytes })).sort((a, b) => b.bytes - a.bytes);
  const report = {
    node: process.version,
    methodology: 'UTF-8 byte lengths of generated spans attributed to source-map segments; minified production build with hidden maps. Segment attribution is approximate at module boundaries. Package bytes are additive; gzip uses Node zlib level 6 per complete chunk.',
    output, assets, packages: groups, modules,
    codeMirrorAndLezerBytes: groups.filter(({ name }) => name.startsWith('@codemirror/') || name.startsWith('@lezer/')).reduce((sum, item) => sum + item.bytes, 0),
    radixBytes: groups.filter(({ name }) => name.startsWith('@radix-ui/')).reduce((sum, item) => sum + item.bytes, 0),
  };
  await writeFile(join(temporary, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.table(assets.map(({ file, initial, bytes, gzipBytes }) => ({ file, initial, bytes, gzipBytes })));
  console.table(groups.slice(0, 16));
  console.table(modules.slice(0, 16).map(({ source, bytes }) => ({ source: source.includes('/node_modules/') ? source.slice(source.lastIndexOf('/node_modules/') + 14) : source.split('/ui/src/').pop(), bytes })));
  console.log(`CodeMirror + Lezer: ${report.codeMirrorAndLezerBytes} attributed bytes; Radix: ${report.radixBytes} attributed bytes`);
  console.log(`Build and complete report retained outside the repository: ${join(temporary, 'report.json')}`);
} catch (error) {
  await rm(temporary, { recursive: true, force: true });
  throw error;
}

// Source-map v3 base64 VLQ segments. Source indices are delta encoded across
// lines; generated columns reset on each line. Unmapped spans remain explicit.
function attribute(code, map) {
  const lines = code.split('\n');
  const mappings = map.mappings.split(';');
  const totals = new Map();
  let source = 0;
  const add = (name, value) => totals.set(name, (totals.get(name) ?? 0) + Buffer.byteLength(value));
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line];
    let column = 0;
    const segments = [];
    for (const segment of (mappings[line] ?? '').split(',')) {
      if (!segment) continue;
      const values = vlq(segment);
      if (![1, 4, 5].includes(values.length)) throw new Error('Invalid source-map segment');
      column += values[0];
      if (values.length > 1) source += values[1];
      if (column > text.length || (values.length > 1 && map.sources[source] === undefined)) throw new Error('Source-map index is out of bounds');
      segments.push({ column, name: values.length > 1 ? map.sources[source] : '(unmapped)' });
    }
    add('(unmapped)', text.slice(0, segments[0]?.column ?? text.length));
    for (let index = 0; index < segments.length; index++) {
      add(segments[index].name, text.slice(segments[index].column, segments[index + 1]?.column ?? text.length));
    }
    if (line < lines.length - 1) add('(unmapped)', '\n');
  }
  if ([...totals.values()].reduce((sum, bytes) => sum + bytes, 0) !== Buffer.byteLength(code)) throw new Error('Source-map attribution did not account for the complete chunk');
  return totals;
}

function vlq(segment) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const values = [];
  let value = 0;
  let shift = 0;
  for (const character of segment) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error('Invalid source-map digit');
    value += (digit & 31) * 2 ** shift;
    if (digit & 32) shift += 5;
    else {
      values.push(value & 1 ? -Math.floor(value / 2) : Math.floor(value / 2));
      value = 0;
      shift = 0;
    }
  }
  if (shift !== 0) throw new Error('Incomplete source-map segment');
  return values;
}

function packageName(source) {
  const marker = '/node_modules/';
  const offset = source.lastIndexOf(marker);
  if (offset >= 0) {
    const pieces = source.slice(offset + marker.length).split('/');
    return pieces[0].startsWith('@') ? pieces.slice(0, 2).join('/') : pieces[0];
  }
  return source.includes('/ui/src/') || source.startsWith('../src/') ? '(application)' : '(runtime/unmapped)';
}
