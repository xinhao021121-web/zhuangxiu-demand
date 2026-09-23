/**
 * 表格理解：客户画像、核心诉求、矛盾与风险、待确认项，以及推导项。
 *
 * 模型返回必须过两道红线（技术方案 4.7）：结构不合法，或出现字段清单之外的 fieldId，
 * 一律判为失败；重试仍失败则降级为纯规则清单，并在该需求单上标明「模型部分未生成」。
 */

import { z } from 'zod';

export const ImpactSchema = z.enum(['feasibility', 'direction', 'cost', 'schedule']);

export const DerivedItemSchema = z.object({
  /** 核实对象：与通用清单合并去重的键之一 */
  object: z.string().min(1),
  question: z.string().min(1),
  why: z.string().min(1),
  onsiteChecks: z.array(z.string()).default([]),
  /** 指不到字段的推导项不合规：够不进清单 */
  relatedFieldIds: z.array(z.string()).min(1),
  /** 判据：一条都没有的不合规 */
  impact: z.array(ImpactSchema).min(1),
  /** 跨空间的问题由模型指定归属分区 */
  space: z.string().optional(),
});

export const ProfileLineSchema = z.object({ label: z.string().min(1), text: z.string().min(1) });

/**
 * 四块结构都必须出现：模型少给一块就判结构不合法（宁可少几条推导项，也不让编造的内容进清单）。
 * 条目内部的可选字段仍然给默认值，不把校验卡在无关紧要的地方。
 */
export const UnderstandingSchema = z.object({
  profile: z.array(ProfileLineSchema),
  demands: z.array(z.string()),
  conflicts: z.array(ProfileLineSchema),
  derivedItems: z.array(DerivedItemSchema),
});

export type Impact = z.infer<typeof ImpactSchema>;
export type Understanding = z.infer<typeof UnderstandingSchema>;

export interface UnderstandingIssues {
  /** 结构不合法 */
  structure: string[];
  /** 出现字段清单之外的字段 ID */
  unknownFields: string[];
}

export type UnderstandingResult =
  | { ok: true; value: Understanding }
  | { ok: false; issues: UnderstandingIssues };

/** 解析模型返回：结构校验 + 字段 ID 白名单校验，两道红线都要过。 */
export function parseUnderstanding(raw: unknown, knownFieldIds: Set<string>): UnderstandingResult {
  const parsed = UnderstandingSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: {
        structure: parsed.error.issues.map((i) => `${i.path.join('.') || '(根)'}: ${i.message}`),
        unknownFields: [],
      },
    };
  }
  const unknownFields: string[] = [];
  parsed.data.derivedItems.forEach((item, index) => {
    item.relatedFieldIds.forEach((fieldKey) => {
      // 实例字段的写法是「实例键.字段 ID」，两边都在白名单里才算数
      const [head, tail] = fieldKey.includes('.') ? fieldKey.split('.') : [undefined, fieldKey];
      const ok = head ? knownFieldIds.has(`${head}.${tail}`) || knownFieldIds.has(fieldKey) : knownFieldIds.has(fieldKey);
      if (!ok) unknownFields.push(`derivedItems[${index}].relatedFieldIds: ${fieldKey}`);
    });
  });
  if (unknownFields.length) return { ok: false, issues: { structure: [], unknownFields } };
  return { ok: true, value: parsed.data };
}
