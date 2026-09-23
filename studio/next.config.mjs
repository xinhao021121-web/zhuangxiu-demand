import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 领域包按源码引用：三个端跑的是同一份判断依据（技术方案 2.2）。
 * 桌面端与现场端各自写别名，不共用构建，也不动仓库根目录的 node_modules。
 */
const root = fileURLToPath(new URL('..', import.meta.url));
const at = (...p) => path.join(root, ...p);

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

/** API 服务地址：桌面端不直连模型，也不在浏览器里做脱敏（技术方案 2.4）。 */
const API_BASE = process.env.API_BASE ?? 'http://127.0.0.1:8787';

/**
 * 两种产物：
 *   - 默认：带服务端的构建（next start），/api 由 rewrite 代理到 API 服务；
 *   - NEXT_PUBLIC_DEMO=1：静态导出（GitHub Pages 这类纯静态托管），接口改用浏览器内的演示服务。
 */
const DEMO = process.env.NEXT_PUBLIC_DEMO === '1';
/** 部署到子路径时用（GitHub Pages 的仓库页是 /<repo>/studio）。 */
const BASE_PATH = process.env.EXPORT_BASE_PATH ?? '';

export default {
  reactStrictMode: true,
  transpilePackages: Object.keys(ALIAS),
  // 种子数据在 services/api/seed 下：两个端与单测读同一份，避免故事对不上
  experimental: { externalDir: true },
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, ...ALIAS };
    return config;
  },
  turbopack: { resolveAlias: ALIAS },
  ...(BASE_PATH ? { basePath: BASE_PATH, assetPrefix: BASE_PATH } : {}),
  ...(DEMO
    ? {
        output: 'export',
        images: { unoptimized: true },
        trailingSlash: true,
        // 静态导出另用一个构建目录，别把 next start 用的产物覆盖掉
        distDir: process.env.EXPORT_DIST_DIR ?? '.next-export',
      }
    : {
        async rewrites() {
          return [{ source: '/api/:path*', destination: `${API_BASE}/:path*` }];
        },
      }),
};
