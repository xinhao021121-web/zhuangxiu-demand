# 问需 · API 服务

一个服务、三个客户端：采集端小程序 / H5、桌面工作台（studio）、现场端（onsite）都调这一组接口。
业务判断全在 `packages/*`，这一层只做编排与持久化（技术方案 3.1 的分层纪律）。

## 起服务

```bash
pnpm install --dir services/api --ignore-workspace   # 依赖按包安装，不动仓库根目录
pnpm run api:dev                                     # http://127.0.0.1:8787
```

首次启动会灌入种子数据：3 份需求单（张先生 / 李女士 / 陈先生）与 2 个账号。
登录：手机号 `13800000002`（设计师）或 `13800000001`（管理员），验证码默认 `000000`。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8787` | 监听端口 |
| `DB_PATH` | `services/api/.data/api.sqlite` | 数据文件；`:memory:` 表示内存库（测试用） |
| `TOKEN_SECRET` | `dev-only-secret` | 自签 token 的密钥，生产必须换 |
| `TOKEN_TTL_SECONDS` | `43200` | token 有效期 |
| `COLLECTION_SECRET` | `dev-only-collection-secret` | 采集通道匿名会话的密钥，与 `TOKEN_SECRET` 是两把钥匙 |
| `COLLECTION_SESSION_TTL_SECONDS` | `86400` | 采集端会话的有效期 |
| `AUTH_CODE` | `000000` | 公司内部账号的验证码 |
| `CORS_ALLOWED_ORIGINS` | 本机三个端口（见下） | 跨域白名单，逗号分隔，不支持通配 |
| `COLLECTION_RATE_LIMIT` | `20` | 采集通道：每个来源在一个窗口里允许的请求数 |
| `COLLECTION_RATE_WINDOW_SECONDS` | `60` | 上面那个窗口的长度 |
| `TRUST_PROXY` | 关闭 | 服务挂在反向代理后面时置 `1`，限流改用 `X-Forwarded-For` 当客户端地址 |
| `MODEL_PROVIDER` | `fake` | `fake` 用桩数据；`deepseek` 走真实模型 |
| `DEEPSEEK_API_KEY` | 空 | 走 `deepseek` 时必填 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 私有化部署时改成内网地址 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 型号以 M2 实测后定 |
| `MODEL_ENDPOINT` | `official` | `official` 官方接口 / `private` 私有化部署 |

密钥只走环境变量，不进仓库、不进前端（技术方案 7.1）。

## 两条通道

房主不是用户，所以客户端分两条路进来（技术方案 5.3）：

| 前缀 | 谁用 | 鉴权 | 接口 |
| --- | --- | --- | --- |
| `/` | 桌面工作台与现场端（公司内部） | `POST /auth/login` 换 token，按角色控权限 | 需求单读写、清单生成与导出、现场记录、账号 |
| `/a` | 采集端（房主） | `POST /a/session` 换匿名会话令牌（另一把密钥 + `scope: 'collection'`） | 只有 `POST /a/session` 与 `POST /a/demand-sheets`，没有任何读接口 |

两条通道的令牌互不通用：会话令牌调内部接口是 401，内部 token 调采集通道也是 401。
采集端提交进来的需求单一律记 `source: 'miniapp'`、`submitted_by` 为空；弱网重试带同一个
`submissionId` 时只落一份，回执里 `replay: true`。

## 上线前置的两道门（CORS 与限流）

三个浏览端都是从静态托管发跨域请求，而采集通道是匿名的公开写入口，所以门口有两道门
（`src/guard.ts`，口径见技术方案 5.3）：

| 门 | 行为 | 怎么配 |
| --- | --- | --- |
| CORS 白名单 | 来源不在名单里直接 403（不是「只加头不拦」）；没有 `Origin` 的请求不算跨域，照常放行；预检在最外层答完 | `CORS_ALLOWED_ORIGINS=https://a.pages.dev,https://b.github.io` |
| 采集通道限流 | 超过额度回 429 并带 `Retry-After`；**只挂 `/a`**，内部读接口不吃这条额度 | `COLLECTION_RATE_LIMIT` / `COLLECTION_RATE_WINDOW_SECONDS` |

不配 `CORS_ALLOWED_ORIGINS` 时只放开本机开发的三个端口：H5 预览 `http://127.0.0.1:4173`、
桌面工作台 `http://127.0.0.1:3000`、现场端 `http://127.0.0.1:5174`（`localhost` 同样算）。
换了端口、或要接线上静态托管，都得显式配。

限流的键默认取**连接的远端地址**（客户端改不了）。挂在反向代理后面时远端地址永远是代理自己，
所有房主会共用一个额度——这时才开 `TRUST_PROXY=1` 让服务改用代理写进来的 `X-Forwarded-For`；
直连公网时不要开，那个头谁都能写。

限额是每台 API 服务进程各自记账（内存里的窗口），单实例部署足够；要多实例或按接口细化，
换成网关或 Redis 计数，路由与业务代码不动。

## 与部署形态的差异

技术方案选的持久化是境内托管 Postgres。这里用 Node 自带的 `node:sqlite` 落一份等价实现，
原因是开发与测试环境没有 Postgres；`src/db/schema.sql` 保持两边都能跑，换 Postgres 只需要
替换 `src/repo.ts` 这一层，路由与流水线不动。

## 部署：两条路线，一份 schema

| 路线 | 起法 | 存储 | 说明 |
| --- | --- | --- | --- |
| 容器（自备服务器 / 境内云主机） | `docker compose -f deploy/api.compose.yaml up -d` | 容器卷里的 SQLite（`/data/api.sqlite`） | 要 Postgres 时换 `src/db/` 下的驱动；密钥走环境变量 |
| Cloudflare Workers | 见下 | Cloudflare D1 | 演示环境；不用服务器，但**数据落在境外** |

换存储换的是 `src/db/driver.ts` 这个异步接口的实现：`repo.ts`、路由与流水线都不动。

### Workers + D1（当前演示环境的部署方式）

```bash
cd services/api
npx wrangler d1 create zx-api                     # 产出 database_id，填进 wrangler.toml
npx wrangler d1 execute zx-api --remote --file=src/db/schema.sql   # 建表：与容器/本机同一份 schema.sql
npx wrangler secret put TOKEN_SECRET              # 三个密钥都走 secret，不进仓库
npx wrangler secret put COLLECTION_SECRET
npx wrangler secret put AUTH_CODE                 # 内部账号登录用的验证码，别用默认的 000000
npx wrangler deploy
```

`wrangler.toml` 里的三个变量值得解释：

- `CORS_ALLOWED_ORIGINS`：只有这两个静态托管来源能跨域调它；
- `TRUST_PROXY=1`：Worker 的请求只能从 Cloudflare 边缘进来，客户端地址只能由边缘写的 `X-Forwarded-For` 给出——边缘运行时拿不到连接地址，不开这个，所有人会共用一个限流额度；
- `COLLECTION_RATE_LIMIT` / `COLLECTION_RATE_WINDOW_SECONDS`：采集通道的限额。

**上线后的一个实测结论**：`*.workers.dev` 在境内被 DNS 污染（解析到 Facebook 的 IP），从国内网络访问不到。要在国内稳定用，得绑一个自有域名（`wrangler.toml` 里加 `routes`），或改走容器那条路线。演示环境只放合成种子数据（首次请求时自动灌入），不放真实房主信息。

## 一次生成做了什么

```
POST /demand-sheets/:id/checklist
  1. 按外发策略取数：不外发的整条留下，可泛化的先降级，自由文本先替换
  2. 写外发记录：字段清单 + 脱敏命中位置 + 策略版本 + 时间 + 操作人
  3. 调模型（DeepSeek 或桩），返回必须过 zod 两道红线
  4. 结构不合法或出现字段清单之外的 fieldId → 重试一次 → 仍失败则降级为纯规则清单
  5. 判据筛选、合并、排序、落库
```

降级时清单照样出得来，只是少了推导项，接口里的 `degraded` 会标出来，界面要写明「模型部分未生成」。

## 接口文档

`GET /openapi.json` 由 `packages/contracts` 的 zod schema 直接生成（OpenAPI 3.1），
不存在「文档和实现两份」的问题。
