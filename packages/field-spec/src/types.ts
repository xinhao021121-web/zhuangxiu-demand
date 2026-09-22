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

export interface SurveyItem {
  no: number;
  item: string;
  goal: string;
  source: string;
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
