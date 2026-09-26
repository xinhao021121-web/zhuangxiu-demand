/** 量房沟通清单的类型定义，零框架依赖。 */

import type { FormModel, SurveyItem, SurveyTier } from '@zx/field-spec';
import type { ObjectAsset } from './objects';

export type Tier = SurveyTier;

/** 清单项来源：需求推导 / 通用核实 / 两者（合并后）。 */
export type ItemSource = 'derived' | 'survey' | 'both';

/** 进入清单的三条判据（产品文档 4.3）。 */
export type Impact = 'feasibility' | 'direction' | 'cost' | 'schedule';

/**
 * 有推导成分的条目从哪来（产品文档 5.6）：规则托底 / 房主当面说「你来定」/ 模型推导。
 *
 * 记这一维是为了把「确定信号」与「模型判断」分开：必问的留位优先给前两类，
 * 界面上也把来源说到底（前两类是字段级的确定判断，`model` 是读懂之后推的）。
 */
export type ItemOrigin = 'rule' | 'unclear' | 'model';

/**
 * 返工代价档位（技术方案 B4）：候选超过上限时按它排序砍。
 * `0` 房主当面说「你来定」的项 / `1` 场地硬项 / `2` 这一家推出来的可行性风险 / `3` 口径项；
 * `null` = 不进必问候选（固定建议问）。
 */
export type ReworkRank = 0 | 1 | 2 | 3;

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
  /** 来源；模型的输出不带这个字段（缺省按 `model` 处理），规则托底与答「不清楚」的项各自标好 */
  origin?: ItemOrigin;
}

/** 进清单之前的候选：来源还没有合并。 */
export interface Candidate {
  object: string;
  space: string;
  /** 返工代价档位，`null` = 不进必问候选。档位在这里只算一半，另一半在合并之后统一定（judge 的 rankOf） */
  rank: ReworkRank | null;
  /** 有推导成分的来源；纯通用项是 `null` */
  origin: ItemOrigin | null;
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
  /** 有推导成分时的来源；纯通用核实项没有这个字段 */
  origin?: ItemOrigin;
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
  /**
   * 适用条件不成立的通用项怎么处理：`true`（默认）连清单都不进——「旧房管线与防水」在毛坯
   * 新房上不是这一家的核实项，留着只是噪音，而且会让「删减」这份数据变脏；
   * `false` 退回到「降为建议问、仍留在清单里当兜底」（产品文档 5.6 记了两条路的差值）。
   */
  dropInapplicable?: boolean;
}
