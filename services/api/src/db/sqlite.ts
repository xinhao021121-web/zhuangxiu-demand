/** SQLite 连接：本地开发与测试用 Node 自带的 node:sqlite，部署时换 Postgres 适配器。 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export type Db = DatabaseSync;
