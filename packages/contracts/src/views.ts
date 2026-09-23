/**
 * 读模型：接口返回给界面的形状，仍然是契约的一部分。
 *
 * 这些都是投影——数据来自需求单、规则、脱敏结果与清单，界面不再自己算业务结论。
 */

import { z } from 'zod';
import { ChecklistSchema } from './checklist';
import { FormModelSchema } from './demand-sheet';
import { DerivedItemSchema, ProfileLineSchema } from './understanding';

export const ProgressSchema = z.object({
  total: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  percent: z.number().int().min(0).max(100),
});

/** 列表项：核心摘要、提交时间、完成度。 */
export const DemandSheetSummarySchema = z.object({
  id: z.string(),
  demandName: z.string(),
  submittedAt: z.string(),
  source: z.string(),
  overview: z.string(),
  progress: ProgressSchema,
  hasChecklist: z.boolean(),
  checklistId: z.string().nullable(),
});

/** 表格理解四块：画像、诉求、矛盾与风险、待确认项，另附推导项。 */
export const UnderstandingViewSchema = z.object({
  profile: z.array(ProfileLineSchema),
  demands: z.array(z.string()),
  /** 模型给的矛盾 + 规则算出的风险，合并展示 */
  risks: z.array(ProfileLineSchema),
  /** 空缺的推荐项 + 答「不清楚」的项 */
  toConfirm: z.array(
    z.object({ fieldKey: z.string(), label: z.string(), space: z.string(), why: z.string() }),
  ),
  derivedItems: z.array(DerivedItemSchema),
});

export const RedactionHitSchema = z.object({
  kind: z.enum(['phone', 'landline', 'idcard', 'email', 'address', 'wechat']),
  label: z.string(),
  index: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
});

/** 外发前逐条确认：不外发 / 泛化后外发 / 自由文本 / 原样外发。 */
export const OutboundPreviewSchema = z.array(
  z.object({
    tier: z.enum(['no-send', 'generalize', 'free-text', 'raw']),
    title: z.string(),
    hint: z.string(),
    rows: z.array(
      z.object({
        fieldKey: z.string(),
        label: z.string(),
        value: z.string(),
        hits: z.array(RedactionHitSchema),
        selectable: z.boolean(),
        selected: z.boolean(),
      }),
    ),
  }),
);

/** 已生成的清单：多出 id、生成时间与已删减的条目。 */
export const ChecklistViewSchema = ChecklistSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  ruleVersion: z.string(),
  removedKeys: z.array(z.string()),
});

export const DemandSheetDetailSchema = z.object({
  sheet: z.object({
    id: z.string(),
    demandName: z.string(),
    schemaVersion: z.string(),
    submittedAt: z.string(),
    source: z.string(),
    aiMarks: z.array(z.string()),
  }),
  form: FormModelSchema,
  progress: ProgressSchema,
  understanding: UnderstandingViewSchema,
  outboundPreview: OutboundPreviewSchema,
  checklist: ChecklistViewSchema.nullable(),
});

export type Progress = z.infer<typeof ProgressSchema>;
export type DemandSheetSummary = z.infer<typeof DemandSheetSummarySchema>;
export type UnderstandingView = z.infer<typeof UnderstandingViewSchema>;
export type ChecklistView = z.infer<typeof ChecklistViewSchema>;
export type DemandSheetDetail = z.infer<typeof DemandSheetDetailSchema>;
