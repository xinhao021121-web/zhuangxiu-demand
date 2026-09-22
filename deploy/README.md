# Web 端上线

Web 端与展示版是同一份 H5 产物（`app/dist/h5`）：宽屏是 Web 端，窄屏是展示版。
产物是纯静态站点，形态上只有一个要求——**必须挂在某个目录下用 HTTP 访问**，
不要用 `file://` 直接打开（相对路径与模块加载在部分浏览器下会受限）。

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
| GitHub Pages | `node tools/deploy-github-pages.mjs`（默认用 origin 仓库） | `https://<owner>.github.io/<repo>/` |
| Vercel | 把 `deploy/vercel.json` 复制到仓库根目录，导入仓库即可 | `https://<project>.vercel.app` |
| Netlify | 把 `deploy/netlify.toml` 复制到仓库根目录，导入仓库即可 | `https://<project>.netlify.app` |
| 云主机 / 对象存储 | 把 `app/dist/h5` 里的文件上传到站点目录，参考 `deploy/nginx.conf` | 自有域名 |

GitHub Pages 方式不需要 Actions：脚本把产物作为孤立提交推到 `gh-pages` 分支，
在仓库 Settings → Pages 选择该分支根目录即可。若想用 Actions 自动发布，
把 `deploy/github-pages.yml` 复制到 `.github/workflows/` 下。

## 三、发版流程

```bash
pnpm run test:unit && pnpm run test:app    # 先过测试
pnpm run build:h5                          # 再构建
node tools/deploy-github-pages.mjs         # 发布（会自动重新构建）
```

同一份产物不需要为 Web 与展示版分别构建；域名、HTTPS、CDN 由托管平台或你自己的
服务器负责，产物内部只用相对路径与 hash 路由，挂在任意子目录都能正常工作。
