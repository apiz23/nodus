import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { createLocalApiMiddleware } from '../src/ui-server/api.js';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, '..');
const vaultPath = resolve(projectRoot, process.env.NODUS_VAULT ?? 'vault');
const localApi = createLocalApiMiddleware({ vaultPath });
const localUiOrigins = [
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
];

function localApiPlugin(): Plugin {
  return {
    name: 'nodus-local-api',
    configureServer(server) {
      server.middlewares.use(localApi);
    },
    configurePreviewServer(server) {
      server.middlewares.use(localApi);
    },
  };
}

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss(), localApiPlugin()],
  resolve: {
    alias: {
      '@': resolve(here, 'src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    cors: { origin: localUiOrigins },
    fs: {
      allow: [here, resolve(projectRoot, 'src'), resolve(projectRoot, 'node_modules')],
      deny: [
        // Preserve Vite's default secret-file exclusions when adding our own.
        '.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**',
        // Apply regardless of where a vault or backup is placed, including in a source directory.
        '**/*.md', '**/databases/**', '**/nodus-backup.json', '**/.nodus-tmp-*',
      ],
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: resolve(projectRoot, 'dist'),
    emptyOutDir: true,
  },
});
