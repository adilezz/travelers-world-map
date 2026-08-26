import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const apiProxy = {
  '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
};

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        spike: resolve(__dirname, 'spike/index.html'),
      },
    },
    // The renderer is large and unavoidable (doc 4 §11); everything else must
    // stay small. Splitting it out is what makes that measurable.
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: apiProxy,
  },
  preview: {
    port: 4173,
    host: '127.0.0.1',
    proxy: apiProxy,
  },
});
