import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Admin SPA. Dev server proxies /api to the Express backend on :4000.
// `npm run build:web` outputs to ../web/dist which the server serves statically.
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  base: '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // Pure constants (no Prisma) — same reason as the client renderer.
      '@clinic/shared/constants': path.resolve(__dirname, '../../shared/src/constants.ts'),
    },
  },
  server: {
    port: 5175,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
