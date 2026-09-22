import path from 'node:path';
import { defineConfig } from '@tarojs/cli';
import type { UserConfigExport } from '@tarojs/cli';

/**
 * 领域包按源码引用：Taro 构建与 Vitest 单测使用同一套别名，
 * 因此 app 不需要把 packages/* 装进 node_modules（见 app/README.md）。
 */
const domain = (name: string) => path.resolve(__dirname, '..', '..', 'packages', name, 'src', 'index.ts');

export default defineConfig<'webpack5'>(async (merge) => {
  const baseConfig: UserConfigExport<'webpack5'> = {
    projectName: 'zhuangxiu-demand-app',
    date: '2026-9-23',
    // 关闭 rem 适配，宽屏 Web 与窄屏小程序都用 px + 媒体查询
    designWidth: 750,
    deviceRatio: { 640: 2.34 / 2, 750: 1, 828: 1.81 / 2 },
    sourceRoot: 'src',
    outputRoot: `dist/${process.env.TARO_ENV}`,
    plugins: [],
    defineConstants: {},
    copy: { patterns: [], options: {} },
    framework: 'react',
    compiler: { type: 'webpack5', prebundle: { enable: false } },
    cache: { enable: false },

    alias: {
      '@zx/field-spec': domain('field-spec'),
      '@zx/rules': domain('rules'),
      '@zx/summary': domain('summary'),
      '@zx/data': domain('data'),
    },
    mini: {
      // 领域包在 packages/ 下，两端都要一起过 babel
      compile: { include: [path.resolve(__dirname, '..', '..', 'packages')] },
      postcss: {
        pxtransform: { enable: false },
        url: { enable: true, config: { limit: 1024 } },
        cssModules: { enable: false },
      },
    },
    h5: {
      compile: { include: [path.resolve(__dirname, '..', '..', 'packages')] },
      publicPath: './',
      staticDirectory: 'static',
      output: {
        filename: 'js/[name].[hash:8].js',
        chunkFilename: 'js/[name].[chunkhash:8].js',
      },
      router: { mode: 'hash' },
      postcss: {
        pxtransform: { enable: false },
        autoprefixer: { enable: true },
        cssModules: { enable: false },
      },
    },
  };
  return merge({}, baseConfig);
});
