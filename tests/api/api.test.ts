/**
 * API 层：鉴权与角色、契约校验、清单流水线、外发审计、现场记录。
 *
 * 用 Node 自带的 SQLite 跑真实库（部署形态是 Postgres，换的是适配器不是这一层）。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createApp,
  createFakeProvider,
  createRepo,
  openDatabase,
  readEnv,
  seedDatabase,
} from '../../services/api/src/index';
import type { ModelProvider } from '@zx/service';
import seedSheets from '../../services/api/seed/demand-sheets.json';

const DESIGNER = '13800000002';
const ADMIN = '13800000001';

let app: ReturnType<typeof createApp>;
let token: string;
let adminToken: string;

const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const jsonHeaders = (t: string) => ({ ...auth(t), 'content-type': 'application/json' });

async function login(phone: string, instance = app): Promise<string> {
  const res = await instance.request('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ phone, code: '000000' }),
  });
  const body = (await res.json()) as { token: string };
  return body.token;
}

function boot(provider: ModelProvider = createFakeProvider()) {
  const repo = createRepo(openDatabase(':memory:'));
  seedDatabase(repo);
  const env = readEnv({
    AUTH_CODE: '000000',
    TOKEN_SECRET: 'test-secret',
    DB_PATH: ':memory:',
  } as NodeJS.ProcessEnv);
  return createApp({ repo, provider, env, now: () => '2026-09-23 10:05' });
}

interface GeneratedChecklist {
  id: string;
  counts: { total: number; must: number; suggest: number };
  groups: { space: string; items: unknown[] }[];
  items: { object: string; tier: string; source: string }[];
  degraded: boolean;
  model: string;
  removedKeys: string[];
  removed?: boolean;
}

async function generate(sheetId: string, t = token, body: unknown = {}) {
  const res = await app.request(`/demand-sheets/${sheetId}/checklist`, {
    method: 'POST',
    headers: jsonHeaders(t),
    body: JSON.stringify(body),
  });
  return { res, body: (await res.json()) as GeneratedChecklist };
}

beforeEach(async () => {
  app = boot();
  token = await login(DESIGNER);
  adminToken = await login(ADMIN);
});

describe('鉴权与角色', () => {
  it('未授权访问不返回任何数据', async () => {
    const res = await app.request('/demand-sheets');
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe('未授权');
    expect(JSON.stringify(body)).not.toContain('张先生');
  });

  it('手机号加验证码换 token，验证码不对不给', async () => {
    const bad = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: DESIGNER, code: '123456' }),
    });
    expect(bad.status).toBe(401);
    expect(token.split('.')).toHaveLength(2);
  });

  it('账号管理只对管理员开放', async () => {
    const denied = await app.request('/users', { headers: auth(token) });
    expect(denied.status).toBe(403);
    const allowed = await app.request('/users', { headers: auth(adminToken) });
    expect(allowed.status).toBe(200);
    const users = (await allowed.json()) as { role: string }[];
    expect(users.map((u) => u.role).sort()).toEqual(['admin', 'designer']);
  });

  it('健康检查与契约文档不需要登录', async () => {
    expect((await app.request('/health')).status).toBe(200);
    const doc = (await app.request('/openapi.json')).json() as Promise<{
      components: { schemas: Record<string, unknown> };
      paths: Record<string, unknown>;
    }>;
    const openapi = await doc;
    expect(openapi.components.schemas).toHaveProperty('Checklist');
    expect(openapi.components.schemas).toHaveProperty('DemandSheetImport');
    expect(Object.keys(openapi.paths)).toContain('/demand-sheets/{id}/checklist');
  });
});

describe('需求单导入与列表', () => {
  it('列出的每份需求单都带摘要、提交时间与完成度', async () => {
    const res = await app.request('/demand-sheets', { headers: auth(token) });
    const list = (await res.json()) as { demandName: string; progress: { percent: number }; hasChecklist: boolean }[];
    expect(list).toHaveLength(3);
    expect(list.map((s) => s.demandName).sort()).toEqual(['张先生', '李女士', '陈先生'].sort());
    const zhang = list.find((s) => s.demandName === '张先生')!;
    expect(zhang.progress.percent).toBeGreaterThan(0);
    expect(zhang.hasChecklist).toBe(false);
  });

  it('导入一份采集端导出的 JSON，落库后立刻可见', async () => {
    const sheet = (seedSheets as unknown as Record<string, unknown>[])[2];
    const res = await app.request('/demand-sheets', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ ...sheet, id: undefined, demandName: '新客户' }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; demandName: string };
    expect(created.demandName).toBe('新客户');
    const list = (await app.request('/demand-sheets', { headers: auth(token) })).json() as Promise<unknown[]>;
    expect(await list).toHaveLength(4);
  });

  it('格式不对的需求单被挡在契约层', async () => {
    const res = await app.request('/demand-sheets', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ submittedAt: '2026-09-23' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('生成清单是一条完整流水线', () => {
  it('种子场景生成出的清单与产品文档的数字一致', async () => {
    const { res, body } = await generate('d1');
    expect(res.status).toBe(201);
    expect(body.counts).toMatchObject({ total: 19, must: 10, suggest: 9 });
    expect(body.groups[0].space).toBe('基本信息');
    expect(body.degraded).toBe(false);
  });

  it('生成前先写下外发记录：字段清单、策略版本、时间、操作人都留档', async () => {
    await generate('d1');
    const res = await app.request('/demand-sheets/d1/outbound-records', { headers: auth(token) });
    const records = (await res.json()) as {
      policyVersion: string;
      operator: string;
      at: string;
      fieldKeys: string[];
      unselectedFreeText: number;
    }[];
    expect(records).toHaveLength(1);
    expect(records[0].policyVersion).toBe('v1');
    expect(records[0].operator).toBe('王设计');
    expect(records[0].at).toBe('2026-09-23 10:05');
    expect(records[0].fieldKeys.length).toBeGreaterThan(10);
  });

  it('误发即失败：不外发字段与没勾选的自由文本都不进请求', async () => {
    await generate('d1');
    const records = (await (
      await app.request('/demand-sheets/d1/outbound-records', { headers: auth(token) })
    ).json()) as { fieldKeys: string[]; unselectedFreeText: number }[];
    expect(records[0].fieldKeys).not.toContain('base_community');
    expect(records[0].fieldKeys).not.toContain('base_other');
    expect(records[0].unselectedFreeText).toBeGreaterThan(0);
  });

  it('勾选自由文本后，外发的是脱敏后的内容，命中位置也留档', async () => {
    await generate('d1', token, { selected: { base_other: true } });
    const records = (await (
      await app.request('/demand-sheets/d1/outbound-records', { headers: auth(token) })
    ).json()) as { fieldKeys: string[]; redactions: { fieldKey: string; kinds: string[] }[] }[];
    expect(records[0].fieldKeys).toContain('base_other');
    expect(records[0].redactions.find((r) => r.fieldKey === 'base_other')!.kinds).toEqual(['phone', 'address']);
    // 留档里只有字段键与命中类型，没有原文
    expect(JSON.stringify(records[0])).not.toContain('13812345678');
    expect(JSON.stringify(records[0])).not.toContain('珞喻路');
  });

  it('待解读的需求单取清单返回 404', async () => {
    const res = await app.request('/demand-sheets/d2/checklist', { headers: auth(token) });
    expect(res.status).toBe(404);
  });

  it('生成后详情里带上表格理解与已生成的清单', async () => {
    await generate('d1');
    const detail = (await (
      await app.request('/demand-sheets/d1', { headers: auth(token) })
    ).json()) as {
      form: { values: Record<string, unknown> };
      progress: { percent: number };
      understanding: { profile: unknown[]; risks: unknown[]; toConfirm: unknown[]; derivedItems: unknown[] };
      outboundPreview: { tier: string; rows: unknown[] }[];
      checklist: { counts: { total: number }; removedKeys: string[] };
    };
    expect(detail.form.values.base_area).toBe(89);
    expect(detail.progress.percent).toBeGreaterThan(0);
    expect(detail.understanding.profile.length).toBe(4);
    expect(detail.understanding.toConfirm.length).toBe(4);
    expect(detail.understanding.risks.length).toBeGreaterThan(0);
    expect(detail.understanding.derivedItems.length).toBe(10);
    expect(detail.outboundPreview.map((g) => g.tier)).toEqual([
      'no-send',
      'generalize',
      'free-text',
      'raw',
    ]);
    expect(detail.checklist.counts.total).toBe(19);
  });
});

describe('模型返回的两道红线', () => {
  it('出现字段清单之外的字段 ID：降级为纯规则清单并标明', async () => {
    const bad: ModelProvider = {
      name: 'bad',
      async understand() {
        return {
          profile: [],
          demands: [],
          conflicts: [],
          derivedItems: [
            {
              object: '凭空来的',
              question: '要不要做全屋智能',
              why: '模型自己想的',
              onsiteChecks: [],
              relatedFieldIds: ['某个不存在的字段'],
              impact: ['feasibility'],
            },
          ],
        };
      },
    };
    const instance = boot(bad);
    const t = await login(DESIGNER, instance);
    const res = await instance.request('/demand-sheets/d1/checklist', {
      method: 'POST',
      headers: jsonHeaders(t),
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as { degraded: boolean; counts: { total: number }; items: { object: string }[] };
    expect(body.degraded).toBe(true);
    expect(body.counts.total).toBe(17);
    expect(body.items.map((i) => i.object)).not.toContain('凭空来的');
  });

  it('结构不合法：同样降级，不落半成品清单', async () => {
    const broken: ModelProvider = { name: 'broken', async understand() { return { nope: true }; } };
    const instance = boot(broken);
    const t = await login(DESIGNER, instance);
    const res = await instance.request('/demand-sheets/d1/checklist', {
      method: 'POST',
      headers: jsonHeaders(t),
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as { degraded: boolean; model: string; counts: { total: number } };
    expect(body.degraded).toBe(true);
    expect(body.model).toContain('降级');
    expect(body.counts.total).toBe(17);
  });

  it('模型调用抛错：清单照样出得来，只少掉推导项', async () => {
    const failing: ModelProvider = { name: 'failing', async understand() { throw new Error('限流'); } };
    const instance = boot(failing);
    const t = await login(DESIGNER, instance);
    const res = await instance.request('/demand-sheets/d1/checklist', {
      method: 'POST',
      headers: jsonHeaders(t),
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as { degraded: boolean; counts: { must: number } };
    expect(body.degraded).toBe(true);
    expect(body.counts.must).toBe(9);
  });
});

describe('清单的删减与撤销', () => {
  it('删减动作被记录，撤销后恢复', async () => {
    const { body } = await generate('d1');
    const checklistId = body.id;
    const key = '排烟#kt_form';
    const removed = await app.request(`/checklists/${checklistId}/items/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: JSON.stringify({ removed: true }),
    });
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as { removed: boolean }).removed).toBe(true);
    const view = (await (
      await app.request(`/checklists/${checklistId}`, { headers: auth(token) })
    ).json()) as { removedKeys: string[] };
    expect(view.removedKeys).toEqual([key]);
    const restored = await app.request(`/checklists/${checklistId}/items/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: JSON.stringify({ removed: false }),
    });
    expect(((await restored.json()) as { removed: boolean }).removed).toBe(false);
  });
});

describe('清单导出', () => {
  it('导出可直接打印的 Markdown', async () => {
    const { body } = await generate('d1');
    const res = await app.request(`/checklists/${body.id}/export`, { headers: auth(token) });
    expect(res.headers.get('content-type')).toContain('text/markdown');
    const md = await res.text();
    expect(md).toContain('# 量房沟通清单 · 张先生');
    expect(md).toContain('为什么问：');
  });
});

describe('现场记录', () => {
  it('批量同步后给出已问 / 没问上 / 还没问到', async () => {
    const { body } = await generate('d1');
    const checklistId = body.id;
    const res = await app.request(`/checklists/${checklistId}/site-records`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({
        records: [
          { id: 'r1', demandSheetId: 'd1', checklistId, itemKey: '排烟#kt_form', status: 'asked', note: '烟道在窗侧', at: '14:26', operator: '王设计' },
          { id: 'r2', demandSheetId: 'd1', checklistId, itemKey: '结构#survey', status: 'skip', note: '物业说换过管线', at: '14:22', operator: '王设计' },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const saved = (await res.json()) as { stats: { asked: number; skip: number; left: number; mustAskOpen?: number; must: number; mustAsked: number } };
    expect(saved.stats).toMatchObject({ asked: 1, skip: 1, left: 17, must: 10, mustAsked: 1 });
    const summary = (await (
      await app.request(`/checklists/${checklistId}/summary`, { headers: auth(token) })
    ).json()) as { demandName: string; stats: { asked: number }; recordMarkdown: string };
    expect(summary.demandName).toBe('张先生');
    expect(summary.stats.asked).toBe(1);
    expect(summary.recordMarkdown).toContain('# 量房记录 · 张先生');
  });

  it('记录指向不存在的条目时整批拒收', async () => {
    const { body } = await generate('d1');
    const res = await app.request(`/checklists/${body.id}/site-records`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({
        records: [
          { id: 'r1', demandSheetId: 'd1', checklistId: body.id, itemKey: '不存在的条目', status: 'asked', note: '', at: '14:26', operator: '王设计' },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('同一条目重复同步不会写重（按客户端 uuid 去重）', async () => {
    const { body } = await generate('d1');
    const payload = JSON.stringify({
      records: [
        { id: 'r1', demandSheetId: 'd1', checklistId: body.id, itemKey: '排烟#kt_form', status: 'asked', note: '', at: '14:26', operator: '王设计' },
      ],
    });
    const post = () =>
      app.request(`/checklists/${body.id}/site-records`, {
        method: 'POST',
        headers: jsonHeaders(token),
        body: payload,
      });
    await post();
    await post();
    const listed = (await (
      await app.request(`/checklists/${body.id}/site-records`, { headers: auth(token) })
    ).json()) as { records: unknown[] };
    expect(listed.records).toHaveLength(1);
  });
});
