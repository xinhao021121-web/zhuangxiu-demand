/** 服务入口：读环境变量、开库、灌种子、起 HTTP。 */

import { serve } from '@hono/node-server';
import { createApp } from './app';
import { openDatabase } from './db/sqlite';
import { createRepo } from './repo';
import { seedDatabase } from './seed';
import { createFakeProvider } from './model/fake';
import { createDeepSeekProvider } from './model/deepseek';
import { readEnv } from './env';
import type { ModelProvider } from '@zx/service';

const env = readEnv();
const db = openDatabase(env.dbPath);
const repo = createRepo(db);

if (seedDatabase(repo)) console.log('已灌入种子数据（3 份需求单、2 个账号）');

const provider: ModelProvider =
  env.model === 'deepseek'
    ? createDeepSeekProvider({
        apiKey: env.deepseekApiKey,
        baseUrl: env.deepseekBaseUrl,
        model: env.deepseekModel,
      })
    : createFakeProvider();

const app = createApp({ repo, provider, env });

serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`设计需求解读台 API：http://127.0.0.1:${info.port}`);
  console.log(`模型：${provider.name} · 数据库：${env.dbPath}`);
  console.log(`登录用手机号 13800000002，验证码 ${env.authCode}`);
});
