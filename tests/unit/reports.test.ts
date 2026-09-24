/**
 * 回流报表（产品文档 7.6 的四张口径）。
 *
 * 这份测试守两件事：每一列的口径（分子分母写死在这里），以及算不出来时不能变成 0——
 * 一个假的 0 比空着更糟，是这一章反复强调的那条线。
 */

import { describe, expect, it } from 'vitest';
import { buildReports } from '@zx/service';
import type { ChecklistRecord, EventRecord, ReportSource, SheetRecord, SiteRecordRecord } from '@zx/service';
import type { ChecklistItem } from '@zx/checklist';

const sheet = (id: string, demandName: string, values: Record<string, unknown> = {}): SheetRecord => ({
  id,
  demandName,
  schemaVersion: '1.0',
  submittedAt: '2026-09-25T08:00:00.000Z',
  source: 'miniapp',
  submittedBy: null,
  createdAt: '2026-09-25T08:00:00.000Z',
  payload: { values: values as never, instances: {} },
  aiMarks: [],
});

type StoredItem = ChecklistItem & { removed: boolean };

const item = (
  key: string,
  source: ChecklistItem['source'],
  tier: ChecklistItem['tier'],
  removed = false,
): StoredItem => ({
  key,
  object: key.split('#')[0],
  space: '基本信息',
  tier,
  source,
  question: `问 ${key}`,
  why: '因为…',
  onsiteChecks: [],
  relatedFields: [key.split('#')[1]],
  removed,
});

const checklist = (demandSheetId: string, items: StoredItem[]): ChecklistRecord => ({
  id: `c-${demandSheetId}`,
  demandSheetId,
  createdAt: '2026-09-25T09:00:00.000Z',
  model: 'fake',
  ruleVersion: 'v1',
  policyName: 'p',
  policyVersion: 'v1',
  degraded: false,
  understanding: {},
  dropped: [],
  items,
});

let seq = 0;
const event = (name: string, props: Record<string, unknown> = {}, at = '2026-09-25T10:00:00.000Z'): EventRecord => ({
  id: `e${(seq += 1)}`,
  demandSheetId: 's1',
  name,
  at,
  source: name === 'omission_log' ? 'server' : 'client',
  operator: name === 'omission_log' ? '王设计' : null,
  props,
});

function source(parts: {
  sheets?: SheetRecord[];
  checklists?: Record<string, ChecklistRecord>;
  records?: Record<string, SiteRecordRecord[]>;
  events?: EventRecord[];
}): ReportSource {
  return {
    listDemandSheets: () => parts.sheets ?? [],
    latestChecklist: (id) => parts.checklists?.[id],
    listSiteRecords: (id) => parts.records?.[id] ?? [],
    listEvents: () => parts.events ?? [],
  };
}

describe('规则健康度', () => {
  it('按规则归组：分母是展示数，拒绝率算得出来才给数', async () => {
    const reports = await buildReports(
      source({
        events: [
          event('shown', { rule: 'pet-cat' }),
          event('shown', { rule: 'pet-cat' }),
          event('shown', { rule: 'pet-cat' }),
          event('adopt', { rule: 'pet-cat' }),
          event('ignore', { rule: 'pet-cat' }),
          event('shown', { rule: 'budget-reserve' }),
        ],
      }),
    );
    const cat = reports.rules.find((r) => r.ruleId === 'pet-cat')!;
    expect(cat).toMatchObject({ shown: 3, adopted: 1, rejected: 1 });
    expect(cat.rejectRate).toBe(33.3);
    // 展示了但没人理：拒绝率是 0%，不是「没有样本」
    const budget = reports.rules.find((r) => r.ruleId === 'budget-reserve')!;
    expect(budget).toMatchObject({ shown: 1, rejected: 0 });
    expect(budget.rejectRate).toBe(0);
  });

  it('一次都没展示过时，拒绝率是 null 而不是 0', async () => {
    const reports = await buildReports(source({ events: [event('ignore', { rule: 'pet-cat' })] }));
    expect(reports.rules[0]).toMatchObject({ ruleId: 'pet-cat', shown: 0, rejected: 1 });
    expect(reports.rules[0].rejectRate).toBeNull();
  });

  it('没带规则的事件不进这张表，规则名带回触发条件', async () => {
    const reports = await buildReports(source({ events: [event('shown', {}), event('shown', { rule: 'pet-cat' })] }));
    expect(reports.rules.map((r) => r.ruleId)).toEqual(['pet-cat']);
    expect(reports.rules[0].trigger).toContain('猫');
  });
});

describe('判据健康度', () => {
  it('按「来源 · 档位」归组：条目数、被删数、删减率，推导项排最前', async () => {
    const reports = await buildReports(
      source({
        sheets: [sheet('s1', '张先生')],
        checklists: {
          s1: checklist('s1', [
            item('排烟#kt_form', 'derived', 'must', true),
            item('猫砂盆位置#live_pet', 'derived', 'must'),
            item('配电#base_house_state', 'survey', 'must'),
            item('封窗#base_window', 'survey', 'suggest'),
            item('烟道#kt_hood', 'both', 'must', true),
          ]),
        },
      }),
    );
    expect(reports.criteria.map((c) => c.group)).toEqual([
      '需求推导 · 必问',
      '推导+通用 · 必问',
      '通用核实 · 必问',
      '通用核实 · 建议问',
    ]);
    expect(reports.criteria[0]).toMatchObject({ items: 2, removed: 1, removalRate: 50 });
  });

  it('只算每份需求单最新那一份清单，删减取当前状态（撤销后不计入被删）', async () => {
    const reports = await buildReports(
      source({
        sheets: [sheet('s1', '张先生')],
        checklists: { s1: checklist('s1', [item('配电#base_house_state', 'survey', 'must'), item('封窗#base_window', 'survey', 'suggest', true)]) },
      }),
    );
    expect(reports.criteria.map((c) => [c.group, c.items, c.removed])).toEqual([
      ['通用核实 · 必问', 1, 0],
      ['通用核实 · 建议问', 1, 1],
    ]);
  });
});

describe('字段健康度', () => {
  const sheets = [
    sheet('s1', '张先生', { base_area: 89, dev_freshair: '不确定' }),
    sheet('s2', '李女士', { base_area: 120, dev_freshair: '中央新风' }),
    sheet('s3', '陈先生', { dev_freshair: '不清楚' }),
  ];

  it('不清楚率 = 答「不清楚」的需求单数 / 有值的需求单数', async () => {
    const reports = await buildReports(source({ sheets }));
    const air = reports.fields.find((f) => f.fieldId === 'dev_freshair')!;
    expect(air).toMatchObject({ answered: 3, unclear: 2 });
    expect(air.unclearRate).toBe(66.7);
    // 两份填了面积、没人答不清楚：0% 与「没有样本」是两回事
    const area = reports.fields.find((f) => f.fieldId === 'base_area')!;
    expect(area).toMatchObject({ answered: 2, unclear: 0 });
    expect(area.unclearRate).toBe(0);
  });

  it('没问上率 = 被标「没问上」的清单条目数 / 引用到该字段的条目数', async () => {
    const reports = await buildReports(
      source({
        sheets: [sheet('s1', '张先生')],
        checklists: {
          s1: checklist('s1', [
            item('排烟#kt_form', 'derived', 'must'),
            item('新风#dev_freshair', 'derived', 'suggest'),
          ]),
        },
        records: {
          'c-s1': [
            {
              id: 'r1',
              demandSheetId: 's1',
              checklistId: 'c-s1',
              itemKey: '排烟#kt_form',
              status: 'asked',
              note: '',
              at: '14:20',
              operator: '王设计',
            },
            {
              id: 'r2',
              demandSheetId: 's1',
              checklistId: 'c-s1',
              itemKey: '新风#dev_freshair',
              status: 'skip',
              note: '物业说要等交付',
              at: '14:26',
              operator: '王设计',
            },
          ],
        },
      }),
    );
    expect(reports.fields.find((f) => f.fieldId === 'dev_freshair')).toMatchObject({
      referenced: 1,
      skipped: 1,
      skipRate: 100,
    });
    // 问了、没被标「没问上」：分母有、分子 0，就是 0%
    expect(reports.fields.find((f) => f.fieldId === 'kt_form')).toMatchObject({
      referenced: 1,
      skipped: 0,
      skipRate: 0,
    });
  });

  it('现场修正率没有来源：恒为 null，并在 unavailable 里写清为什么', async () => {
    const reports = await buildReports(source({ sheets }));
    expect(reports.fields.every((f) => f.corrected === null)).toBe(true);
    expect(reports.unavailable.map((u) => u.column)).toContain('现场修正率');
    expect(reports.unavailable[0].reason).toContain('现场记录');
  });
});

describe('遗漏台账', () => {
  it('按时间倒序，带上是谁家、谁补的；没写归类时落在「说不清」', async () => {
    const reports = await buildReports(
      source({
        sheets: [sheet('s1', '张先生')],
        events: [
          event('omission_log', { space: '主卧', category: '字段清单', note: '阳台有没有晾晒需求' }, '2026-09-25T09:00:00.000Z'),
          event('omission_log', { space: '卫生间', note: '楼上邻居的下水噪声' }, '2026-09-25T10:00:00.000Z'),
        ],
      }),
    );
    expect(reports.omissions.map((o) => o.space)).toEqual(['卫生间', '主卧']);
    expect(reports.omissions[0]).toMatchObject({ demandName: '张先生', category: '说不清', operator: '王设计' });
    expect(reports.omissions[1].note).toContain('晾晒');
  });

  it('没有补录过就是空台账——不是「遗漏率 0」', async () => {
    expect((await buildReports(source({ sheets: [sheet('s1', '张先生')] }))).omissions).toEqual([]);
  });
});

describe('空数据', () => {
  it('什么都没有时四张表都是空的，也不编出任何 0', async () => {
    const reports = await buildReports(source({}));
    expect(reports.rules).toEqual([]);
    expect(reports.criteria).toEqual([]);
    expect(reports.fields).toEqual([]);
    expect(reports.omissions).toEqual([]);
    expect(reports.unavailable).toHaveLength(1);
  });
});
