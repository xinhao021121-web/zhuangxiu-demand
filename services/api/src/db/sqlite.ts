/**
 * SQLite 驱动：本地开发、测试与容器部署（`deploy/api.compose.yaml`）走这一条。
 *
 * 基础设施是 Node 自带的 `node:sqlite`（同步 API），外面包一层 `Db` 的异步壳，
 * 与 Cloudflare D1 的驱动对齐——仓储层因此只有一份（`repo.ts`）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { bindParams } from './driver';
import type { Db } from './driver';

const SCHEMA = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

export function openDatabase(dbPath: string): Db {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return {
    async all<T>(sql: string, ...params: unknown[]) {
      return db.prepare(sql).all(...(bindParams(params) as never[])) as T[];
    },
    async get<T>(sql: string, ...params: unknown[]) {
      return db.prepare(sql).get(...(bindParams(params) as never[])) as T | undefined;
    },
    async run(sql: string, ...params: unknown[]) {
      db.prepare(sql).run(...(bindParams(params) as never[]));
    },
  };
}
