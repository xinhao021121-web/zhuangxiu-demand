/**
 * 遗漏补录（产品文档 7.5 第 5 条）：量房结束后由设计师补一句「这次该问但没列的是……」。
 *
 * 它不产生于任何自动动作，是判据准不准的最终裁判，所以落库形状与清单、现场记录都不同：
 * 一条记录 = 分区 + 归类 + 一句话，按时间追加，不回溯改历史（技术方案 6.9）。
 */

import { z } from 'zod';

/**
 * 归类：这条遗漏是哪一段漏的。前三类各对应一条回路，第四类只是先记下来——
 * 不是让设计师做一次分类学，他只回答「该谁改」，改动落点由这个值决定（产品文档 7.3）。
 */
export const OMISSION_CATEGORIES = [
  /** 模型该从已填内容里推出来、却没推出来（回路 B：判据与模型） */
  '模型推演',
  /** 16 项通用量房清单里没有这一条（回路 B：判据与资产） */
  '通用清单',
  /** 表单里根本没问过这个（回路 C：字段清单） */
  '字段清单',
  /** 说不清是哪一段漏的，先记下来 */
  '说不清',
] as const;

export const OmissionCategorySchema = z.enum(OMISSION_CATEGORIES);

export const OmissionCreateSchema = z.object({
  /** 归属分区：与清单同口径（「基本信息」「主卫」这类具体实例名） */
  space: z.string().trim().min(1).max(40),
  category: OmissionCategorySchema,
  /** 一句话：该问的是什么。台账的价值全在这一句里，所以不能是空的 */
  note: z.string().trim().min(1).max(200),
});

export const OmissionSchema = OmissionCreateSchema.extend({
  id: z.string(),
  demandSheetId: z.string(),
  /** 需求单的叫法：台账上要认得出这是谁家 */
  demandName: z.string(),
  at: z.string(),
  operator: z.string(),
});

export type OmissionCategory = z.infer<typeof OmissionCategorySchema>;
export type OmissionCreate = z.infer<typeof OmissionCreateSchema>;
export type Omission = z.infer<typeof OmissionSchema>;
