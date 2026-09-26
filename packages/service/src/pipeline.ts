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
import type { UnderstandingIssues, UnderstandingResult } from '@zx/contracts';
import { UNDERSTAND_TASK } from './model';
import type { ModelProvider } from './model';
import { fieldKeysOf } from './fields';
import { ruleDerivedItems, ruleObjectAssets } from './rule-candidates';
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

/** 降级的原因就这三类，它们在真机上都出现过（badcases.md BC-04 / BC-07）。 */
export type FailureReason = 'transport' | 'unknown_fields' | 'structure';

export interface GenerationFailure {
  reason: FailureReason;
  /** 越界字段的条数，`reason` 是 unknown_fields 时有意义 */
  unknownFields: number;
  /** 第一条原因，截断后落库；报表只看 reason，这一条留给人查问题 */
  detail: string;
}

const FAILURE_DETAIL_LIMIT = 200;

/**
 * 把降级原因收敛成一个稳定的名字（技术方案 6.11 的 `checklist_error`）。
 *
 * 顺序就是优先级：调用没拿到东西排最前——它说明问题在网络、限流或服务上，与「模型给了内容
 * 但不合规」不是一回事，重试能不能救也不一样。
 */
export function describeFailure(issues: UnderstandingIssues): GenerationFailure {
  const transport = issues.transport ?? [];
  let reason: FailureReason = 'structure';
  let messages = issues.structure;
  if (transport.length) {
    reason = 'transport';
    messages = transport;
  } else if (issues.unknownFields.length) {
    reason = 'unknown_fields';
    messages = issues.unknownFields;
  }
  return {
    reason,
    unknownFields: issues.unknownFields.length,
    detail: (messages[0] ?? '').slice(0, FAILURE_DETAIL_LIMIT),
  };
}

export async function generateChecklist(
  store: ServiceStore,
  provider: ModelProvider,
  input: GenerateInput,
): Promise<GenerateResult> {
  const sheet = await store.getDemandSheet(input.demandSheetId);
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
  await store.createOutboundRecord({
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

  /*
   * 一次调用算「没成」的三种情况：结构不合法、越界字段、传输类失败（超时 / 非 JSON / HTTP 失败）。
   * 前两种本来就重试；第三种原来是抛错直接降级，与「失败重试一次」的表述不一致——
   * 真机实测里那次「不是 JSON」如果重试一次，很可能就不用退到纯规则清单（badcases.md BC-07）。
   * 所以统一：任何没成都重试一次，仍没成才降级。
   */
  const attempt = async (): Promise<UnderstandingResult> => {
    try {
      const raw = await provider.understand({
        demandSheetId: input.demandSheetId,
        fields: outbound.payload.fields,
        task: UNDERSTAND_TASK,
      });
      return parseUnderstanding(raw, knownFieldIds);
    } catch (error) {
      return {
        ok: false,
        issues: {
          structure: [],
          unknownFields: [],
          transport: [error instanceof Error ? error.message : String(error)],
        },
      };
    }
  };

  let result = await attempt();
  if (!result.ok) result = await attempt();
  if (result.ok) {
    understanding = result.value;
    derived = result.value.derivedItems;
  } else {
    degraded = true;
    issues = result.issues;
  }

  if (degraded) {
    // 模型部分没生成的原因要看得见：M3 的埋点先落在服务端日志上
    console.warn(['[清单降级]', input.demandSheetId, JSON.stringify(issues)].join(' '));
  }

  // 四、判据筛选、合并、排序全部在领域包里，服务端只做编排。
  // 推导项有两路来源：模型出的在前（它带着这份需求单的具体依据），规则托底的在后
  // （规则算得出来的信号不该赌模型会不会注意到，见 badcases.md BC-03）。
  const ruleItems = ruleDerivedItems(model);
  const checklist = buildChecklist({
    model,
    derived: [...derived, ...ruleItems],
    // 规则资产的标准对象名一并交给清单包：模型换个名字说同一件事时能并成一条（BC-05）
    objects: ruleObjectAssets(ruleItems),
  });

  const stored = await store.createChecklist({
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
