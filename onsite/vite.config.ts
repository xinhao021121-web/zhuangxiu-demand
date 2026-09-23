import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * 现场端是独立工程：要的是离线优先（service worker + 本地库 + 重连同步）与单手可操作，
 * 与桌面端共用 packages/* 与契约，不共用构建（技术方案 2.3）。
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const at = (...p: string[]) => path.join(root, ...p);

const ALIAS = {
  '@zx/field-spec': at('packages', 'field-spec', 'src', 'index.ts'),
  '@zx/rules': at('packages', 'rules', 'src', 'index.ts'),
  '@zx/summary': at('packages', 'summary', 'src', 'index.ts'),
  '@zx/checklist': at('packages', 'checklist', 'src', 'index.ts'),
  '@zx/redact': at('packages', 'redact', 'src', 'index.ts'),
  '@zx/contracts': at('packages', 'contracts', 'src', 'index.ts'),
};

/** 现场走公网访问的是同一个服务；本地开发用代理，省掉 CORS（技术方案 7.2）。 */
const API_BASE = process.env.API_BASE ?? 'http://127.0.0.1:8787';
const proxy = {
  '/api': {
    target: API_BASE,
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/api/, ''),
  },
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias: ALIAS },
  server: { port: 5174, proxy },
  preview: { port: 4200, proxy },
  build: { outDir: 'dist' },
});
