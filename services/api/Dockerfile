# 设计需求解读台 · API 服务
#
# 构建上下文是仓库根目录（要带上 packages/* 与 services/api）：
#   docker build -f services/api/Dockerfile -t zx-api .
#   docker run -p 8787:8787 -v zx-data:/data \
#     -e TOKEN_SECRET=... -e MODEL_PROVIDER=fake zx-api
#
# 形态：Node 24 + Hono。默认落在自己容器里的 SQLite（/data/api.sqlite）；
# 技术方案选的持久化是境内托管 Postgres，换的是 services/api/src/repo.ts 这一层，路由与流水线不动。
# 模型：MODEL_PROVIDER=deepseek 时走官方接口或私有化部署，密钥只从环境变量进。
FROM node:24-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

# 依赖按包安装：仓库根目录的 node_modules 是运行环境提供的，不进镜像
COPY package.json pnpm-workspace.yaml ./
COPY packages ./packages
COPY services ./services
RUN pnpm install --dir services/api --ignore-workspace

WORKDIR /app/services/api
ENV NODE_ENV=production
ENV PORT=8787
ENV DB_PATH=/data/api.sqlite
VOLUME ["/data"]
EXPOSE 8787

# 服务端是 TS：用 tsx 跑（同时负责 tsconfig 里的 @zx/* 路径解析）
CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/server.ts"]
