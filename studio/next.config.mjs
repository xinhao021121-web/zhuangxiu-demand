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
};

/** API 服务地址：桌面端不直连模型，也不在浏览器里做脱敏（技术方案 2.4）。 */
const API_BASE = process.env.API_BASE ?? 'http://127.0.0.1:8787';

export default {
  reactStrictMode: true,
  transpilePackages: Object.keys(ALIAS),
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, ...ALIAS };
    return config;
  },
  turbopack: { resolveAlias: ALIAS },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_BASE}/:path*` }];
  },
};
