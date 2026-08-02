import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // Pure constants (no Prisma) reachable from the renderer. The shared
      // barrel re-exports the Prisma client which breaks the browser bundle
      // ("process is not defined"), so we alias a Prisma-free subpath to the
      // source constants.ts directly. parseYuanToCents etc. live here.
      '@clinic/shared/constants': path.resolve(__dirname, '../shared/src/constants.ts'),
    },
  },
  // 显式指定 tailwind config 绝对路径，避免 cwd 非 packages/client/ 时 content
  // 解析失败导致 @apply 自定义 class 被 tree-shake（与 web/vite.config.ts 同因）。
  css: {
    postcss: {
      plugins: [
        tailwindcss({ config: path.resolve(__dirname, 'tailwind.config.js') }),
        autoprefixer(),
      ],
    },
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
