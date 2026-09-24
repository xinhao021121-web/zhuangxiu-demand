/**
 * Cloudflare Workers 入口（技术方案 9.2 的部署形态）。
 *
 * 与 `server.ts` 跑的是**同一个 app**：只换两样东西——存储换成 D1 驱动，密钥从 Worker 的
 * 环境变量进。业务代码一行不改，这是 `repo.ts` 异步化之后才成立的事。
 *
 * 种子数据在第一次请求时灌一次（空库才有）：刚发出去的演示环境点开就有三份需求单。
 * 每台隔离实例只检查一次，不挂在每个请求上。
 */

import { createApp } from './app';
import { createD1Database } from './db/d1';
import { readEnv } from './env';
import { createFakeProvider } from './model/fake';
import { createDeepSeekProvider } from './model/deepseek';
import { createRepo } from './repo';
import { seedDatabase } from './seed';
import type { D1DatabaseLike } from './db/d1';
import type { Repo } from './repo';
import type { ModelProvider } from '@zx/service';

/** Workers 的绑定：D1 与那几个变量/密钥（见 `wrangler.toml`）。 */
export interface WorkerEnv {
  DB: D1DatabaseLike;
  [key: string]: unknown;
}

let seeded = false;

async function ensureSeed(repo: Repo): Promise<void> {
  if (seeded) return;
  // 建表是部署动作（`wrangler d1 execute --file=src/db/schema.sql`）：表还没有就让它抛出来，
  // 错误信息直接指向该做什么，比吞掉再回一个空列表好查。
  await seedDatabase(repo);
  seeded = true;
}

function createProvider(env: ReturnType<typeof readEnv>): ModelProvider {
  return env.model === 'deepseek'
    ? createDeepSeekProvider({
        apiKey: env.deepseekApiKey,
        baseUrl: env.deepseekBaseUrl,
        model: env.deepseekModel,
      })
    : createFakeProvider();
}

export default {
  async fetch(request: Request, bindings: WorkerEnv): Promise<Response> {
    const env = readEnv(bindings as unknown as NodeJS.ProcessEnv);
    const repo = createRepo(createD1Database(bindings.DB));
    await ensureSeed(repo);
    return createApp({ repo, provider: createProvider(env), env }).fetch(request, bindings);
  },
};
