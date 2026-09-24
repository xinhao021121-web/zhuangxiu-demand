/**
 * Cloudflare Workers 部署形态（技术方案 9.2）。
 *
 * 这里不连真 Cloudflare：用一个「D1 形状 + node:sqlite 内核」的假 D1，把 Worker 入口
 * 原样跑一遍。跑的是同一份 `worker.ts` / `repo.ts` / `app.ts`，所以能证明的是——
 * 边缘那条链路上的接线（绑定、环境变量、异步驱动、种子）是对的，
 * 而不是「本地 SQLite 又跑通了一次」。
 *
 * 边界也要说清：这不等于验过 D1 本身（并发、跨区复制、SQL 方言差异都不在里面）。
 * 那些只能等真机上跑，见 README 的部署步骤。
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import worker from '../../services/api/src/worker';
import { createD1Database } from '../../services/api/src/db/d1';
import type { D1DatabaseLike, D1PreparedStatementLike } from '../../services/api/src/db/d1';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'services', 'api', 'src', 'db', 'schema.sql'), 'utf8');

/** D1 的预处理语句形状，底下是 node:sqlite。 */
class FakeStatement implements D1PreparedStatementLike {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): D1PreparedStatementLike {
    return new FakeStatement(this.db, this.sql, params);
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.db.prepare(this.sql).all(...(this.params as never[])) as T[] };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.db.prepare(this.sql).get(...(this.params as never[])) ?? null) as T | null;
  }

  async run(): Promise<unknown> {
    this.db.prepare(this.sql).run(...(this.params as never[]));
    return { success: true };
  }
}

class FakeD1 implements D1DatabaseLike {
  constructor(private readonly db: DatabaseSync) {}

  prepare(sql: string): D1PreparedStatementLike {
    return new FakeStatement(this.db, sql);
  }

  async exec(sql: string): Promise<unknown> {
    this.db.exec(sql);
    return { success: true };
  }
}

const database = new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys = ON;');
database.exec(SCHEMA);
const d1 = new FakeD1(database);

const BINDINGS = {
  DB: d1,
  MODEL_PROVIDER: 'fake',
  AUTH_CODE: '135790',
  TOKEN_SECRET: 'test-token-secret',
  COLLECTION_SECRET: 'test-collection-secret',
  CORS_ALLOWED_ORIGINS: 'https://demo.example',
  TRUST_PROXY: '1',
  COLLECTION_RATE_LIMIT: '50',
};

const fetchWorker = (path: string, init: RequestInit = {}) =>
  worker.fetch(new Request(new URL(path, 'https://zx-api.example'), init), BINDINGS);

const jsonPost = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const login = async (): Promise<string> => {
  const res = await fetchWorker('/auth/login', jsonPost({ phone: '13800000002', code: '135790' }));
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
};

describe('D1 驱动', () => {
  it('驱动把「不传」归一成 null：D1 与 node:sqlite 都不接受 undefined', async () => {
    const db = createD1Database(d1);
    await db.run(
      'INSERT INTO users (id, name, phone, role, team_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      'u-driver',
      '驱动测试',
      '13900000009',
      'designer',
      undefined,
      '2026-09-25T00:00:00.000Z',
    );
    const row = await db.get<{ team_id: string | null }>('SELECT team_id FROM users WHERE id = ?', 'u-driver');
    expect(row?.team_id).toBeNull();
    // 查不到就是 undefined，而不是 D1 的 null：仓储层只认这一种「没有」
    expect(await db.get('SELECT team_id FROM users WHERE id = ?', 'u-nobody')).toBeUndefined();
  });
});

describe('Worker 入口', () => {
  it('健康检查与契约不需要登录，且跑的就是同一个 app', async () => {
    const health = await fetchWorker('/health');
    expect(health.status).toBe(200);
    expect((await health.json()) as { ok: boolean; model: string }).toMatchObject({ ok: true, model: 'fake' });
    expect((await fetchWorker('/openapi.json')).status).toBe(200);
  });

  it('第一次请求把种子数据灌进 D1：登录后看得到三份需求单', async () => {
    const token = await login();
    const res = await fetchWorker('/demand-sheets', { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as unknown[]).length).toBe(3);
  });

  it('采集通道在边缘照样能提交，落进 D1 后内部通道读得到', async () => {
    const session = await fetchWorker('/a/session', {
      method: 'POST',
      headers: { origin: 'https://demo.example' },
    });
    expect(session.status).toBe(200);
    expect(session.headers.get('access-control-allow-origin')).toBe('https://demo.example');
    const { token } = (await session.json()) as { token: string };

    const submitted = await fetchWorker('/a/demand-sheets', {
      ...jsonPost(
        {
          submissionId: 'w-d1-1',
          schemaVersion: '1.0',
          submittedAt: '2026-09-25T08:00:00.000Z',
          source: 'miniapp',
          form: { values: { base_area: 96, live_pet: ['猫'] }, instances: {} },
          aiMarks: ['pet_litter_box'],
        },
        { authorization: `Bearer ${token}`, origin: 'https://demo.example' },
      ),
    });
    expect(submitted.status).toBe(201);

    const tokenInternal = await login();
    const detail = await fetchWorker('/demand-sheets/w-d1-1', {
      headers: { authorization: `Bearer ${tokenInternal}` },
    });
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { form: { values: Record<string, unknown> } }).form.values.base_area).toBe(96);
  });

  it('在 D1 上跑得通整条流水线：写外发记录、落清单与条目、出报表', async () => {
    const token = await login();
    const auth = { authorization: `Bearer ${token}` };
    const generated = await fetchWorker('/demand-sheets/d1/checklist', { ...jsonPost({}, auth) });
    expect(generated.status).toBe(201);
    const checklist = (await generated.json()) as { id: string; counts: { total: number; must: number } };
    expect(checklist.counts.total).toBeGreaterThan(0);

    // 外发审计与清单条目都是多次写入，D1 只有异步 API，这条断言守的是整条写路径
    expect((await fetchWorker(`/demand-sheets/d1/outbound-records`, { headers: auth })).status).toBe(200);
    expect((await fetchWorker(`/checklists/${checklist.id}/summary`, { headers: auth })).status).toBe(200);
    const reports = await fetchWorker('/reports', { headers: auth });
    expect(reports.status).toBe(200);
    expect(((await reports.json()) as { criteria: unknown[] }).criteria.length).toBeGreaterThan(0);
  });

  it('白名单外的来源在 Worker 上同样被挡，限额也只落在采集通道', async () => {
    expect(
      (await fetchWorker('/a/session', { method: 'POST', headers: { origin: 'https://evil.example' } })).status,
    ).toBe(403);
    const token = await login();
    for (let i = 0; i < 3; i += 1) {
      expect((await fetchWorker('/demand-sheets', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    }
  });
});
