/**
 * 一次生成是一条完整流水线（技术方案 4.4 / 4.5）：取数 → 脱敏 → 写外发记录 → 调模型 → 校验 → 落库。
 *
 * 失败时不落半成品清单：模型两道红线没过就降级为纯规则清单，并在该需求单上标明「模型部分未生成」。
 * 这里只认 ServiceStore 与 ModelProvider 两个最小接口：真实服务传 SQLite 仓储与 DeepSeek，
 * 线上展示版传内存仓储与种子里的固定输出，跑的是同一条流水线。
 */

import { FIELD_SPEC } from '@zx/field-spec';
import { buildChecklist } from '@zx/checklist';
import type { Checklist, DerivedItem } from '@zx/checklist';
import { DEFAULT_POLICY, buildOutbound } from '@zx/redact';
import type { RedactionPolicy } from '@zx/redact';
import { parseUnderstanding } from '@zx/contracts';
import type { UnderstandingIssues } from '@zx/contracts';
import { UNDERSTAND_TASK } from './model';
import type { ModelProvider } from './model';
import { fieldKeysOf } from './fields';
import type { ServiceStore } from './types';

/** 判据与规则这一版的口径，落库便于事后还原。 */
export const RULE_VERSION = 'rules-v1';

export interface GenerateInput {
  demandSheetId: string;
  operator: string;
  at: string;
  /** 设计师逐条确认的结果；缺省用默认勾选（选项类勾选、自由文本按策略默认） */
  selected?: Record<string, boolean>;
  policy?: RedactionPolicy;
  now?: Date;
}

export interface GenerateResult {
  checklistId: string;
  checklist: Checklist;
  /** 模型部分没生成：界面要标明 */
  degraded: boolean;
  issues?: UnderstandingIssues;
  outboundRecordId: string;
}

export async function generateChecklist(
  store: ServiceStore,
  provider: ModelProvider,
  input: GenerateInput,
): Promise<GenerateResult> {
  const sheet = store.getDemandSheet(input.demandSheetId);
  if (!sheet) throw new Error(`需求单不存在：${input.demandSheetId}`);

  const policy = input.policy ?? DEFAULT_POLICY;
  const model = sheet.payload;

  // 一、脱敏：不外发的整条留下，可泛化的先降级，自由文本先替换
  const outbound = buildOutbound({
    model,
    policy,
    operator: input.operator,
    at: input.at,
    selected: input.selected,
    now: input.now,
  });

  // 二、外发留档：谁、什么时候、发了哪些字段、命中过什么、用的哪版策略
  const outboundRecordId = crypto.randomUUID();
  store.createOutboundRecord({
    id: outboundRecordId,
    demandSheetId: input.demandSheetId,
    policyName: outbound.payload.policyName,
    policyVersion: outbound.payload.policyVersion,
    fieldKeys: outbound.record.fieldKeys,
    redactions: outbound.record.redactions,
    unselectedFreeText: outbound.payload.unselectedFreeText,
    at: input.at,
    operator: input.operator,
  });

  // 三、调模型 + 校验：两道红线没过就再试一次，仍失败则降级
  const knownFieldIds = new Set<string>(FIELD_SPEC.map((f) => f.id));
  fieldKeysOf(model).forEach((k) => knownFieldIds.add(k));

  let derived: DerivedItem[] = [];
  let understanding: unknown = { profile: [], demands: [], conflicts: [], derivedItems: [] };
  let degraded = false;
  let issues: UnderstandingIssues | undefined;

  const attempt = async () => {
    const raw = await provider.understand({
      demandSheetId: input.demandSheetId,
      fields: outbound.payload.fields,
      task: UNDERSTAND_TASK,
    });
    return parseUnderstanding(raw, knownFieldIds);
  };

  try {
    let result = await attempt();
    if (!result.ok) result = await attempt();
    if (result.ok) {
      understanding = result.value;
      derived = result.value.derivedItems;
    } else {
      degraded = true;
      issues = result.issues;
    }
  } catch (error) {
    degraded = true;
    issues = { structure: [error instanceof Error ? error.message : String(error)], unknownFields: [] };
  }

  if (degraded) {
    // 模型部分没生成的原因要看得见：M3 的埋点先落在服务端日志上
    console.warn(['[清单降级]', input.demandSheetId, JSON.stringify(issues)].join(' '));
  }

  // 四、判据筛选、合并、排序全部在领域包里，服务端只做编排
  const checklist = buildChecklist({ model, derived });

  const stored = store.createChecklist({
    demandSheetId: input.demandSheetId,
    checklist,
    model: degraded ? `${provider.name}(降级)` : provider.name,
    ruleVersion: RULE_VERSION,
    policyName: policy.name,
    policyVersion: policy.version,
    degraded,
    understanding,
  });

  return { checklistId: stored.id, checklist, degraded, issues, outboundRecordId };
}
