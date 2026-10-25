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
    fs: { allow: [projectRoot] },
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
