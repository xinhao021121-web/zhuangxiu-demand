/**
 * API 层：鉴权与角色、契约校验、清单流水线、外发审计、现场记录。
 *
 * 用 Node 自带的 SQLite 跑真实库（部署形态是 Postgres，换的是适配器不是这一层）。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createModel, setValue } from '@zx/field-spec';
import { buildHandoff, buildSubmission, createDraft } from '@zx/data';
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
let repo: ReturnType<typeof createRepo>;
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
  repo = createRepo(openDatabase(':memory:'));
  seedDatabase(repo);
  const env = readEnv({
    AUTH_CODE: '000000',
    TOKEN_SECRET: 'test-secret',
    DB_PATH: ':memory:',
  } as NodeJS.ProcessEnv);
  return createApp({ repo, provider, env, now: () => '2026-09-23 10:05' });
}

/** 采集通道：先换一个匿名会话令牌（房主不是用户，不走内部登录）。 */
async function openSession(): Promise<string> {
  const res = await app.request('/a/session', { method: 'POST' });
  const body = (await res.json()) as { token: string; expiresAt: string };
  return body.token;
}

/** 一份采集端会交上来的需求单：只填了一个字段，别的都空着。 */
function submittedSheet(extra: Record<string, unknown> = {}) {
  return {
    submissionId: 'a-lq3k-7f2',
    schemaVersion: '1.0',
    submittedAt: '2026-09-25T08:00:00.000Z',
    source: 'miniapp',
    form: { values: { base_area: 89, live_pet: ['猫'] }, instances: {} },
    aiMarks: ['pet_litter_box'],
    ...extra,
  };
}

async function collect(session: string, payload: unknown) {
  const res = await app.request('/a/demand-sheets', {
    method: 'POST',
    headers: jsonHeaders(session),
    body: JSON.stringify(payload),
  });
  return { res, body: (await res.json()) as { id: string; submittedAt: string; acceptedEvents: number; replay: boolean } };
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

  it('导入的来源由路由决定：JSON 里写 miniapp 也记成 file，提交人是导入的人', async () => {
    const sheet = (seedSheets as unknown as Record<string, unknown>[])[2];
    const res = await app.request('/demand-sheets', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ ...sheet, id: undefined, demandName: '别处交来的', source: 'miniapp' }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; source: string };
    expect(created.source).toBe('file');
    const stored = repo.getDemandSheet(created.id)!;
    // 与采集通道相反的两处：来源固定 file、提交人是内部人员
    expect(stored.source).toBe('file');
    expect(stored.submittedBy).not.toBeNull();
  });

  it('房主存下的交接文件，设计师这边原样导入得了（这条路的两端接得上）', async () => {
    // 用采集端真正会用的那个函数造文件：存下来的是文本，导进去的是同一份
    const draft = createDraft();
    draft.model = setValue(createModel(), 'base_area', 76);
    const file = buildHandoff(
      buildSubmission(draft, { submissionId: 'a-handoff-1', submittedAt: '2026-09-24T10:00:00.000Z' }),
    );
    const res = await app.request('/demand-sheets', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: file.text,
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; source: string; demandName: string };
    expect(created.source).toBe('file');
    // 房主端不收集姓名，所以名字是契约默认的「未命名需求单」，设计师再改
    expect(created.demandName).toBe('未命名需求单');
    expect(repo.getDemandSheet(created.id)!.payload.values.base_area).toBe(76);
  });
});

describe('生成清单是一条完整流水线', () => {
  it('种子场景生成出的清单与产品文档的数字一致', async () => {
    const { res, body } = await generate('d1');
    expect(res.status).toBe(201);
    expect(body.counts).toMatchObject({ total: 21, must: 11, suggest: 10 });
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
    expect(detail.checklist.counts.total).toBe(21);
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
    // 降级清单 = 16 项通用核实 + 房主答「不清楚」的新风系统 + 规则托底的猫砂盆位置
    expect(body.counts.total).toBe(20);
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
    expect(body.counts.total).toBe(20);
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
    expect(body.counts.must).toBe(11);
  });
});

describe('核实对象名归一（BC-05）', () => {
  it('模型用自己的名字说资产里已经有的事，清单里只出一条', async () => {
    const variant: ModelProvider = {
      name: 'variant',
      async understand() {
        return {
          profile: [],
          demands: [],
          conflicts: [],
          derivedItems: [
            {
              object: '上水下水',
              question: '上下水点位与排水立管能不能改',
              why: '房主填了「排水点位」',
              onsiteChecks: ['排水立管与管井位置'],
              relatedFieldIds: ['dev_drain'],
              impact: ['feasibility'],
            },
            {
              object: '猫砂盆',
              question: '猫砂盆放哪个卫生间',
              why: '房主填了「是否养宠物：猫」',
              onsiteChecks: ['卫生间排水与通风'],
              relatedFieldIds: ['live_pet'],
              impact: ['feasibility'],
            },
          ],
        };
      },
    };
    const instance = boot(variant);
    const t = await login(DESIGNER, instance);
    const res = await instance.request('/demand-sheets/d1/checklist', {
      method: 'POST',
      headers: jsonHeaders(t),
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as {
      items: { object: string; space: string; source: string; question: string }[];
    };
    const objects = body.items.map((i) => i.object);
    expect(objects, '自创名不该另外出一条').not.toContain('上水下水');
    expect(objects).not.toContain('猫砂盆');
    // 归到通用项的那条：与通用项合并
    expect(body.items.find((i) => i.object === '上下水')!.source).toBe('both');
    // 归到规则托底那条：与规则托底的「猫砂盆位置」并成一条，问题用模型那条
    const cat = body.items.find((i) => i.object === '猫砂盆位置')!;
    expect(cat.space).toBe('卫生间');
    expect(cat.question).toBe('猫砂盆放哪个卫生间');
  });
});

describe('埋点（技术方案 6.11）', () => {
  const batch = {
    batchId: 'batch-1',
    events: [
      { name: 'session', at: Date.parse('2026-09-23T10:00:00+08:00'), props: { env: 'h5', narrow: true } },
      { name: 'shown', at: Date.parse('2026-09-23T10:01:00+08:00'), props: { rule: 'pet-cat' } },
      { name: 'adopt', at: Date.parse('2026-09-23T10:02:00+08:00'), props: { rule: 'pet-cat' } },
    ],
  };
  const postEvents = (id: string, body: unknown, t = token) =>
    app.request(`/demand-sheets/${id}/events`, {
      method: 'POST',
      headers: jsonHeaders(t),
      body: JSON.stringify(body),
    });

  it('采集端整批上报：落库后查得到，带来源与批次', async () => {
    await generate('d1');
    const res = await postEvents('d1', batch);
    expect(res.status).toBe(201);
    expect((await res.json()) as { accepted: number }).toEqual({ accepted: 3, duplicates: 0 });

    const list = (await (await app.request('/demand-sheets/d1/events', { headers: auth(token) })).json()) as {
      name: string;
      at: string;
      source: string;
      batchId: string | null;
      props: Record<string, unknown>;
    }[];
    const client = list.filter((e) => e.source === 'client');
    expect(client.map((e) => e.name)).toEqual(['session', 'shown', 'adopt']);
    expect(client[0].batchId).toBe('batch-1');
    expect(client[1].props).toEqual({ rule: 'pet-cat' });
    // 客户端时钟换算成落库时间，填写时长这类差值才在同一个时钟下算
    expect(client[0].at).toContain('2026-09-23');
  });

  it('断网重试带同一个 batchId，重复上报不会落两次', async () => {
    await generate('d1');
    await postEvents('d1', batch);
    const again = await postEvents('d1', batch);
    expect((await again.json()) as { accepted: number; duplicates: number }).toEqual({
      accepted: 0,
      duplicates: 3,
    });
    const list = (await (await app.request('/demand-sheets/d1/events', { headers: auth(token) })).json()) as unknown[];
    expect(list.filter((e) => (e as { source: string }).source === 'client')).toHaveLength(3);
  });

  it('生成与导出各记一条服务端事件：耗时、降级与条数在里面', async () => {
    const { body } = await generate('d1');
    await app.request(`/checklists/${body.id}/export`, { headers: auth(token) });
    const list = (await (await app.request('/demand-sheets/d1/events', { headers: auth(token) })).json()) as {
      name: string;
      source: string;
      operator: string | null;
      props: Record<string, unknown>;
    }[];
    const generated = list.find((e) => e.name === 'checklist_generate')!;
    expect(generated.source).toBe('server');
    expect(generated.operator).toBe('王设计');
    expect(Number(generated.props.durationMs)).toBeGreaterThanOrEqual(0);
    expect(generated.props.degraded).toBe(false);
    expect(generated.props.items).toBe(body.counts.total);
    expect(list.find((e) => e.name === 'checklist_export')!.props.items).toBe(21);
  });

  it('需求单导入时带的埋点直接落库（采集通道接上之前，走的是这条路）', async () => {
    const imported = await app.request('/demand-sheets', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({
        demandName: '张先生 · 手机版提交',
        submittedAt: '2026-09-24 09:00',
        source: 'miniapp',
        form: { values: { base_area: 89 }, instances: {} },
        aiMarks: [],
        telemetry: batch,
      }),
    });
    expect(imported.status).toBe(201);
    const created = (await imported.json()) as { id: string };
    const list = (await (
      await app.request(`/demand-sheets/${created.id}/events`, { headers: auth(token) })
    ).json()) as { name: string }[];
    expect(list.map((e) => e.name)).toEqual(['session', 'shown', 'adopt']);
  });

  it('清单外的名字与未授权都不收', async () => {
    await generate('d1');
    const bad = await postEvents('d1', { batchId: 'batch-2', events: [{ name: 'click', at: 1 }] });
    expect(bad.status).toBe(400);
    const denied = await app.request('/demand-sheets/d1/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    });
    expect(denied.status).toBe(401);
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
    expect(saved.stats).toMatchObject({ asked: 1, skip: 1, left: 19, must: 11, mustAsked: 1 });
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

describe('采集通道与内部通道分离', () => {
  it('房主不是用户：换会话不需要账号，会话里也没有任何身份', async () => {
    const res = await app.request('/a/session', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expiresAt: string };
    expect(body.token.split('.')).toHaveLength(2);
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
    expect(JSON.stringify(body)).not.toContain('王设计');
  });

  it('两条通道的令牌互不通用：换一把钥匙、换一个 scope', async () => {
    const session = await openSession();
    // 会话令牌调内部接口：内部守卫只认内部 token
    expect((await app.request('/demand-sheets', { headers: auth(session) })).status).toBe(401);
    // 内部 token 调采集通道：采集通道只认会话令牌
    const res = await app.request('/a/demand-sheets', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify(submittedSheet()),
    });
    expect(res.status).toBe(401);
    expect(repo.getDemandSheet('a-lq3k-7f2')).toBeUndefined();
  });

  it('没有会话就提交不了', async () => {
    const res = await app.request('/a/demand-sheets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(submittedSheet()),
    });
    expect(res.status).toBe(401);
  });

  it('提交落库：来源一定是 miniapp、不带提交人，内部列表立刻可见', async () => {
    const session = await openSession();
    // 客户端把自己写成 file 也没用：走这条路上来的一定记成房主提交
    const { res, body } = await collect(session, submittedSheet({ source: 'file', demandName: '未命名需求单' }));
    expect(res.status).toBe(201);
    expect(body.replay).toBe(false);

    const stored = repo.getDemandSheet(body.id)!;
    expect(stored.source).toBe('miniapp');
    expect(stored.submittedBy).toBeNull();
    expect(stored.aiMarks).toEqual(['pet_litter_box']);

    const list = (await (await app.request('/demand-sheets', { headers: auth(token) })).json()) as { id: string }[];
    expect(list.map((s) => s.id)).toContain(body.id);
  });

  it('格式不对的需求单挡在契约层，房主那边只看到一句「格式不对」', async () => {
    const session = await openSession();
    const { res } = await collect(session, { submittedAt: '2026-09-25' });
    expect(res.status).toBe(400);
  });

  it('整批埋点随需求单落库：来源 client、没有操作人（房主不是用户）', async () => {
    const session = await openSession();
    const at = Date.now();
    const { body } = await collect(
      session,
      submittedSheet({
        telemetry: {
          batchId: 'a-lq3k-7f2',
          events: [
            { name: 'session', at: at - 60_000, props: { env: 'h5', narrow: true } },
            { name: 'ignore', at: at - 30_000, props: { rule: 'pet-cat', id: 'pet-cat#-' } },
            { name: 'submit', at, props: { length: 120 } },
          ],
        },
      }),
    );
    expect(body.acceptedEvents).toBe(3);
    const events = repo.listEvents(body.id);
    expect(events.map((e) => e.name)).toEqual(['session', 'ignore', 'submit']);
    expect(events[0].source).toBe('client');
    expect(events[0].operator).toBeNull();
    expect(events[0].batchId).toBe('a-lq3k-7f2');
    expect(events[0].props).toEqual({ env: 'h5', narrow: true });
    // 客户端时钟换算成落库时间：填写时长这类差值要在同一个时钟下算
    expect(new Date(events[2].at).getTime()).toBe(at);
  });

  it('弱网重试：同一个 submissionId 只落一份，回执说清这是重放', async () => {
    const session = await openSession();
    const sheet = submittedSheet({ submissionId: 'a-retry-1' });
    const first = await collect(session, sheet);
    expect(first.res.status).toBe(201);
    const again = await collect(session, sheet);
    // 重放的回执只回客户端自己带上来的值，不回库里的行——这条通道没有读接口
    expect(again.res.status).toBe(200);
    expect(again.body).toEqual({
      id: 'a-retry-1',
      submittedAt: sheet.submittedAt,
      acceptedEvents: 0,
      replay: true,
    });
    expect(repo.listDemandSheets().filter((s) => s.id === 'a-retry-1')).toHaveLength(1);
  });

  it('同一批埋点重新提交（重填后再交一次）不会被计两遍', async () => {
    const session = await openSession();
    const telemetry = { batchId: 'b-repeat', events: [{ name: 'adopt', at: Date.now(), props: { rule: 'pet-cat' } }] };
    const first = await collect(session, submittedSheet({ submissionId: 'a-one', telemetry }));
    expect(first.body.acceptedEvents).toBe(1);
    // 换个 submissionId 就等于新的一份需求单，但事件带的还是同一批号：幂等键仍然是 (batchId, 批内序号)
    const second = await collect(session, submittedSheet({ submissionId: 'a-two', telemetry }));
    expect(second.body.acceptedEvents).toBe(0);
  });

  it('采集通道没有读接口：拿着会话令牌也读不到任何需求单', async () => {
    const session = await openSession();
    const { body } = await collect(session, submittedSheet());
    const paths = [
      '/a/demand-sheets',
      `/a/demand-sheets/${body.id}`,
      `/a/demand-sheets/${body.id}/events`,
      '/a/users',
      '/a/health',
    ];
    for (const path of paths) {
      const res = await app.request(path, { headers: auth(session) });
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).not.toContain('张先生');
    }
  });

  it('采集端那份 JSON 与内部导入是同一个契约：草稿直接提交，内部详情读回同一份表单', async () => {
    // 用采集端真正会用的那个函数拼需求单，而不是测试里另写一份——两端的接缝就在这儿
    const draft = createDraft();
    draft.model = setValue(createModel(), 'base_area', 89);
    draft.aiMarks = { budget_reserve: true };
    const sheet = buildSubmission(draft, {
      submissionId: 'a-draft-1',
      submittedAt: '2026-09-25T08:00:00.000Z',
    });

    const session = await openSession();
    const { body } = await collect(session, sheet);
    const detail = (await (
      await app.request(`/demand-sheets/${body.id}`, { headers: auth(token) })
    ).json()) as {
      sheet: { schemaVersion: string; source: string; aiMarks: string[] };
      form: { values: Record<string, unknown> };
    };
    expect(detail.sheet.source).toBe('miniapp');
    expect(detail.sheet.schemaVersion).toBe('1.0');
    expect(detail.sheet.aiMarks).toEqual(['budget_reserve']);
    expect(detail.form.values.base_area).toBe(89);
  });
});

describe('改名、遗漏补录与回流报表', () => {
  const rename = (id: string, demandName: string, t = token) =>
    app.request(`/demand-sheets/${id}`, {
      method: 'PATCH',
      headers: jsonHeaders(t),
      body: JSON.stringify({ demandName }),
    });

  const omit = (id: string, body: unknown, t = token) =>
    app.request(`/demand-sheets/${id}/omissions`, {
      method: 'POST',
      headers: jsonHeaders(t),
      body: JSON.stringify(body),
    });

  const reports = async (t = token) =>
    (await (await app.request('/reports', { headers: auth(t) })).json()) as {
      rules: { ruleId: string; shown: number; adopted: number; rejected: number; rejectRate: number | null }[];
      criteria: { group: string; items: number; removed: number; removalRate: number | null }[];
      fields: { fieldId: string; label: string; referenced: number; skipped: number; skipRate: number | null; corrected: number | null }[];
      omissions: { space: string; category: string; note: string; demandName: string; operator: string }[];
      unavailable: { column: string; reason: string }[];
    };

  it('改名只动名字，房主填的内容一个字不变', async () => {
    const res = await rename('d1', '张先生 · 89㎡ 老房翻新');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { demandName: string }).demandName).toBe('张先生 · 89㎡ 老房翻新');

    const detail = (await (await app.request('/demand-sheets/d1', { headers: auth(token) })).json()) as {
      sheet: { demandName: string; submittedAt: string };
      form: { values: Record<string, unknown> };
    };
    expect(detail.sheet.demandName).toBe('张先生 · 89㎡ 老房翻新');
    expect(detail.form.values.base_area).toBe(89);
    // 时间、来源、表单都没跟着动
    expect(detail.sheet.submittedAt).toBe('2026-09-21 20:14');
  });

  it('空名字与不存在的需求单各有各的说法', async () => {
    expect((await rename('d1', '   ')).status).toBe(400);
    expect((await rename('不存在', '随便叫')).status).toBe(404);
  });

  it('补录一条遗漏：落成 omission_log 事件，台账按时间倒序', async () => {
    const first = await omit('d1', { space: '主卧', category: '字段清单', note: '阳台有没有晾晒需求' });
    expect(first.status).toBe(201);
    const ledger = (await first.json()) as { space: string; category: string; demandName: string; operator: string }[];
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      space: '主卧',
      category: '字段清单',
      demandName: '张先生',
      operator: '王设计',
    });

    const second = await omit('d1', { space: '卫生间', category: '通用清单', note: '楼上邻居的下水噪声' });
    const two = (await second.json()) as { space: string; at: string }[];
    expect(two).toHaveLength(2);
    // 两次补录的落库时间一样（测试时钟固定），按写入先后倒序：后补的排前面
    expect(two[0].space).toBe('卫生间');

    // 口径一处定义：台账就是这些事件，事件表里当然查得到
    const events = (await (await app.request('/demand-sheets/d1/events', { headers: auth(token) })).json()) as {
      name: string;
      source: string;
      operator: string;
    }[];
    const logged = events.filter((e) => e.name === 'omission_log');
    expect(logged).toHaveLength(2);
    expect(logged[0]).toMatchObject({ source: 'server', operator: '王设计' });
  });

  it('补录要选分区、归类必须是四类之一', async () => {
    expect((await omit('d1', { space: '', category: '字段清单' })).status).toBe(400);
    expect((await omit('d1', { space: '主卧', category: '说不清哪一类' })).status).toBe(400);
    expect((await omit('不存在', { space: '主卧', category: '字段清单' })).status).toBe(404);
  });

  it('报表：判据、字段、遗漏三张表用真数据算，规则表没有埋点就是空的', async () => {
    await generate('d1');
    await omit('d1', { space: '卫生间', category: '模型推演', note: '楼上邻居的下水噪声' });
    const view = await reports();

    expect(view.criteria.length).toBeGreaterThan(0);
    expect(view.criteria.every((c) => c.removalRate !== null)).toBe(true);
    expect(view.fields.length).toBeGreaterThan(0);
    expect(view.fields.some((f) => f.referenced > 0)).toBe(true);
    expect(view.fields.every((f) => f.corrected === null)).toBe(true);
    expect(view.omissions[0]).toMatchObject({ demandName: '张先生', operator: '王设计' });
    // 没有采集端埋点：规则表是空的，不是一堆 0（产品文档第十章）
    expect(view.rules).toEqual([]);
    expect(view.unavailable.map((u) => u.column)).toEqual(['现场修正率']);
  });

  it('规则健康度用采集通道提交进来的埋点算', async () => {
    const session = await openSession();
    const at = Date.now();
    await collect(session, {
      ...submittedSheet({ submissionId: 'a-rules-1' }),
      telemetry: {
        batchId: 'a-rules-1',
        events: [
          { name: 'shown', at: at - 3000, props: { rule: 'pet-cat', target: 'base_other', kind: 'discover' } },
          { name: 'shown', at: at - 2000, props: { rule: 'pet-cat', target: 'base_other', kind: 'discover' } },
          { name: 'adopt', at: at - 1000, props: { rule: 'pet-cat', target: 'base_other' } },
          { name: 'ignore', at, props: { rule: 'budget-reserve', id: 'budget#-' } },
        ],
      },
    });

    const view = await reports();
    const cat = view.rules.find((r) => r.ruleId === 'pet-cat')!;
    expect(cat).toMatchObject({ shown: 2, adopted: 1, rejected: 0 });
    expect(cat.rejectRate).toBe(0);
    // 没展示过就被拒了：拒绝率是「还没有样本」，不是 0%
    const budget = view.rules.find((r) => r.ruleId === 'budget-reserve')!;
    expect(budget).toMatchObject({ shown: 0, rejected: 1 });
    expect(budget.rejectRate).toBeNull();
  });

  it('现场记录算进「没问上」率', async () => {
    const { body } = await generate('d1');
    const items = (await (await app.request(`/checklists/${body.id}`, { headers: auth(token) })).json()) as {
      groups: { items: { key: string; relatedFields: string[] }[] }[];
    };
    const first = items.groups.flatMap((g) => g.items).find((i) => i.relatedFields.length > 0)!;
    await app.request(`/checklists/${body.id}/site-records`, {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({
        records: [
          { id: 'r-skip', demandSheetId: 'd1', checklistId: body.id, itemKey: first.key, status: 'skip', note: '没问上', at: '14:30', operator: '王设计' },
        ],
      }),
    });
    const fieldId = first.relatedFields[0].includes('.') ? first.relatedFields[0].split('.')[1] : first.relatedFields[0];
    const row = (await reports()).fields.find((f) => f.fieldId === fieldId)!;
    expect(row).toMatchObject({ skipped: 1, skipRate: 100 });
  });

  it('内部通道的读接口要登录，报表按权限控住', async () => {
    expect((await app.request('/reports')).status).toBe(401);
    expect((await app.request('/demand-sheets/d1/omissions')).status).toBe(401);
    // 采集通道的会话令牌读不了报表：这条通道本来就没有读接口
    const session = await openSession();
    expect((await app.request('/reports', { headers: auth(session) })).status).toBe(401);
  });
});
