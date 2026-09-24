/**
 * 埋点契约：事件名只有一份清单，客户端记录、服务端校验、指标取数都认它（技术方案 6.11）。
 *
 * 这份测试守的是「口径不会悄悄漂」：名字改了、上报体形状变了、契约文档里少了接口，都在这里断。
 */

import { describe, expect, it } from 'vitest';
import { EVENT_NAMES } from '@zx/data';
import {
  DemandSheetImportSchema,
  EventBatchSchema,
  StoredEventSchema,
  TrackEventSchema,
  openApiDocument,
} from '@zx/contracts';

describe('埋点事件清单', () => {
  it('清单不重复，且覆盖四类证据里没有别的表能承载的那些', () => {
    expect(new Set(EVENT_NAMES).size).toBe(EVENT_NAMES.length);
    // 采集端：发现展示与三个动作是采纳率 / 不感兴趣率的分子分母
    ['session', 'shown', 'adopt', 'ignore', 'keep', 'quiet_on', 'install', 'submit'].forEach((name) =>
      expect(EVENT_NAMES).toContain(name),
    );
    // 服务端：生成与导出是没有别的表能承载的瞬时动作
    ['checklist_generate', 'checklist_export'].forEach((name) => expect(EVENT_NAMES).toContain(name));
    // 清单删减与现场记录各自有表，不重复埋点
    expect(EVENT_NAMES).not.toContain('item_remove');
    expect(EVENT_NAMES).not.toContain('site_record');
  });

  it('清单外的名字上报不进来', () => {
    expect(TrackEventSchema.safeParse({ name: 'click', at: 1 }).success).toBe(false);
    expect(TrackEventSchema.safeParse({ name: 'shown', at: 1, props: { rule: 'pet-cat' } }).success).toBe(true);
  });

  it('整批上报要带 batchId，且条数有上限', () => {
    expect(EventBatchSchema.safeParse({ batchId: '', events: [] }).success).toBe(false);
    expect(EventBatchSchema.safeParse({ batchId: 'b1', events: [{ name: 'submit', at: 1 }] }).success).toBe(true);
    const tooMany = {
      batchId: 'b1',
      events: Array.from({ length: 501 }, () => ({ name: 'shown', at: 1 })),
    };
    expect(EventBatchSchema.safeParse(tooMany).success).toBe(false);
  });

  it('落库后的事件带来源、操作人与幂等键', () => {
    const parsed = StoredEventSchema.safeParse({
      id: 'e1',
      demandSheetId: 'd1',
      name: 'adopt',
      at: '2026-09-25T02:00:00.000Z',
      props: { rule: 'pet-cat' },
      source: 'client',
      operator: '王设计',
      batchId: 'batch-1',
      seq: 2,
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('需求单导入体可以带一批埋点，也可以不带（文件导入）', () => {
    const base = {
      submittedAt: '2026-09-25T02:00:00.000Z',
      form: { values: {}, instances: {} },
    };
    expect(DemandSheetImportSchema.safeParse(base).success).toBe(true);
    const withTelemetry = DemandSheetImportSchema.safeParse({
      ...base,
      telemetry: { batchId: 'batch-1', events: [{ name: 'session', at: 1, props: { narrow: true } }] },
    });
    expect(withTelemetry.success).toBe(true);
  });

  it('契约文档里有上报与查询接口', () => {
    const doc = openApiDocument();
    const path = doc.paths['/demand-sheets/{id}/events'] as { get?: unknown; post?: unknown };
    expect(path.post).toBeTruthy();
    expect(path.get).toBeTruthy();
    expect(doc.components.schemas).toHaveProperty('EventBatch');
    expect(doc.components.schemas).toHaveProperty('StoredEvent');
  });
});
