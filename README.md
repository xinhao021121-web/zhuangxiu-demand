# 装修需求发现助手

用纯规则，从房主已经填写的装修需求里，找出他想要但没说出口的需求。

- 产品设计文档：`docs/装修需求发现助手_产品设计文档_V1.md`
- 技术方案：`docs/装修需求发现助手_技术方案_V1.md`
- 设计需求解读台（规划中）：`docs/设计需求解读台_产品设计文档_V1.md`
- 正式实现：`app/`（Taro + React + TypeScript，一套代码产出微信小程序与 H5）
- 领域层：`packages/`（字段规格、规则引擎、摘要、数据仓储，零框架依赖）

## 仓库结构

```
app/                  Taro 应用（weapp + h5）
packages/
  field-spec/         字段规格（由字段清单 Excel 导出）、表单模型与校验
  rules/              规则引擎：命中、排序、去重、静默状态机、写回动作
  summary/            需求摘要与量房确认清单文本
  data/               草稿读写、版本迁移、提交与埋点
  devtools/           单测与类型检查用的开发依赖
tools/                字段清单 Excel → JSON、Demo 构建脚本
docs/                 产品文档与技术方案
demo/  mobile/        早期 H5 Demo，作为交互设计稿保留，不再演进
tests/                三层测试（领域单测 + H5 端到端 + Demo 冒烟）
```

## 安装依赖

本机的仓库根目录 `node_modules` 由运行环境提供（指向共享运行时目录，Playwright 等来自这里），
pnpm 无法接管它，因此依赖**按包安装**，不要执行仓库根目录的 `pnpm install`：

```bash
pnpm install --dir packages/devtools --ignore-workspace   # 单测与类型检查
pnpm install --dir app --ignore-workspace                 # 应用与构建
```

仓库根目录的 `pnpm run` 已经关闭自动依赖检查（见 `pnpm-workspace.yaml` 的 `verifyDepsBeforeRun`）。

## 常用命令

```bash
pnpm run build:spec      # 字段清单 Excel → packages/field-spec 的 JSON（需带 openpyxl 的 Python）
pnpm run test:unit       # 领域层单测（Vitest）
pnpm run build:h5        # H5 产物 → app/dist/h5（宽屏即 Web 端）
pnpm run test:app        # H5 产物端到端（Playwright，宽屏 + 窄屏）
pnpm run build:weapp     # 微信小程序产物 → app/dist/weapp
pnpm run test:demo       # 早期 Demo 的冒烟测试（回归用）
pnpm run typecheck       # 领域层与应用配置的 TypeScript 检查
```

小程序端用微信开发者工具打开 `app/`（`project.config.json` 的 `miniprogramRoot` 指向 `dist/weapp/`）。

## 上线（Web 端 / 展示版）

- 线上地址（GitHub Pages）：<https://xinhao021121-web.github.io/zhuangxiu-demand/>
- 仓库：<https://github.com/xinhao021121-web/zhuangxiu-demand>

```bash
pnpm run build:h5          # 产物：app/dist/h5
pnpm run preview:h5        # 本机 http://127.0.0.1:4173
pnpm run preview:h5:lan    # 局域网/手机可访问
pnpm run test:preview      # 上线前冒烟：HTTP 行为 + 真实地址首屏
pnpm run test:live         # 上线后验证线上地址
pnpm run deploy:pages      # 发布到 GitHub Pages（gh-pages 分支）
```

上线方式、缓存策略、发版流程见 `deploy/README.md`；Vercel / Netlify / Nginx 的现成配置在 `deploy/` 下。
同一份产物宽屏是 Web 端、窄屏是展示版，不必分别构建。

## 验证清单

| 层 | 命令 | 覆盖 |
| --- | --- | --- |
| 领域包 | `pnpm run test:unit` | 字段规格、规则命中与排序去重、静默状态机、写回动作、摘要、草稿迁移 |
| H5 产物 | `pnpm run test:app` | 填表、空间实例与房型、发现与三动作、静默、摘要、提交前检查、断点恢复、两端布局指标 |
| Web 上线 | `pnpm run test:preview` | 静态服务的 HTTP 行为、缓存头、深链接回退与首屏可用性 |
| 线上地址 | `pnpm run test:live` | 公网地址可访问、产物可加载、首屏可用、控制台无错误 |
| 早期 Demo | `pnpm run test:demo` | 交互设计稿的回归断言 |

小程序端没有稳定的自动验证手段（需要开发者工具），因此规则、排序、去重、静默、摘要、草稿迁移
全部放在零框架依赖的领域包里用 Vitest 覆盖，呈现层只做「读状态、渲染、派发事件」。
