/** 脱敏与外发的类型定义，零框架依赖（产品文档第七章、技术方案 4.5）。 */

/** 字段级三级策略。 */
export type SendTier = 'no-send' | 'generalize' | 'raw';

/** 能识别的自由文本类型：中文人名不做自动识别，由逐条确认界面兜住。 */
export type TextKind = 'phone' | 'landline' | 'idcard' | 'email' | 'address' | 'wechat';

export type GeneralizeKind = 'city-tier' | 'age-band' | 'date-relative';

export interface GeneralizeRule {
  field: string;
  /** 界面上显示的名字，例如「所在城市」 */
  label: string;
  kind: GeneralizeKind;
}

/**
 * 外发策略：可配置的数据，不是代码常量（产品文档 7.7）。
 *
 * 能调的是字段级三级策略、泛化粒度、自由文本默认勾选状态与模型接入方式；
 * 不能调的是「必须逐条确认」「每次外发留档」「模型返回必须能溯源到字段」。
 */
export interface RedactionPolicy {
  name: string;
  version: string;
  /** 不外发：整条留下，不进入任何请求 */
  noSend: string[];
  /** 泛化后外发：本地先转成粗粒度描述 */
  generalize: GeneralizeRule[];
  freeTextDefault: 'checked' | 'unchecked';
  modelEndpoint: 'official' | 'private';
  /** 谁改的、什么时候改的：调整策略要留痕 */
  updatedBy?: string;
  updatedAt?: string;
}

export interface RedactionHit {
  kind: TextKind;
  label: string;
  index: number;
  length: number;
}

export interface RedactedText {
  text: string;
  hits: RedactionHit[];
}

export interface OutboundField {
  fieldKey: string;
  label: string;
  /** 脱敏与泛化之后的值 */
  value: string;
  tier: Exclude<SendTier, 'no-send'>;
  hits: RedactionHit[];
}

export interface OutboundPayload {
  policyName: string;
  policyVersion: string;
  fields: OutboundField[];
  /** 不外发的字段：只记键与标签用于界面提示，值不进任何请求 */
  withheld: { fieldKey: string; label: string }[];
  /** 没有勾选、因此不参与解读的自由文本条数 */
  unselectedFreeText: number;
}

/** 每次外发的留档：字段清单 + 脱敏命中位置 + 时间 + 操作人 + 当次生效的策略版本。 */
export interface OutboundRecord {
  policyName: string;
  policyVersion: string;
  fieldKeys: string[];
  redactions: { fieldKey: string; label: string; kinds: TextKind[]; count: number }[];
  unselectedFreeText: number;
  at: string;
  operator: string;
}

export interface OutboundFieldRef {
  fieldKey: string;
  label: string;
  value: string;
  tier: SendTier;
}

export interface PreviewRow {
  fieldKey: string;
  label: string;
  /** 脱敏后的值：不外发与泛化分组显示的是处理后的样子 */
  value: string;
  hits: RedactionHit[];
  selectable: boolean;
  selected: boolean;
}

export interface PreviewGroup {
  tier: 'no-send' | 'generalize' | 'free-text' | 'raw';
  title: string;
  hint: string;
  rows: PreviewRow[];
}
