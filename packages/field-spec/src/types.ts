/** 字段规格与表单模型的类型定义，零框架依赖。 */

export type FieldType = '单选' | '多选' | '文本' | '数字' | '日期' | '长文本';

/** 填写建议：推荐填写 / 实例必选 / 选填，没有任何必填项。 */
export type SuggestLevel = '推荐填写' | '实例必选' | '选填';

/** 空间类型：固定分区，或按实例增删的空间分区。 */
export type FieldScope = '固定' | '次卧' | '书房' | '卫生间';

export interface FieldSpec {
  id: string;
  section: string;
  group: string;
  label: string;
  type: FieldType;
  unit: string;
  options: string[];
  suggest: SuggestLevel;
  scope: FieldScope;
  /** 适用房型；'全部' 表示所有房型都要问 */
  applies: string;
}

/** 清单档位：必问 = 影响可行性或方向；建议问 = 影响成本或工期。 */
export type SurveyTier = 'must' | 'suggest';

/**
 * 量房确认清单的一项（field-spec 的静态资产，16 项）。
 *
 * relatedFields / object / space / section 是给解读台用的机器可读映射：
 * 合并去重按「space + object」，触发判断与分区归属按 relatedFields，
 * 换 postgres 或换前端都不改这份资产。
 */
export interface SurveyItem {
  no: number;
  item: string;
  goal: string;
  /** 人读的来源备注，保留原样 */
  source: string;
  /** 机器可读的来源字段 ID；空数组表示结构类，业主无法判断 */
  relatedFields: string[];
  /** 核实对象：与推导项合并去重的键之一 */
  object: string;
  /** 归属分区：带实例的分区写具体实例名 */
  space: string;
  /** 分区名：space 对应的实例在当前需求单里不存在时，退回到这一组 */
  section: string;
  tier: SurveyTier;
}

export interface FieldGroup {
  name: string;
  fields: FieldSpec[];
}

export interface SectionSpec {
  name: string;
  /** '固定' 只出现一次；其余按实例增删 */
  scope: '固定' | '实例';
  groups: FieldGroup[];
  fields: FieldSpec[];
}

export interface InstanceDef {
  max: number;
  defaults: string[];
  /** 决定显示哪些字段的房型字段，null 表示不区分 */
  typeField: string | null;
  namePrefix: string;
  /** 该空间实例的其他补充字段 */
  other: string;
}

export type FieldValue = string | number | string[] | undefined;

export interface InstanceState {
  key: string;
  section: string;
  values: Record<string, FieldValue>;
}

/** 表单状态：固定字段值 + 各空间实例。整棵树可序列化。 */
export interface FormModel {
  values: Record<string, FieldValue>;
  instances: Record<string, InstanceState[]>;
}
