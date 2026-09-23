# 问需

把装修需求问全、问清、问定：房主填需求单 → 设计师出门前做出沟通清单 → 现场照着问、带一份记录回来。

- 产品设计文档：`docs/问需_产品设计文档_V1.md`（定位、三个端、回流闭环）
- 技术方案：`docs/问需_技术方案_V1.md`


- 解读端 Demo：`designer/设计需求解读台_Demo_V0.1.html`（双击打开，数据模拟）
- 现场端 Demo：`designer/现场量房_Demo_V0.1.html`（双击打开；也可用手机访问）
- 采集端实现：`app/`（Taro + React + TypeScript，一套代码产出微信小程序与 H5）
- 领域层：`packages/`（字段规格、规则引擎、摘要、数据仓储、清单判据、脱敏与外发，零框架依赖）

## 仓库结构

```
landing/              入口页（作品集首页：讲清问需与关键设计点，再分发三个入口）
app/                  采集端（Taro：weapp + h5；pwa/ 是手机版资产，只复制进 H5 产物）
services/api/         API 服务（Hono + node:sqlite）：鉴权与角色、需求单与清单、外发审计
studio/               解读端 · 桌面工作台（Next.js）：导入 → 确认外发 → 表格理解 → 清单 → 导出
onsite/               现场端（Vite + React + PWA）：逐空间问、记一笔、离线记录与同步、量房记录
packages/
  field-spec/         字段规格（由字段清单 Excel 导出）、表单模型与校验
  rules/              规则引擎：命中、排序、去重、静默状态机、写回动作
  summary/            需求摘要与量房确认清单文本
  data/               草稿读写、版本迁移、提交与埋点
  checklist/          量房沟通清单：四类来源、判据筛选、合并去重、排序计数、导出
  redact/             外发脱敏：字段级三级策略、自由文本替换、外发 payload 与审计记录
  contracts/          API 契约与共享类型（zod → 类型 + OpenAPI）
  devtools/           单测与类型检查用的开发依赖
tools/                字段清单 Excel → JSON、Demo 构建脚本
docs/                 问需的产品设计文档与技术方案
demo/  mobile/        早期 H5 Demo，作为交互设计稿保留，不再演进
designer/            设计需求解读台 Demo + 现场量房手机端 Demo（数据模拟）
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
pnpm run api:dev        # 起 API 服务（默认 http://127.0.0.1:8787，种子数据自动灌入）
 pnpm run studio:dev     # 起桌面工作台（默认 http://127.0.0.1:3000，需要 API 一起跑）
 pnpm run onsite:dev     # 起现场端（默认 http://127.0.0.1:5174，需要 API 一起跑）
pnpm run test:api       # 只跑 API 层测试
pnpm run measure:model  # 真实模型实测（三个种子场景各跑一次，出耗时/降级/合并口径；需要 DEEPSEEK_API_KEY）
pnpm run typecheck       # 领域层与应用配置的 TypeScript 检查
```

小程序端用微信开发者工具打开 `app/`（`project.config.json` 的 `miniprogramRoot` 指向 `dist/weapp/`）。
`appid` 目前是 `touristappid`（测试号）：要在微信里真正发布，得换成自己的小程序 appid 并走提审。
不装小程序也能用——H5 产物的窄屏形态就是手机版，在手机浏览器里打开可添加到主屏幕（`app/pwa/` 的 manifest 与 service worker）。

## 上线

**入口页（投递给招聘方就用这个）**：<https://demand-studio.pages.dev/>

| 入口 | Cloudflare Pages（主） | GitHub Pages（备份，同一份产物） |
| --- | --- | --- |
| 入口页 | <https://demand-studio.pages.dev/> | <https://xinhao021121-web.github.io/zhuangxiu-demand/> |
| 采集端（房主填需求单，手机可装机） | …`/app/` | …`/app/` |
| 解读端 · 桌面工作台（设计师出门前用） | …`/studio/` | …`/studio/` |
| 现场端 PWA（现场照着问） | …`/onsite/` | …`/onsite/` |

- 仓库：<https://github.com/xinhao021121-web/zhuangxiu-demand>

两条发布命令：`pnpm run deploy:pages`（GitHub Pages）与 `pnpm run deploy:cf-pages`（Cloudflare Pages）。

**API 服务跑不在静态托管上**：两个端在没有 API 时走演示模式，判据、脱敏、合并、排序仍是
`packages/*` 里那份真代码，只有存储与模型换成浏览器内的实现；接回真服务时把
`NEXT_PUBLIC_API_BASE` / `VITE_API_BASE` 指到自己的域名即可。API 本身用
`docker compose -f deploy/api.compose.yaml up -d` 起（见 `deploy/README.md`）。

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
| 解读端 · 桌面工作台 | `pnpm run test:studio` | 登录、导入列表、原始表格、外发前确认（含脱敏）、清单删减与撤销、字段定位、导出、宽窄屏布局 |
| 上线产物 | `pnpm run test:pages` | 按 gh-pages 的目录结构组装一次，用静态服务器按 /<repo>/ 前缀托管，逐个验证三个入口（含演示模式动线与 PWA manifest） |
| 现场端 PWA | `pnpm run test:onsite-app` | 现场选单、出门前概览、逐空间问、记一笔/没问上、断网记录与重连同步、量房记录、装机能力（manifest 与 service worker） |
| API 服务 | `pnpm run test:api`（也被 `test:unit` 覆盖） | 鉴权与角色、契约校验、清单流水线、外发审计、现场记录 |
| 领域包 | `pnpm run test:unit` | 字段规格、规则命中与排序去重、静默状态机、写回动作、摘要、草稿迁移、清单判据与合并、脱敏与外发、契约校验与降级 |
| 采集端 H5 产物 | `pnpm run test:app` | 填表、空间实例与房型、发现与三动作、静默、摘要、提交前检查、断点恢复、两端布局指标 |
| Web 上线 | `pnpm run test:preview` | 静态服务的 HTTP 行为、缓存头、深链接回退与首屏可用性 |
| 线上地址 | `pnpm run test:live` | 公网地址可访问、产物可加载、首屏可用、控制台无错误 |
| 早期 Demo | `pnpm run test:demo` | 交互设计稿的回归断言 |
| 解读端 Demo | `pnpm run test:designer` | 需求单列表、原始表格、外发前确认（含脱敏）、表格理解、清单删减与撤销、导出 |
| 现场端 Demo | `pnpm run test:onsite` | 现场选单、逐空间问、记一笔、离线记录与同步、量房记录、手机布局指标 |

小程序端没有稳定的自动验证手段（需要开发者工具），因此规则、排序、去重、静默、摘要、草稿迁移
全部放在零框架依赖的领域包里用 Vitest 覆盖，呈现层只做「读状态、渲染、派发事件」。
