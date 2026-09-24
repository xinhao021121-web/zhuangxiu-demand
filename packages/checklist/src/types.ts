/** 量房沟通清单的类型定义，零框架依赖。 */

import type { FormModel, SurveyItem, SurveyTier } from '@zx/field-spec';
import type { ObjectAsset } from './objects';

export type Tier = SurveyTier;

/** 清单项来源：需求推导 / 通用核实 / 两者（合并后）。 */
export type ItemSource = 'derived' | 'survey' | 'both';

/** 进入清单的三条判据（产品文档 4.3）。 */
export type Impact = 'feasibility' | 'direction' | 'cost' | 'schedule';

/**
 * 推导项：由模型从已填内容推出的、需要当面确认的点（产品文档 4.2 第三条来源）。
 *
 * 硬约束：relatedFieldIds 必须指到字段；指不到字段的内容进不了清单。
 * 字段键的写法与 field-spec 一致：固定字段是 id，实例字段是「实例键.id」。
 */
export interface DerivedItem {
  /** 核实对象：与通用清单合并去重的键之一 */
  object: string;
  question: string;
  why: string;
  /** 现场要核实的点 */
  onsiteChecks: string[];
  relatedFieldIds: string[];
  /** 满足的判据；一条都不满足的不进清单 */
  impact: Impact[];
  /** 归属分区；跨空间的问题（如猫砂盆放哪个卫生间）由模型指定，缺省按主字段所在分区推断 */
  space?: string;
}

/** 进清单之前的候选：来源还没有合并。 */
export interface Candidate {
  object: string;
  space: string;
  tier: Tier;
  question: string;
  why: string;
  onsiteChecks: string[];
  relatedFields: string[];
  source: Exclude<ItemSource, 'both'>;
}

export interface ChecklistItem {
  /** 稳定标识：核实对象 + 主要来源字段，不带分组（产品文档 4.6） */
  key: string;
  object: string;
  space: string;
  tier: Tier;
  source: ItemSource;
  question: string;
  why: string;
  onsiteChecks: string[];
  /** 关联字段键，可点回原始表格 */
  relatedFields: string[];
}

export interface ChecklistGroup {
  space: string;
  items: ChecklistItem[];
  must: number;
  suggest: number;
}

export interface ChecklistCounts {
  total: number;
  must: number;
  suggest: number;
  bySpace: Record<string, number>;
}

export interface Checklist {
  groups: ChecklistGroup[];
  items: ChecklistItem[];
  counts: ChecklistCounts;
  /** 判据筛掉的推导项：不落清单，但记下来方便回头调判据 */
  dropped: DerivedItem[];
}

/** 表格理解里的「待确认项」：空缺的推荐项 + 房主答「不清楚」的项。 */
export interface OpenQuestion {
  fieldKey: string;
  label: string;
  space: string;
  why: string;
}

export interface ChecklistInput {
  model: FormModel;
  derived: DerivedItem[];
  /** 通用清单资产，缺省用 field-spec 的 16 项 */
  survey?: SurveyItem[];
  /**
   * 归一用的额外资产对象（规则托底里的「猫砂盆位置」「儿童房空间」这类）。
   * 模型换一个名字说同一件事时要并成一条，靠的就是这份清单（badcases.md BC-05）。
   */
  objects?: readonly ObjectAsset[];
}
