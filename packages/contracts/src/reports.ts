/**
 * 回流报表（产品文档 7.6 的四张口径 + 7.5 的四条判断）。
 *
 * 报表只汇总与排序，不自动改规则：样本量小的时候，噪声很容易把一条好规则误删
 * （产品文档 7.5 第 1 条）。所以这里的每一列都是「给人看的证据」，没有阈值、没有裁决。
 */

import { z } from 'zod';
import { OmissionSchema } from './omission';

/**
 * 规则健康度：每条发现的展示 / 采纳 / 拒绝数与拒绝率。
 *
 * 拒绝率的分母是展示数，不是采纳数——没人看到的发现不该算它被拒绝。
 * 一次都没展示时拒绝率是 null（「还没有样本」），不是 0。
 */
export const RuleHealthSchema = z.object({
  ruleId: z.string(),
  /** 规则的触发条件：只看 id 没法判断该不该下架，界面拿它当人读的名字（规则已删时为 null） */
  trigger: z.string().nullable(),
  shown: z.number().int().nonnegative(),
  adopted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  rejectRate: z.number().nullable(),
});

/**
 * 判据健康度：每组的条目数 / 被删数 / 删减率 / 档位。
 *
 * 这里的「组」是**来源 · 档位**（如「需求推导 · 必问」）：清单条目上没有存它满足了哪条判据
 * （判据只在筛选那一刻用一次），所以这一版按来源与档位分组——它同样回答 7.6 的两个问题：
 * 哪类来源的条目最常被删（推得太宽），以及档位是不是定错了。
 */
export const CriterionHealthSchema = z.object({
  group: z.string(),
  source: z.enum(['derived', 'survey', 'both']),
  tier: z.enum(['must', 'suggest']),
  items: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  removalRate: z.number().nullable(),
});

/**
 * 字段健康度：每个字段的「不清楚」率、「没问上」率、现场修正率。
 *
 * 三个率的分母都写死在实现里，避免同一个数字两种读法：
 *   · 不清楚率 = 答「不清楚」的需求单数 / 有值的需求单数；
 *   · 没问上率 = 被标「没问上」的清单条目数 / 引用到该字段的清单条目数；
 *   · 现场修正率 = 没有来源（现场记录只标「已问 / 没问上」），恒为 null 并进 `unavailable`。
 */
export const FieldHealthSchema = z.object({
  fieldId: z.string(),
  label: z.string(),
  /** 有值的需求单数（分母） */
  answered: z.number().int().nonnegative(),
  unclear: z.number().int().nonnegative(),
  unclearRate: z.number().nullable(),
  /** 引用到该字段的清单条目数（分母） */
  referenced: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  skipRate: z.number().nullable(),
  corrected: z.number().nullable(),
});

export const ReportsSchema = z.object({
  rules: z.array(RuleHealthSchema),
  criteria: z.array(CriterionHealthSchema),
  fields: z.array(FieldHealthSchema),
  /** 遗漏台账：人工补录的「该问而没列」，按分区与归类排 */
  omissions: z.array(OmissionSchema),
  /**
   * 算不出来的列：写清为什么，界面显示「未采集」。
   * 一个假的 0 比空着更糟（产品文档第十章）。
   */
  unavailable: z.array(z.object({ column: z.string(), reason: z.string() })),
});

export type RuleHealth = z.infer<typeof RuleHealthSchema>;
export type CriterionHealth = z.infer<typeof CriterionHealthSchema>;
export type FieldHealth = z.infer<typeof FieldHealthSchema>;
export type Reports = z.infer<typeof ReportsSchema>;
