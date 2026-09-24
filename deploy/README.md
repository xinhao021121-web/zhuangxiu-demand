# 上线

两个线上地址（同一份产物，互为备份）：

| 托管 | 地址 | 发布命令 |
| --- | --- | --- |
| Cloudflare Pages | <https://demand-studio.pages.dev/> | `pnpm run deploy:cf-pages` |
| GitHub Pages | <https://xinhao021121-web.github.io/zhuangxiu-demand/> | `pnpm run deploy:pages` |

两家的路径前缀不同（Pages 挂在根、GitHub Pages 的仓库页挂在 `/<repo>/` 下），所以前缀是构建参数：
`--target pages` 用空前缀，GitHub Pages 用 `/zhuangxiu-demand`。采集端 H5 用的是相对路径，两边都不用改。

仓库：<https://github.com/xinhao021121-web/zhuangxiu-demand>

Web 端与展示版是同一份 H5 产物（`app/dist/h5`）：宽屏是 Web 端，窄屏是展示版。
产物是纯静态站点，形态上只有一个要求——**必须挂在某个目录下用 HTTP 访问**，
不要用 `file://` 直接打开（相对路径与模块加载在部分浏览器下会受限）。

## 零、线上有哪三个入口

| 地址 | 是什么 | 产物 |
| --- | --- | --- |
| `/` | 入口页（作品集首页，投递用这个） | `landing/` |
| `/app/` | 采集端 H5（房主填需求单） | `app/dist/h5` |
| `/studio/` | 桌面工作台（设计师出门前用） | `studio/.next-export` |
| `/onsite/` | 现场端 PWA（现场照着问） | `onsite/dist` |

三个入口由 `node tools/deploy-github-pages.mjs` 一次组装发布（会自己构建）；加 `--dry-run`
可以只组装不推送，看看产物对不对。

**API 服务跑不在静态托管上。** 两个端在没有 API 时走演示模式：判据、脱敏、合并、排序仍是
`packages/*` 里那份真代码，只有存储与模型换成浏览器内的实现，所以线上地址点得开、演示得完整。
接回真服务时，用 `NEXT_PUBLIC_API_BASE`（桌面端）与 `VITE_API_BASE`（现场端）指向自己的域名，
并把这几个地址加进服务的 CORS 白名单（`CORS_ALLOWED_ORIGINS`，逗号分隔；采集端那份用
`COLLECTION_API_BASE` 指到 `/a`）。白名单外一律 403，采集通道另有按来源的限额（默认 20 次 / 60 秒），
两项的取值办法见 `services/api/README.md`。

## 〇之一、API 服务怎么起

```bash
docker compose -f deploy/api.compose.yaml up -d     # 需要一台能跑 Docker 的机器
```

另有一条不需要服务器的路线：**Cloudflare Workers + D1**（当前演示环境就用这条，
地址 `https://api.xinhao02.ccwu.cc`，绑的是自有域名）。建库、建表、配密钥与发布的命令在
`services/api/README.md`。注意两点：数据落在 Cloudflare（境外），只适合放合成数据；
默认的 `*.workers.dev` 地址在境内被 DNS 污染，所以要绑自有域名（`wrangler.toml` 的 `routes`）。

默认用容器内的 SQLite（`/data/api.sqlite`，挂在卷上）；技术方案选的持久化是境内托管 Postgres，
换的是 `services/api/src/repo.ts` 这一层，路由与流水线不动。模型默认 `MODEL_PROVIDER=fake`，
接真实模型时设 `MODEL_PROVIDER=deepseek` 与 `DEEPSEEK_API_KEY`（密钥只从环境变量进，不进仓库）。

现场端走公网访问时按技术方案 7.2：需要域名与 ICP 备案；只在公司内网用则换成导出纸质清单。

## 一、本机 / 局域网先跑起来

```bash
pnpm run build:h5          # 产物：app/dist/h5
pnpm run preview:h5        # http://127.0.0.1:4173
pnpm run preview:h5:lan    # --host 0.0.0.0，同网段的手机可以直接打开
```

`tools/serve-h5.mjs` 与线上静态托管的缓存策略一致：`index.html` 不缓存、带哈希的
产物 `immutable`、文本资源 gzip，并对 `../` 越界请求返回 400。

## 二、正式上线（任选一种）

| 方式 | 步骤 | 产出 |
| --- | --- | --- |
| GitHub Pages | `node tools/deploy-github-pages.mjs`（默认用 origin 仓库） | `https://xinhao021121-web.github.io/zhuangxiu-demand/` |
| Vercel | 把 `deploy/vercel.json` 复制到仓库根目录，导入仓库即可 | `https://<project>.vercel.app` |
| Netlify | 把 `deploy/netlify.toml` 复制到仓库根目录，导入仓库即可 | `https://<project>.netlify.app` |
| 云主机 / 对象存储 | 把 `app/dist/h5` 里的文件上传到站点目录，参考 `deploy/nginx.conf` | 自有域名 |

GitHub Pages 方式不需要 Actions：脚本把产物作为孤立提交推到 `gh-pages` 分支，
在仓库 Settings → Pages 选择该分支根目录即可。若想用 Actions 自动发布，
把 `deploy/github-pages.yml` 复制到 `.github/workflows/` 下。

## 三、发版流程

```bash
pnpm run test               # 先过全部测试（含上线产物那套）
pnpm run build:h5                          # 再构建
 node tools/deploy-github-pages.mjs         # 发布（会自动重新构建）
 node tests/live.smoke.mjs   # 发布后验证线上地址
```

同一份产物不需要为 Web 与展示版分别构建；域名、HTTPS、CDN 由托管平台或你自己的
服务器负责，产物内部只用相对路径与 hash 路由，挂在任意子目录都能正常工作。
