/**
 * Cloudflare D1 驱动：部署形态（`services/api/wrangler.toml` 的 Workers 路线）。
 *
 * 只认 D1 的最小结构（`prepare` / `bind` / `all` / `first` / `run` / `exec`），不引
 * `@cloudflare/workers-types`——这样单测可以拿一个内存实现顶上，不必把整条链子塞进边缘运行时里跑。
 *
 * 表结构不在这里建：D1 的迁移是部署动作，见 `wrangler.toml` 与 README 里的
 * `wrangler d1 execute --file=src/db/schema.sql`。同一份 `schema.sql` 三种存储共用。
 */

import { bindParams } from './driver';
import type { Db } from './driver';

export interface D1PreparedStatementLike {
  bind(...params: unknown[]): D1PreparedStatementLike;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  exec(sql: string): Promise<unknown>;
}

export function createD1Database(db: D1DatabaseLike): Db {
  return {
    async all<T>(sql: string, ...params: unknown[]) {
      const { results } = await db.prepare(sql).bind(...bindParams(params)).all<T>();
      return results;
    },
    async get<T>(sql: string, ...params: unknown[]) {
      const row = await db
        .prepare(sql)
        .bind(...bindParams(params))
        .first<T>();
      return row ?? undefined;
    },
    async run(sql: string, ...params: unknown[]) {
      await db.prepare(sql).bind(...bindParams(params)).run();
    },
  };
}
