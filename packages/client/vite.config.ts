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
  },
});
