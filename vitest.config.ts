import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 领域包按源码引用，单测与 Taro 构建共用同一套别名。
 * 这里刻意不 import 'vitest/config'：vitest 会把配置打包到仓库根目录的 node_modules 下，
 * 该目录由运行环境提供，解析不到 vitest 自身。
 */
const root = fileURLToPath(new URL('.', import.meta.url));
const at = (...p: string[]) => path.join(root, ...p);

export default {
  resolve: {
    alias: {
      '@zx/field-spec': at('packages', 'field-spec', 'src', 'index.ts'),
      '@zx/rules': at('packages', 'rules', 'src', 'index.ts'),
      '@zx/summary': at('packages', 'summary', 'src', 'index.ts'),
      '@zx/data': at('packages', 'data', 'src', 'index.ts'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
};