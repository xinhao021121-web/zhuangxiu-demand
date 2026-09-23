/** 量房沟通清单与现场记录的契约。 */

import { z } from 'zod';
import { DerivedItemSchema } from './understanding';

export const ChecklistItemSchema = z.object({
  /** 稳定标识：核实对象 + 主要来源字段，不带分组 */
  key: z.string().min(1),
  object: z.string().min(1),
  space: z.string().min(1),
  tier: z.enum(['must', 'suggest']),
  source: z.enum(['derived', 'survey', 'both']),
  question: z.string().min(1),
  why: z.string().min(1),
  onsiteChecks: z.array(z.string()),
  relatedFields: z.array(z.string()),
});

export const ChecklistGroupSchema = z.object({
  space: z.string().min(1),
  items: z.array(ChecklistItemSchema),
  must: z.number().int().nonnegative(),
  suggest: z.number().int().nonnegative(),
});

export const ChecklistSchema = z.object({
  groups: z.array(ChecklistGroupSchema),
  items: z.array(ChecklistItemSchema),
  counts: z.object({
    total: z.number().int().nonnegative(),
    must: z.number().int().nonnegative(),
    suggest: z.number().int().nonnegative(),
    bySpace: z.record(z.string(), z.number().int().nonnegative()),
  }),
  /** 判据筛掉的推导项：不落清单，留档供回头调判据 */
  dropped: z.array(DerivedItemSchema).default([]),
  /** 模型部分没生成时为 true：降级成纯规则清单，界面要标明 */
  degraded: z.boolean().default(false),
  /** 生成时用的模型与规则版本，便于事后还原 */
  model: z.string().default('fake'),
  policyVersion: z.string().default('v1'),
});

export type ChecklistItemContract = z.infer<typeof ChecklistItemSchema>;
export type ChecklistContract = z.infer<typeof ChecklistSchema>;
