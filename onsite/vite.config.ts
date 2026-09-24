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
  '@zx/data': at('packages', 'data', 'src', 'index.ts'),
  '@zx/checklist': at('packages', 'checklist', 'src', 'index.ts'),
  '@zx/redact': at('packages', 'redact', 'src', 'index.ts'),
  '@zx/contracts': at('packages', 'contracts', 'src', 'index.ts'),
  '@zx/service': at('packages', 'service', 'src', 'index.ts'),
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

/** 部署到子路径时用 /<repo>/onsite/（GitHub Pages 的仓库页）。 */
const BASE = process.env.EXPORT_BASE_PATH ? process.env.EXPORT_BASE_PATH + '/' : '/';

export default defineConfig({
  base: BASE,
  plugins: [react()],
  resolve: { alias: ALIAS },
  // 种子数据在仓库根的 services/api/seed 下：两个端与单测读同一份
  server: { port: 5174, proxy, fs: { allow: [root] } },
  preview: { port: 4200, proxy },
  build: { outDir: 'dist' },
});
