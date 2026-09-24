# app · 问需 · 采集

Taro + React + TypeScript，一套代码产出微信小程序与 H5。H5 产物在宽屏下就是 Web 端，
在窄屏下就是展示版。

## 目录

```
config/          Taro 三端构建配置（别名、px 直出、H5 hash 路由）
src/
  app.ts      启动时读取本地草稿（断点恢复）
  store.ts    Zustand 状态：实时表单 + 助手快照（防抖 800ms）+ 二次确认
  platform/   存储适配（Taro.setStorage）、端形态判断、滚动定位
  components/ 字段控件、分区卡片、助手面板、分区导航、弹层
  pages/index 页面：组合壳组件与业务组件
```

## 说明

- **领域包按源码引用**：`config/index.ts` 用 `alias` 把 `@zx/*` 指向 `packages/*/src`，
  并把 `packages/` 加进 `h5.compile.include` 与 `mini.compile.include` 一起过 babel。
  因此 app 不需要把领域包装进 `node_modules`，单测与两端构建引用的是同一份代码。
- **端形态分支只出现在壳组件**：宽屏是「右栏助手 + 竖直进度点 + 多列网格」，窄屏是
  「底部横条 + 半屏弹层 + 顶部分区胶囊 + 手风琴」。字段控件本身不判断平台。
- **px 直出**：两端都关闭了 Taro 的 rem 适配（`pxtransform.enable = false`），
  宽窄两套布局用媒体查询（断点 1024px）。
- **按需渲染**：只有展开的大类才渲染字段节点，窄屏一次只展开一个大类。

## 命令

```bash
pnpm install --dir app --ignore-workspace   # 只在 app 目录安装依赖
pnpm run build:h5                           # → app/dist/h5，用静态服务器打开 index.html
pnpm run build:weapp                        # → app/dist/weapp，用微信开发者工具打开 app/
pnpm run dev:h5                             # 本地开发
```

## 已实现

| 编号 | 功能 | 落点 |
| --- | --- | --- |
| F1 | 实时发现引擎（纯规则） | `packages/rules` |
| F2 | 发现卡片与三动作闭环 | `components/Assistant.tsx` + `store.ts` |
| F3 | 需求清晰度与发现计数 | `packages/field-spec` + 顶部进度条 |
| F4 | 断点恢复（本地草稿 + 迁移） | `packages/data` + `store.bootstrap` |
| F5 | 需求摘要生成（150 字核心摘要 + 按空间展开） | `packages/summary` |
| F6 | 静默模式（连续 3 次不感兴趣，不跨会话继承） | `packages/rules` 的 `state.ts` |
| F7 | 空间实例管理（次卧 ≤4、卫生间 ≤3、书房 ≤2，房型决定字段） | `packages/field-spec` 的 `model.ts` |
| F8 | 量房确认清单（16 项，随摘要一起给设计师） | `packages/summary` |
| F9 | 结构化提交：草稿拼成需求单（含助手写入过的字段与一整批埋点）交给采集通道；没配通道就只留本机 | `packages/data` 的 `buildSubmission` / `createCollectionClient` + `store.ts` + `services/api` 的 `/a` |

## 采集通道

提交走的是服务端那条只写的采集通道（技术方案 5.3），地址由构建时的 `COLLECTION_API_BASE` 注入——
**留空就是展示模式**：照常走完全流程，提交只落在本机，提示里会说明，不假装送达。

```bash
COLLECTION_API_BASE=https://api.example.com/a pnpm run build:h5
```

网络那一层用 `Taro.request`（小程序端没有 `fetch`），所以小程序与 H5 共用同一份提交代码。
埋点随这一次提交整批上报，送达后从草稿里清掉；没送达就留着，下次提交一起带。
