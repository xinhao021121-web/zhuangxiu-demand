/** 外发审计记录与现场记录的契约。 */

import { z } from 'zod';

export const OutboundRecordSchema = z.object({
  id: z.string(),
  demandSheetId: z.string(),
  /** 当次生效的策略，事后能还原当时的口径 */
  policyName: z.string(),
  policyVersion: z.string(),
  /** 真正外发的字段键清单（不含不外发字段的值） */
  fieldKeys: z.array(z.string()),
  /** 脱敏命中位置：哪条字段、命中了哪类信息、几次 */
  redactions: z.array(
    z.object({
      fieldKey: z.string(),
      label: z.string(),
      kinds: z.array(z.enum(['phone', 'landline', 'idcard', 'email', 'address', 'wechat'])),
      count: z.number().int().nonnegative(),
    }),
  ),
  unselectedFreeText: z.number().int().nonnegative(),
  at: z.string(),
  operator: z.string(),
});

export const SiteRecordSchema = z.object({
  /** 客户端生成的 uuid：离线创建也能稳定引用 */
  id: z.string(),
  demandSheetId: z.string(),
  checklistId: z.string(),
  /** 条目的稳定标识（核实对象 + 主要来源字段），不带分组 */
  itemKey: z.string().min(1),
  status: z.enum(['asked', 'skip']),
  note: z.string().default(''),
  at: z.string(),
  operator: z.string(),
});

export const SiteRecordBatchSchema = z.object({
  records: z.array(SiteRecordSchema),
});

export type OutboundRecordContract = z.infer<typeof OutboundRecordSchema>;
export type SiteRecordContract = z.infer<typeof SiteRecordSchema>;
