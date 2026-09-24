/**
 * 评测用例集（技术方案 4.7、产品文档第十章）。
 *
 * 用例怎么来的：不从零手写 191 个字段，而是在三个种子需求单上做**变异**——
 * 每个用例只改几个字段，并在 `intent` 里写清它在考什么。这样用例可维护，
 * 考点也明确：改一个字段就知道该看哪一条指标。
 *
 * 两类用例：
 *
 * - `recorded: true`：种子的录制输出在 `services/api/seed/demand-sheets.json` 里，
 *   离线也跑得动，用作**回归门禁**（一次改动 = 一次种子场景回归）。
 * - `recorded: false`：没有录制输出，离线自动跳过，只有真机实测（`pnpm run eval:model`）
 *   才会跑。它们用来量质量，不用来当门禁。
 *
 * 期望怎么标：**只写「房主已经暴露、清单必须接住什么」，不写「模型该输出什么」。**
 * 每条期望都能追到用例改了哪个字段，否则就是抄答案。
 */

import type { FieldValue, FormModel } from '@zx/field-spec';
import type { EvalCase } from '@zx/service';
import seed from '../services/api/seed/demand-sheets.json';

const sheets = seed as unknown as { id: string; demandName: string; form: FormModel }[];

function baseOf(id: string): FormModel {
  const found = sheets.find((s) => s.id === id);
  if (!found) throw new Error(`种子需求单不存在：${id}`);
  return JSON.parse(JSON.stringify(found.form)) as FormModel;
}

function withValues(model: FormModel, values: Record<string, FieldValue>): FormModel {
  return { ...model, values: { ...model.values, ...values } };
}

/** 实例字段的写法是「实例键.字段ID」，这里按实例键改。 */
function withInstance(model: FormModel, instanceKey: string, values: Record<string, FieldValue>): FormModel {
  const instances: FormModel['instances'] = {};
  Object.entries(model.instances).forEach(([section, list]) => {
    instances[section] = list.map((inst) =>
      inst.key === instanceKey ? { ...inst, values: { ...inst.values, ...values } } : inst,
    );
  });
  return { ...model, instances };
}

export const EVAL_CASES: EvalCase[] = [
  // ── 回归门禁：三个种子场景，有录制输出 ───────────────────────────────
  {
    id: 'd1',
    demandName: '张先生',
    recorded: true,
    intent: '旧房翻新 + 养猫 + 三口之家：清单要接住房主填过的内容，不能只出 16 项通用提醒',
    model: baseOf('d1'),
    expectation: {
      coverFields: ['base_house_state', 'live_pet', 'bl_window'],
      coverObjects: ['猫砂盆位置'],
      mergeObjects: ['旧房隐蔽', '家政封窗'],
    },
  },
  {
    id: 'd2',
    demandName: '李女士',
    recorded: true,
    intent: '毛坯新房、字段填得少：信息不足时不许硬凑',
    model: baseOf('d2'),
    expectation: {
      coverFields: ['wc1.wc_toilet'],
      maxNovelObjects: 2,
    },
  },
  {
    id: 'd3',
    demandName: '陈先生',
    recorded: true,
    intent: '65㎡ 旧房翻新 + 独居、字段最少：清单应主要由通用核实撑起来',
    model: baseOf('d3'),
    expectation: {
      coverFields: ['base_house_state'],
      maxNovelObjects: 1,
    },
  },

  // ── 边界用例：没有录制输出，只跑真机实测 ────────────────────────────
  {
    id: 'b1-open-kitchen',
    demandName: 'd1 · 开放式厨房',
    recorded: false,
    intent: '开放式厨房 × 高频下厨：必须问到排烟，并与通用项并成一条',
    model: withValues(baseOf('d1'), { kt_form: '开放式', kt_freq: '经常' }),
    expectation: { coverFields: ['kt_form', 'kt_freq'], mergeObjects: ['排烟'] },
  },
  {
    id: 'b2-unclear-height',
    demandName: 'd1 · 层高不清楚',
    recorded: false,
    intent: '房主对层高答「不清楚」：等于把判断交给设计师，量房时必须问到',
    model: withValues(baseOf('d1'), { base_height: '不清楚' }),
    expectation: { coverFields: ['base_height'] },
  },
  {
    id: 'b3-two-cats',
    demandName: 'd2 · 养两只猫',
    recorded: false,
    intent: '毛坯新房养两只猫：猫砂盆的位置与数量要接住',
    model: withValues(baseOf('d2'), { live_pet: ['猫'], live_pet_count: 2 }),
    expectation: { coverFields: ['live_pet', 'live_pet_count'] },
  },
  {
    id: 'b4-big-appliance',
    demandName: 'd3 · 大件电器',
    recorded: false,
    intent: '填了双开门冰箱与洗碗机：尺寸要在量房时确认，影响橱柜与水电',
    model: withValues(baseOf('d3'), { kt_fridge: '双开门冰箱', kt_dishwasher: '需要' }),
    expectation: { coverFields: ['kt_fridge', 'kt_dishwasher'] },
  },
  {
    id: 'b5-elder',
    demandName: 'd1 · 有老人同住',
    recorded: false,
    intent: '有老人或行动不便成员：无障碍与防滑要现场问清楚',
    model: withValues(baseOf('d1'), { live_elder: '是' }),
    expectation: { coverFields: ['live_elder'] },
  },
  {
    id: 'b6-home-office',
    demandName: 'd2 · 在家办公',
    recorded: false,
    intent: '在家办公 + 电路细节需求：网口与插座点位要现场定',
    model: withValues(baseOf('d2'), {
      office_need: '经常',
      dev_circuit: ['双控开关', 'USB充电口'],
    }),
    expectation: { coverFields: ['office_need', 'dev_circuit'] },
  },
  {
    id: 'b7-oldhouse-from-new',
    demandName: 'd2 · 改成旧房翻新',
    recorded: false,
    intent: '把毛坯改成旧房翻新：旧房管线与防水必须进清单，并与通用项合并',
    model: withValues(baseOf('d2'), { base_house_state: '旧房翻新' }),
    expectation: { coverFields: ['base_house_state'], mergeObjects: ['旧房隐蔽'] },
  },
  {
    id: 'b8-tight-schedule',
    demandName: 'd1 · 预算与工期紧',
    recorded: false,
    intent: '预算收紧 + 入住时间明确：成本与工期类问题要出现（进建议问）',
    model: withValues(baseOf('d1'), { budget_total: '10-20万', date_movein: '2026-11-01' }),
    expectation: { coverFields: ['budget_total', 'date_movein'] },
  },
  {
    id: 'b9-instance-field',
    demandName: 'd1 · 实例字段',
    recorded: false,
    intent: '实例字段写成「实例键.字段ID」：清单要能指到它，且不被白名单判为越界',
    model: withInstance(baseOf('d1'), 'room1', { ch_read: '需要' }),
    expectation: { coverFields: ['room1.ch_read'] },
  },
  {
    id: 'b10-empty',
    demandName: '空需求单',
    recorded: false,
    intent: '几乎没有可引用内容：不许编造通用清单之外的问题',
    model: { values: {}, instances: {} },
    expectation: { maxNovelObjects: 0 },
  },
];

/** 离线回归只跑有录制输出的用例。 */
export const RECORDED_CASES = EVAL_CASES.filter((c) => c.recorded);
