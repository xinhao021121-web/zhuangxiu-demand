// 规则托底：规则命中的高信号发现进清单候选（badcases.md BC-03）。
//
// 两段：先守资产本身的一致性（ruleId、字段、对象写法），再守行为——模型漏了的时候，
// 规则托底要真的把这一条顶上来，而且不能与模型那条重复。

import { describe, expect, it } from 'vitest';
import { FIELD_BY_ID, SURVEY_CHECKLIST, UNCLEAR_CHECKLIST } from '@zx/field-spec';
import { RULE_META } from '@zx/rules';
import { buildChecklist } from '@zx/checklist';
import { RULE_CANDIDATE_ROWS, ruleDerivedItems } from '@zx/service';
import { SEED_DERIVED, SEED_MODEL } from './fixtures/seed';

const CANONICAL_OBJECTS = new Set([
  ...SURVEY_CHECKLIST.map((s) => s.object),
  ...UNCLEAR_CHECKLIST.map((u) => u.object),
]);

describe('规则托底资产', () => {
  it('每条都指向真实存在的规则与字段', () => {
    const ruleIds = new Set(RULE_META.map((m) => m.id));
    RULE_CANDIDATE_ROWS.forEach((row) => {
      expect(ruleIds.has(row.ruleId), `规则不存在：${row.ruleId}`).toBe(true);
      expect(row.fieldIds.length, `没写触发字段：${row.ruleId}`).toBeGreaterThan(0);
      row.fieldIds.forEach((id) => expect(FIELD_BY_ID.has(id), `字段不存在：${id}`).toBe(true));
    });
  });

  it('一个核实对象只定义一次', () => {
    const objects = RULE_CANDIDATE_ROWS.map((r) => r.object);
    expect(new Set(objects).size).toBe(objects.length);
  });

  it('能落到已有资产的行不写多余内容，落不到的要写齐', () => {
    RULE_CANDIDATE_ROWS.forEach((row) => {
      if (CANONICAL_OBJECTS.has(row.object)) {
        expect(
          [row.space, row.tier, row.question, row.onsiteChecks].filter((v) => v !== undefined),
          `${row.object} 已经能落到已有资产上，行里不该再写内容`,
        ).toEqual([]);
        return;
      }
      expect(row.space, `${row.object} 没写分区`).toBeTruthy();
      expect(row.tier, `${row.object} 没写档位`).toBeTruthy();
      expect(row.question, `${row.object} 没写要问什么`).toBeTruthy();
      expect(row.onsiteChecks?.length, `${row.object} 没写现场核实什么`).toBeGreaterThan(0);
    });
  });
});

describe('规则托底的行为', () => {
  it('模型什么都没推出来时，规则托底仍然把「养猫 → 猫砂盆位置」带进清单', () => {
    const checklist = buildChecklist({ model: SEED_MODEL, derived: ruleDerivedItems(SEED_MODEL) });
    const item = checklist.items.find((i) => i.object === '猫砂盆位置');
    expect(item, 'BC-03 的现场：d1 三次全漏，规则托底必须顶上来').toBeDefined();
    expect(item!.space).toBe('卫生间');
    expect(item!.tier).toBe('must');
    expect(item!.relatedFields).toContain('live_pet');
    expect(item!.why).toContain('养宠物');
    expect(item!.onsiteChecks).toContain('就近插座与通风条件');
  });

  it('规则托底与模型推导落在同一个对象上时并成一条，不重复', () => {
    const checklist = buildChecklist({
      model: SEED_MODEL,
      derived: [...SEED_DERIVED, ...ruleDerivedItems(SEED_MODEL)],
    });
    expect(checklist.items.filter((i) => i.object === '猫砂盆位置')).toHaveLength(1);
    // 模型那条在前，问题与档位用它的；规则托底只补依据与字段
    const item = checklist.items.find((i) => i.object === '猫砂盆位置')!;
    expect(item.question).toBe(SEED_DERIVED.find((d) => d.object === '猫砂盆位置')!.question);
    expect(checklist.counts.total).toBe(21);
  });

  it('能落到通用清单上的规则，把通用项变成「两者」并带上这家的依据', () => {
    const checklist = buildChecklist({ model: SEED_MODEL, derived: ruleDerivedItems(SEED_MODEL) });
    const ac = checklist.items.find((i) => i.object === '空调外机');
    expect(ac).toBeDefined();
    expect(ac!.source).toBe('both');
    expect(ac!.why).toContain('中央空调');
    // 通用项的问题文案与档位不被规则托底改掉
    expect(ac!.question).toBe(SURVEY_CHECKLIST.find((s) => s.object === '空调外机')!.item);
    expect(ac!.tier).toBe('suggest');
  });

  it('没命中的规则不产生条目', () => {
    const empty = { values: {}, instances: {} };
    expect(ruleDerivedItems(empty)).toEqual([]);
  });

  it('实例规则的字段带实例前缀、分区用实例名', () => {
    const kid = ruleDerivedItems(SEED_MODEL).find((i) => i.object === '儿童房空间');
    expect(kid, '种子里 room1 是儿童房，规则 room-kid 会命中').toBeDefined();
    expect(kid!.relatedFieldIds).toEqual(['room1.room_type', 'room1.ch_read']);
    expect(kid!.space).toBe('次卧1 · 儿童房');
    expect(kid!.why).toContain('次卧1');
  });

  it('填了计划时间就把工期口径带进清单', () => {
    const model = { ...SEED_MODEL, values: { ...SEED_MODEL.values, date_movein: '2026-11-01' } };
    const timing = ruleDerivedItems(model).find((i) => i.object === '工期口径');
    expect(timing).toBeDefined();
    expect(timing!.relatedFieldIds).toContain('date_movein');
    expect(timing!.why).toContain('计划入住时间');
    expect(timing!.impact).toEqual(['cost']); // 建议问：判据里 cost/schedule 进建议问
  });

  it('担心超预算时把预算口径带进清单，问题沿用待定项资产那一条', () => {
    const budget = ruleDerivedItems(SEED_MODEL).find((i) => i.object === '预算口径');
    expect(budget).toBeDefined();
    expect(budget!.question).toContain('预算上限');
    expect(budget!.relatedFieldIds).toContain('budget_total');
  });
});
