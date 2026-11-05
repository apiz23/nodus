import { createServer } from 'node:http';
import { createLocalApiMiddleware } from '../src/ui-server/api.ts';
import { FileSystemVault } from '../src/storage/fs/vault.ts';

const mode = process.env.NODUS_IMPORT_CRASH_MODE ?? '';
const targetPath = process.env.NODUS_IMPORT_CRASH_PATH ?? '';
const prototype = FileSystemVault.prototype;
const forever = () => new Promise(() => undefined);
const pause = (boundary, path = undefined) => {
  if (typeof process.send === 'function') process.send({ type: 'paused', boundary, path });
  return forever();
};

if (mode === 'staging' || mode === 'journal-published') {
  const original = prototype.writeImportJournal;
  prototype.writeImportJournal = async function (directory, journal) {
    if (typeof process.send === 'function') process.send({ type: 'journal', state: journal.state, publications: journal.files.map((file) => file.publication) });
    await original.call(this, directory, journal);
    if (mode === 'staging' && journal.state === 'staging') await pause('staging-journal-durable');
    if (mode === 'journal-published' && journal.state === 'publishing' && journal.files.some((file) => file.publication === 'published')) await pause('published-journal-durable');
  };
}

if (mode === 'add-published' || mode === 'rollback') {
  const original = prototype.publishImportDocument;
  let calls = 0;
  prototype.publishImportDocument = async function (path, ...args) {
    calls += 1;
    if (mode === 'rollback' && calls === 2) throw new Error('Injected failure before the second resource publication.');
    const result = await original.call(this, path, ...args);
    if (mode === 'add-published' && path === targetPath) await pause('addition-published-before-journal', path);
    return result;
  };
}

if (mode === 'replace-published') {
  const original = prototype.writeDocument;
  prototype.writeDocument = async function (path, ...args) {
    const result = await original.call(this, path, ...args);
    if (path === targetPath) await pause('replacement-renamed-before-publication-journal', path);
    return result;
  };
}

if (mode === 'replace-temp-journaled') {
  const original = prototype.writeDocument;
  prototype.writeDocument = async function (path, text, allowReserved, beforeWrite, beforeRename) {
    if (path !== targetPath) return original.call(this, path, text, allowReserved, beforeWrite, beforeRename);
    const pauseAfterJournal = async (temporaryPath) => {
      await beforeRename?.(temporaryPath);
      await pause('replacement-temp-journaled-before-rename', path);
    };
    return original.call(this, path, text, allowReserved, beforeWrite, pauseAfterJournal);
  };
}

if (mode === 'rollback') {
  const original = prototype.rollbackImportJournal;
  prototype.rollbackImportJournal = async function (...args) {
    const result = await original.apply(this, args);
    await pause('rollback-files-restored-before-journal-update');
    return result;
  };
}

const middleware = createLocalApiMiddleware({ vaultPath: process.env.NODUS_VAULT });
const server = createServer((request, response) => middleware(request, response, () => {
  response.statusCode = 404;
  response.end();
}));
server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Import worker did not bind a TCP port.');
  if (typeof process.send === 'function') process.send({ type: 'ready', port: address.port });
});

process.on('SIGTERM', () => {
  server.closeAllConnections();
  server.close(() => { void middleware.dispose().finally(() => process.exit(0)); });
});
