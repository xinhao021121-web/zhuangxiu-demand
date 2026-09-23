import { describe, expect, it } from 'vitest';
import { FIELD_BY_ID, SURVEY_CHECKLIST } from '@zx/field-spec';
import type { FormModel } from '@zx/field-spec';
import {
  buildChecklist,
  buildChecklistMarkdown,
  buildSiteRecordMarkdown,
  missingRecommended,
  openQuestions,
  siteStats,
  spaceOrder,
  unclearAnswers,
} from '@zx/checklist';
import type { DerivedItem } from '@zx/checklist';
import { SEED_DERIVED, SEED_MODEL, SEED_NAME, SEED_OVERVIEW, SEED_SUBMITTED } from './fixtures/seed';

const seed = () => buildChecklist({ model: SEED_MODEL, derived: SEED_DERIVED });

describe('量房沟通清单', () => {
  it('种子场景的数字与产品文档一致：必问 9 条 · 共 18 条', () => {
    const list = seed();
    expect(list.counts.total).toBe(18);
    expect(list.counts.must).toBe(9);
    expect(list.counts.suggest).toBe(9);
  });

  it('分区条数均衡，且「基本信息」在最前（产品文档 4.5.1）', () => {
    const list = seed();
    expect(list.counts.bySpace).toEqual({
      基本信息: 6,
      设备与系统: 5,
      客厅: 1,
      厨房: 2,
      阳台: 1,
      主卧: 1,
      卫生间: 1,
      主卫: 1,
    });
    expect(list.groups[0].items[0].space).toBe('基本信息');
  });

  it('带实例的分区先排公共条件组，再按实例逐个排', () => {
    const spaces = seed().groups.map((g) => g.space);
    expect(spaces).toEqual(['基本信息', '设备与系统', '客厅', '厨房', '阳台', '主卧', '卫生间', '主卫']);
    expect(spaces.indexOf('卫生间')).toBeLessThan(spaces.indexOf('主卫'));
  });

  it('只显示有条目的分区，不摆空壳', () => {
    const spaces = seed().groups.map((g) => g.space);
    ['玄关', '餐厅', '收纳与家政', '补充说明'].forEach((empty) => expect(spaces).not.toContain(empty));
    seed().groups.forEach((g) => expect(g.items.length).toBeGreaterThan(0));
  });

  it('同一空间同一核实对象并成一条，问题用推导项的、现场要核实取并集', () => {
    const item = seed().items.find((i) => i.object === '排烟');
    expect(item).toBeDefined();
    expect(item!.source).toBe('both');
    expect(item!.question).toBe('厨房是否接受开放式？油烟与燃气条件能不能满足');
    expect(item!.onsiteChecks).toContain('烟道位置与排烟条件');
    expect(item!.onsiteChecks).toContain('燃气表位置与排烟条件');
    expect(seed().items.find((i) => i.object === '家政封窗')!.source).toBe('both');
  });

  it('档位对齐判据：必问在前，同一组内需求推导排在通用核实前面', () => {
    const basic = seed().groups.find((g) => g.space === '基本信息')!;
    const tiers = basic.items.map((i) => i.tier);
    expect(tiers.indexOf('suggest')).toBe(tiers.lastIndexOf('must') + 1);
    const kitchen = seed().groups.find((g) => g.space === '厨房')!;
    expect(kitchen.items[0].source).toBe('both');
    expect(kitchen.items[1].source).toBe('both');
    expect(kitchen.items[0].tier).toBe('must');
    expect(kitchen.items[1].tier).toBe('suggest');
  });

  it('稳定标识是「核实对象 + 主要来源字段」，不带分组且互不重复', () => {
    const list = seed();
    expect(list.items.find((i) => i.object === '排烟')!.key).toBe('排烟#kt_form');
    expect(list.items.find((i) => i.object === '结构')!.key).toBe('结构#survey');
    expect(list.items.find((i) => i.object === '马桶移位')!.key).toBe('马桶移位#wc_toilet');
    const keys = list.items.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    list.items.forEach((i) => expect(i.key).not.toContain(i.space));
  });

  it('判据不成立、或指不到字段的推导项不进清单', () => {
    const fabricated: DerivedItem = {
      object: '凭空来的',
      question: '要不要做全屋智能',
      why: '模型自己想的',
      onsiteChecks: [],
      relatedFieldIds: [],
      impact: ['direction'],
    };
    const unjudged: DerivedItem = { ...fabricated, object: '没判据的', relatedFieldIds: ['kt_form'], impact: [] };
    const list = buildChecklist({ model: SEED_MODEL, derived: [...SEED_DERIVED, fabricated, unjudged] });
    expect(list.dropped.map((d) => d.object)).toEqual(['凭空来的', '没判据的']);
    expect(list.counts.total).toBe(18);
    // 结构类的通用项确实指不到字段，但它标着「来自通用量房清单」，仍然合规
    expect(list.items.every((i) => i.relatedFields.length > 0 || i.source === 'survey')).toBe(true);
    list.items.forEach((i) => expect(['凭空来的', '没判据的']).not.toContain(i.object));
  });

  it('同一核实对象的分区以通用清单资产为准，不随模型给字段的顺序漂移', () => {
    // 模型把主字段写成 base_house_state（房屋现状）时，「配电」不该落到「基本信息」，
    // 否则它和通用清单里的「配电」并不到一条上，设计师会看到两条各说一半的条目。
    const drifted: DerivedItem = {
      object: '配电',
      question: '旧房的配电箱回路够不够',
      why: '房主填了「房屋现状：旧房翻新」',
      onsiteChecks: ['配电箱回路容量'],
      relatedFieldIds: ['base_house_state', 'dev_circuit'],
      impact: ['feasibility'],
    };
    const list = buildChecklist({ model: SEED_MODEL, derived: [drifted] });
    const items = list.items.filter((i) => i.object === '配电');
    expect(items).toHaveLength(1);
    expect(items[0].space).toBe('设备与系统');
    expect(items[0].source).toBe('both');
    expect(items[0].key).toBe('配电#dev_circuit');
  });

  it('资产里没有的核实对象才按模型指定的分区走', () => {
    const cross: DerivedItem = {
      object: '猫砂盆放哪',
      question: '猫砂盆放哪个卫生间',
      why: '房主填了「是否养宠物：猫」',
      onsiteChecks: ['排水与通风'],
      relatedFieldIds: ['live_pet'],
      impact: ['cost'],
      space: '卫生间',
    };
    const list = buildChecklist({ model: SEED_MODEL, derived: [cross] });
    expect(list.items.find((i) => i.object === '猫砂盆放哪')!.space).toBe('卫生间');
  });  it('每条都能溯源：要么有字段，要么标为来自通用量房清单', () => {
    seed().items.forEach((i) => {
      if (i.relatedFields.length) i.relatedFields.forEach((f) => expect(FIELD_BY_ID.has(f.split('.').pop()!)).toBe(true));
      else expect(i.source).toBe('survey');
    });
  });
});

describe('通用量房清单资产', () => {
  it('16 项都带机器可读的字段映射、核实对象、分区与档位', () => {
    expect(SURVEY_CHECKLIST).toHaveLength(16);
    SURVEY_CHECKLIST.forEach((s) => {
      expect(s.object).toBeTruthy();
      expect(['must', 'suggest']).toContain(s.tier);
      expect(s.space).toBeTruthy();
      expect(s.section).toBeTruthy();
      s.relatedFields.forEach((id) => expect(FIELD_BY_ID.has(id)).toBe(true));
    });
  });

  it('核实对象在清单里唯一，不会两条通用项并成一条', () => {
    const pairs = SURVEY_CHECKLIST.map((s) => `${s.space}|${s.object}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('结构类项的来源字段为空，靠分区分组', () => {
    const structural = SURVEY_CHECKLIST.filter((s) => s.relatedFields.length === 0).map((s) => s.object);
    expect(structural).toEqual(['结构', '墙体', '门窗']);
    SURVEY_CHECKLIST.filter((s) => s.relatedFields.length === 0).forEach((s) => expect(s.space).toBe('基本信息'));
  });
});

describe('表格理解的待确认项', () => {
  it('空缺的推荐项与答「不清楚」的项分开列', () => {
    expect(missingRecommended(SEED_MODEL).map((q) => q.label)).toEqual([
      '是否有老人或行动不便成员',
      '计划入住时间',
      '泡澡需求（次卫）',
    ]);
    expect(unclearAnswers(SEED_MODEL).map((q) => q.label)).toEqual(['新风系统']);
    expect(openQuestions(SEED_MODEL)).toHaveLength(4);
  });

  it('待确认项带得出房主原话，方便当面追问', () => {
    const fresh = openQuestions(SEED_MODEL).find((q) => q.label === '新风系统')!;
    expect(fresh.why).toContain('不确定');
    expect(openQuestions(SEED_MODEL).find((q) => q.label === '是否有老人或行动不便成员')!.why).toBe('推荐填写项未填');
  });
});

describe('清单导出与现场记录', () => {
  it('导出的 Markdown 带标题、分组与逐条依据', () => {
    const md = buildChecklistMarkdown(seed(), {
      name: SEED_NAME,
      overview: SEED_OVERVIEW,
      submitted: SEED_SUBMITTED,
    });
    expect(md).toContain('# 量房沟通清单 · 张先生');
    expect(md).toContain('必问 9 条 · 共 18 条');
    expect(md).toContain('## 基本信息　6 条');
    expect(md).toContain('为什么问：');
    expect(md).toContain('现场要核实：');
  });

  it('现场记录只回答问没问，不回改清单', () => {
    const list = seed();
    const records = [
      { itemKey: '排烟#kt_form', status: 'asked' as const, note: '烟道在窗侧，可做开放式', at: '14:26', synced: true },
      { itemKey: '结构#survey', status: 'skip' as const, note: '物业说 2005 年换过管线', at: '14:22', synced: true },
    ];
    const stats = siteStats(list, records);
    expect(stats.total).toBe(18);
    expect(stats.asked).toBe(1);
    expect(stats.skip).toBe(1);
    expect(stats.left).toBe(16);
    expect(stats.must).toBe(9);
    expect(stats.mustAsked).toBe(1);
    expect(stats.mustOpen).toHaveLength(8);
    const md = buildSiteRecordMarkdown(list, records, { name: SEED_NAME, overview: SEED_OVERVIEW, submitted: SEED_SUBMITTED });
    expect(md).toContain('# 量房记录 · 张先生');
    expect(md).toContain('已问 1 条 · 没问上 1 条 · 还没问到 16 条');
    expect(md).toContain('结论：烟道在窗侧，可做开放式');
    expect(md).toContain('原因：物业说 2005 年换过管线');
  });

  it('同一条目多条记录时以最后一条为准', () => {
    const records = [
      { itemKey: '排烟#kt_form', status: 'skip' as const, note: '房主不在', at: '14:10', synced: true },
      { itemKey: '排烟#kt_form', status: 'asked' as const, note: '可做开放式', at: '14:26', synced: true },
    ];
    expect(siteStats(seed(), records).asked).toBe(1);
    expect(siteStats(seed(), records).skip).toBe(0);
  });
});

describe('需求单本身', () => {
  it('种子数据里的字段 ID 全部存在于字段规格', () => {
    const unknown: string[] = [];
    Object.keys(SEED_MODEL.values).forEach((id) => {
      if (!FIELD_BY_ID.has(id)) unknown.push(id);
    });
    Object.values(SEED_MODEL.instances)
      .flat()
      .forEach((inst) => {
        Object.keys(inst.values).forEach((id) => {
          if (!FIELD_BY_ID.has(id)) unknown.push(id);
        });
      });
    expect(unknown).toEqual([]);
  });

  it('分组顺序跟着需求清单走：基本信息在最前，其余沿用采集端大类', () => {
    const order = spaceOrder(SEED_MODEL);
    expect(order[0]).toBe('基本信息');
    expect(order).toContain('设备与系统');
    expect(order.indexOf('卫生间')).toBeLessThan(order.indexOf('主卫'));
    expect(order.indexOf('主卫')).toBeLessThan(order.indexOf('次卫'));
  });

  it('空需求单也能算出清单：只有通用项，没有推导项', () => {
    const empty: FormModel = { values: {}, instances: {} };
    const list = buildChecklist({ model: empty, derived: [] });
    expect(list.counts.total).toBe(16);
    expect(list.items.every((i) => i.source === 'survey')).toBe(true);
  });
});
