import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: process.env.CLINIC_SERVER_URL || 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist-renderer',
    emptyOutDir: true,
    // The renderer runs inside Electron 33 (Chromium ~130), which supports
    // top-level await / es2022+. The default vite target (chrome87) is too low
    // and breaks because @clinic/shared's barrel re-exports the Prisma client
    // (which uses top-level await in its CLI guard). esnext is safe here.
    target: 'esnext',
  },
});
