import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
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
  // 显式指定 tailwind config 路径。npm -w @clinic/server run build 在 packages/server/
  // 下执行 vite build --config web/vite.config.ts，cwd 是 packages/server/ 而非 web/。
  // Tailwind 的 content 相对路径 (./src/**) 会找 packages/server/src/（不存在），
  // 导致 content 为空、@apply 自定义 class (nav-item/btn/card 等) 被 tree-shake，
  // 页面表现为"纯文字没边框"。显式传 config 绝对路径修复。
  css: {
    postcss: {
      plugins: [
        tailwindcss({ config: path.resolve(__dirname, 'tailwind.config.js') }),
        autoprefixer(),
      ],
    },
  },
  server: {
    port: 5175,
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
