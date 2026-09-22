/** 发现项、规则与助手状态机的类型定义。 */

import type { FieldValue, FormModel, InstanceState } from '@zx/field-spec';

export type Priority = 'P0' | 'P1' | 'P2';

/** 三类发现：需求发现、风险提醒、信息补充（兜底）。 */
export type SuggestionKind = 'discover' | 'risk' | 'fill';

/** 写入动作只允许追加或替换。 */
export type WriteAction = 'append' | 'replace';

export interface RuleHit {
  /** 空间实例规则：命中哪个实例 */
  instKey?: string;
  /** 覆盖规则默认的目标字段 */
  target?: string;
  /** 单选 / 多选的目标取值 */
  value?: string;
  title: string;
  text: string;
  why: string;
}

export interface Rule {
  id: string;
  p: Priority;
  kind?: SuggestionKind;
  /** 建议所属大类，写回「其他补充」时使用 */
  section: string;
  /** 目标字段：卡片上的「→ 目标字段」，也是点击定位到的位置 */
  target: string;
  action?: WriteAction;
  value?: string;
  /** 触发条件说明（可序列化的元信息） */
  trigger: string;
  run: (ctx: RuleContext) => RuleHit[];
}

export interface RuleMeta {
  id: string;
  p: Priority;
  kind: SuggestionKind;
  section: string;
  target: string;
  action: WriteAction;
  trigger: string;
}

export interface Suggestion {
  id: string;
  ruleId: string;
  p: Priority;
  kind: SuggestionKind;
  section: string;
  instKey?: string;
  target: string;
  action: WriteAction;
  value?: string;
  title: string;
  text: string;
  why: string;
  trigger: string;
}

/** 规则谓词的输入：只读的表单快照。 */
export interface RuleContext {
  values: Record<string, FieldValue>;
  /** 某个空间分区的全部实例 */
  inst: (section: string) => InstanceState[];
  /** 实例显示名：主卫 / 次卧1 · 儿童房 */
  name: (inst: InstanceState) => string;
  /** 实例房型 */
  type: (inst: InstanceState) => string;
  model: FormModel;
}

export type SuggestionStatus = 'new' | 'adopted' | 'ignored' | 'kept';

export interface HandledEntry {
  status: Exclude<SuggestionStatus, 'new'>;
  text?: string;
}

/** 助手会话状态：处理记录 + 静默。 */
export interface AssistantState {
  handled: Record<string, HandledEntry>;
  /** 连续「不感兴趣」次数，采纳或保持需求后归零 */
  dismissStreak: number;
  quiet: boolean;
}
