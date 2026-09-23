/** 需求单：采集端结构化导出的契约（产品文档第三章、技术方案 4.6）。 */

import { z } from 'zod';

/** 采集端导出的字段清单版本；读入时按版本做一次规范化。 */
export const DEMAND_SCHEMA_VERSION = '1.0';

/** 字段值：单选是字符串，多选是字符串数组，数字类字段是数字。 */
export const FieldValueSchema = z.union([z.string(), z.number(), z.array(z.string())]).optional();

export const InstanceStateSchema = z.object({
  key: z.string().min(1),
  section: z.string().min(1),
  values: z.record(z.string(), FieldValueSchema),
});

export const FormModelSchema = z.object({
  values: z.record(z.string(), FieldValueSchema),
  instances: z.record(z.string(), z.array(InstanceStateSchema)),
});

/**
 * 需求单导入体：文件导入与将来的云端提交是同一个接口的两种输入方式。
 *
 * 版本对不上时不静默丢弃——未知字段保留原值，由 API 标注「字段清单已更新」。
 */
export const DemandSheetImportSchema = z.object({
  schemaVersion: z.string().default(DEMAND_SCHEMA_VERSION),
  submittedAt: z.string().min(1),
  /** 文件导入 / 采集端提交；V1 只有前者 */
  source: z.enum(['file', 'miniapp']).default('file'),
  /** 客户称呼：采集端不收集姓名，由导入的人写一个便于识别的叫法 */
  demandName: z.string().default('未命名需求单'),
  form: FormModelSchema,
  /** 助手建议写入的字段，界面上标「助手建议」 */
  aiMarks: z.array(z.string()).default([]),
});

export type FieldValueInput = z.infer<typeof FieldValueSchema>;
export type InstanceStateInput = z.infer<typeof InstanceStateSchema>;
export type FormModelInput = z.infer<typeof FormModelSchema>;
export type DemandSheetImport = z.infer<typeof DemandSheetImportSchema>;
