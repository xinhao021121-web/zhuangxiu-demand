import { describe, expect, it } from 'vitest';
import { createModel, setValue } from '@zx/field-spec';
import { handleSuggestion } from '@zx/rules';
import {
  DEMAND_SCHEMA_VERSION,
  DRAFT_KEY,
  SCHEMA_VERSION,
  buildSubmission,
  createDraft,
  createLocalRepository,
  createMemoryStorage,
  createCollectionClient,
  migrateDraft,
  newSubmissionId,
} from '@zx/data';
import type { DemandSheetSubmission, JsonRequest, JsonTransport } from '@zx/data';

describe('草稿迁移', () => {
  it('没有草稿时给出默认草稿：两个卫生间、未静默', () => {
    const draft = migrateDraft(null);
    expect(draft.schemaVersion).toBe(SCHEMA_VERSION);
    expect(draft.model.instances['卫生间']).toHaveLength(2);
    expect(draft.assistant.quiet).toBe(false);
  });

  it('旧结构（只有固定字段值）可读，字段清单里没有的字段被丢弃', () => {
    const draft = migrateDraft({
      schemaVersion: 1,
      values: { base_area: 89, legacy_field: '已经删掉的字段', empty_one: '' },
    });
    expect(draft.schemaVersion).toBe(SCHEMA_VERSION);
    expect(draft.model.values.base_area).toBe(89);
    expect(draft.model.values.legacy_field).toBeUndefined();
    expect(draft.model.values.empty_one).toBeUndefined();
    expect(draft.model.instances['卫生间']).toHaveLength(2);
  });

  it('字段清单升级后，实例内已不存在的字段被丢弃', () => {
    const draft = migrateDraft({
      schemaVersion: 1,
      model: {
        values: { base_area: 89 },
        instances: {
          卫生间: [{ key: 'i1', section: '卫生间', values: { wc_type: '主卫', wc_bath: '淋浴', gone: '旧字段' } }],
        },
      },
    });
    expect(draft.model.instances['卫生间']).toHaveLength(1);
    expect(draft.model.instances['卫生间'][0].values.wc_bath).toBe('淋浴');
    expect(draft.model.instances['卫生间'][0].values.gone).toBeUndefined();
  });

  it('静默状态只属于本次会话，读回后不继承', () => {
    const draft = migrateDraft({
      schemaVersion: 2,
      assistant: { handled: { 'pet-cat#-': { status: 'ignored' } }, dismissStreak: 3, quiet: true },
    });
    expect(draft.assistant.quiet).toBe(false);
    expect(draft.assistant.dismissStreak).toBe(3);
    expect(draft.assistant.handled['pet-cat#-']).toEqual({ status: 'ignored' });
  });
});

describe('本地仓储', () => {
  it('草稿可以写入并读回', () => {
    const repo = createLocalRepository(createMemoryStorage());
    const model = setValue(createModel(), 'base_area', 120);
    repo.saveDraft({ ...createDraft(), model });
    expect(repo.loadDraft().model.values.base_area).toBe(120);
    repo.clearDraft();
    expect(repo.loadDraft().model.values.base_area).toBeUndefined();
  });

  it('坏掉的草稿不会让页面崩掉', () => {
    const repo = createLocalRepository(createMemoryStorage({ [DRAFT_KEY]: '{不是 JSON' }));
    expect(repo.loadDraft().schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('埋点落在本地，提交返回结果', () => {
    const storage = createMemoryStorage();
    const repo = createLocalRepository(storage, () => 1000);
    repo.saveDraft(handleDraft());
    repo.track('adopt', { rule: 'pet-cat' });
    repo.track('submit', { length: 12 });
    expect(repo.loadDraft().events.map((e) => e.name)).toEqual(['adopt', 'submit']);
  });

  it('提交只管提交，不会替调用方记事件（事件与表单各写各的）', async () => {
    const repo = createLocalRepository(createMemoryStorage(), () => 1000);
    repo.saveDraft(createDraft());
    repo.track('session', { env: 'h5', narrow: true });
    await repo.submit(submission(), []);
    expect(repo.loadDraft().events.map((e) => e.name)).toEqual(['session']);
  });
});

describe('采集通道', () => {
  it('草稿拼成结构化需求单：表单、助手写入过的字段、字段清单版本、提交 id', () => {
    const draft = handleDraft();
    draft.model = setValue(draft.model, 'base_area', 89);
    const sheet = buildSubmission(draft, { submissionId: 'a-1-2', submittedAt: '2026-09-25T08:00:00.000Z' });
    expect(sheet.submissionId).toBe('a-1-2');
    expect(sheet.source).toBe('miniapp');
    expect(sheet.schemaVersion).toBe(DEMAND_SCHEMA_VERSION);
    expect(sheet.submittedAt).toBe('2026-09-25T08:00:00.000Z');
    expect(sheet.form.values.base_area).toBe(89);
    expect(sheet.form.instances['卫生间']).toHaveLength(2);
    expect(sheet.aiMarks).toEqual([]);
  });

  it('提交 id 客户端生成：带上时间戳，两次不相同', () => {
    expect(newSubmissionId(1000)).toMatch(/^a-[0-9a-z]+-[0-9a-z]+$/);
    expect(newSubmissionId(2000)).not.toBe(newSubmissionId(1000));
  });

  it('没接通道（展示模式）就只留本机，不假装送到了', async () => {
    const repo = createLocalRepository(createMemoryStorage(), () => 1000);
    expect(await repo.submit(submission(), [])).toEqual({ ok: true, at: 1000, delivered: false });
  });

  it('接了通道就真上报；没送出去时把原因翻译成一句话交给界面', async () => {
    const delivered = createLocalRepository(createMemoryStorage(), () => 1000, {
      submit: async () => ({ id: 'a-1-2', replay: false, acceptedEvents: 3 }),
    });
    expect(await delivered.submit(submission(), [])).toEqual({
      ok: true,
      at: 1000,
      delivered: true,
      id: 'a-1-2',
    });

    const failed = createLocalRepository(createMemoryStorage(), () => 1000, {
      submit: async () => {
        throw new Error('网络不通');
      },
    });
    expect(await failed.submit(submission(), [])).toEqual({ ok: false, at: 1000, reason: '网络不通' });
  });
});

describe('采集通道客户端', () => {
  it('先换匿名会话，再带令牌提交；整批埋点与需求单同一批号走', async () => {
    const { calls, transport } = channelStub([
      { status: 201, body: { id: 'a-1-2', replay: false, acceptedEvents: 1 } },
    ]);
    const client = createCollectionClient({ baseUrl: 'https://api.example.com/a/', transport });
    const events = [{ name: 'submit' as const, at: 1000 }];

    expect(await client.submit(submission(), events)).toEqual({ id: 'a-1-2', replay: false, acceptedEvents: 1 });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST https://api.example.com/a/session',
      'POST https://api.example.com/a/demand-sheets',
    ]);
    expect(calls[0].token).toBeUndefined();
    expect(calls[1].token).toBe('session-token');
    expect((calls[1].body as { telemetry: { batchId: string } }).telemetry.batchId).toBe('a-1-2');
  });

  it('第一次没回来的重试带同一个 submissionId：服务端据此不落第二份', async () => {
    const { calls, transport } = channelStub([
      { status: 500, body: { error: '服务端开小差' } },
      { status: 201, body: { id: 'a-1-2', replay: false, acceptedEvents: 0 } },
    ]);
    const client = createCollectionClient({ baseUrl: '/a', transport });
    await client.submit(submission(), []);

    const submitted = calls.filter((c) => c.url.endsWith('/demand-sheets'));
    expect(submitted).toHaveLength(2);
    expect((submitted[0].body as DemandSheetSubmission).submissionId).toBe('a-1-2');
    expect((submitted[1].body as DemandSheetSubmission).submissionId).toBe('a-1-2');
  });

  it('会话过期（401）就换一个新的再来一次，不把房主挡在门外', async () => {
    const { calls, transport } = channelStub([
      { status: 401, body: { error: '会话无效' } },
      { status: 201, body: { id: 'a-1-2', replay: false, acceptedEvents: 0 } },
    ]);
    const client = createCollectionClient({ baseUrl: '/a', transport });
    await client.submit(submission(), []);
    expect(calls.filter((c) => c.url.endsWith('/session'))).toHaveLength(2);
    const submitted = calls.filter((c) => c.url.endsWith('/demand-sheets'));
    expect(submitted).toHaveLength(2);
    expect(submitted[1].token).toBe('session-token');
  });

  it('请求本身不对（4xx）不重试：重发一遍结果一样', async () => {
    const { calls, transport } = channelStub([{ status: 400, body: { error: '需求单格式不对' } }]);
    const client = createCollectionClient({ baseUrl: '/a', transport });
    await expect(client.submit(submission(), [])).rejects.toThrow('需求单格式不对');
    expect(calls.filter((c) => c.url.endsWith('/demand-sheets'))).toHaveLength(1);
  });
});

function submission(): DemandSheetSubmission {
  return {
    submissionId: 'a-1-2',
    schemaVersion: DEMAND_SCHEMA_VERSION,
    submittedAt: '2026-09-25T08:00:00.000Z',
    source: 'miniapp',
    form: { values: {}, instances: {} },
    aiMarks: [],
  };
}

/**
 * 桩传输：换会话固定成功，提交按给定顺序给结果。
 * 两个端点是分开的，所以这里按 url 分流，而不是按调用次数猜。
 */
function channelStub(submissions: { status: number; body: unknown }[]) {
  const calls: JsonRequest[] = [];
  const transport: JsonTransport = async (req) => {
    calls.push(req);
    if (req.url.endsWith('/session')) {
      return {
        status: 200,
        body: { token: 'session-token', expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
      };
    }
    return submissions.shift() ?? { status: 201, body: { id: 'a-1-2', replay: false, acceptedEvents: 0 } };
  };
  return { calls, transport };
}

function handleDraft() {
  const draft = createDraft();
  draft.assistant = handleSuggestion(draft.assistant, 'pet-cat#-', 'adopted', '养猫家庭要预留猫砂盆位置');
  return draft;
}
