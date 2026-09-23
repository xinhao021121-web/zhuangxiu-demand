# 问需 · 解读（桌面工作台）

公司内部工具，出门前在电脑上把量房沟通清单做出来：**导入 → 确认外发 → 看理解 → 筛清单 → 导出**（F1–F6）。

## 起服务

```bash
pnpm install --dir studio --ignore-workspace   # 依赖按包安装，不动仓库根目录
pnpm run studio:dev                            # http://127.0.0.1:3000（另起一个终端跑 pnpm run api:dev）
```

登录用种子账号：手机号 `13800000002`，验证码 `000000`。

## 与 API 的分工

浏览器不算业务结论，也不碰模型密钥：清单判据、合并、排序、脱敏全在 `packages/*`，服务端在 `services/api`。
`/api/*` 由 Next 的 rewrite 代理到 API 服务（默认 `http://127.0.0.1:8787`，用 `API_BASE` 改）。

前端用到的领域包只有两处，都是纯函数：导出 Markdown（`@zx/checklist`）与字段标签（`@zx/field-spec`）。

## 关于依赖选择

技术方案里的状态层是 Zustand + TanStack Query。这一版直接用 React 自带的 state 与 fetch：
工作台只有十几个接口、没有跨页共享状态，引入缓存层只会多一层要维护的东西。
真要做服务端渲染的分享页时再补，不影响现在的结构。

## 测试

```bash
pnpm run test:studio    # 起 API + next start，跑完整动线（宽屏与窄屏都有布局指标断言）
```
