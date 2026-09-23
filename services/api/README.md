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
| `AUTH_CODE` | `000000` | 公司内部账号的验证码 |
| `MODEL_PROVIDER` | `fake` | `fake` 用桩数据；`deepseek` 走真实模型 |
| `DEEPSEEK_API_KEY` | 空 | 走 `deepseek` 时必填 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 私有化部署时改成内网地址 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 型号以 M2 实测后定 |
| `MODEL_ENDPOINT` | `official` | `official` 官方接口 / `private` 私有化部署 |

密钥只走环境变量，不进仓库、不进前端（技术方案 7.1）。

## 与部署形态的差异

技术方案选的持久化是境内托管 Postgres。这里用 Node 自带的 `node:sqlite` 落一份等价实现，
原因是开发与测试环境没有 Postgres；`src/db/schema.sql` 保持两边都能跑，换 Postgres 只需要
替换 `src/repo.ts` 这一层，路由与流水线不动。

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
