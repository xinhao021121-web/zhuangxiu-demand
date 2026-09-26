/**
 * 判据与档位（产品文档 4.3 / 5.6、研究结论第二节）。
 *
 * 这两件事在这一版分开了：**判据可以听模型的，档位不听**。四批真机实测里条目集合稳定
 * （Jaccard 0.83–1.0），飘的全是档位——单份必问在 7–21 条之间，最大的一份跨 7 条
 * （badcases.md BC-04）。所以档位从模型手里收回到代码：模型说「为什么问」，代码判「必问还是建议问」。
 *
 * 判据仍然是「一条都说不出的不进清单」：影响成本或工期的项照旧进清单，只是进不了必问候选。
 */

import type { SurveyWhen } from '@zx/field-spec';
import type { FormModel } from '@zx/field-spec';
import type { DerivedItem, Impact, ReworkRank } from './types';

/**
 * 必问的上限（研究结论第二节）：三场访谈里设计师自己筛出来的是 5 / 8 / 5 条，取上限兜住。
 * 候选超过 8 条时按返工代价砍，砍到 8 条以内；建议问不设上限。
 */
export const MUST_LIMIT = 8;

/**
 * 返工代价的四档，数字越小越靠前。前三档就是研究结论第二节的判定顺序（前者优先），
 * 只在最前面插了一档：**房主当面说「你来定」的项**。它排第一不是为了压过场地硬项，
 * 而是因为它是唯一一类「房主自己已经把判断交出来」的项——产品文档 5.3 写明这类项
 * 「量房时必须问到」，而资产里正好有 8 条硬项会占满上限，不给它让位就永远进不了必问。
 */
export const RANK = { ownerDelegated: 0, siteHard: 1, houseRisk: 2, wording: 3 } as const;

/**
 * 一条推导项的返工代价档位；`null` = 不进必问候选。
 *
 * 推导项在这里只分得出两档（影响可行性 / 影响方向）；另外两档由调用方按来源给——
 * 场地硬项来自资产（通用清单的 must 项），「房主说你来定」来自答「不清楚」的项。
 *
 * 砍的时候按档位占位（前者优先）：场地硬项先占——现场时间不够时先保证「不会做错」的那几条；
 * 这一家的风险项排在后面，但它们在建议问里是最前面的一批（同一档位内需求推导排在通用核实之前）。
 */
export function rankOf(impact: Impact[]): ReworkRank | null {
  if (impact.includes('feasibility')) return RANK.houseRisk;
  if (impact.includes('direction')) return RANK.wording;
  return null;
}

/** 与 `sources.ts` 的「不清楚」口径同源：这类答案等于没答，判适用条件时跳过。 */
const NOT_AN_ANSWER = /不清楚|不确定|听设计师建议|还没想好|说不好/;

/**
 * 通用项的适用条件成不成立（研究结论第二节：老房给老房的、新房给新房的）。
 *
 * 只有「房主明确说了别的值」才判不成立——没填、答「不清楚」、字段是空数组，一律按成立处理。
 * 这条保守方向与 5.5 的「宁可多一条让设计师删」一致：一个没答的字段不该把要问的事丢掉。
 *
 * 不成立的项**不是从清单里删掉**，而是降为建议问——通用清单是「量房那天兜底的那张表」，
 * 宁可让设计师看一眼再划掉，也不在这里替他决定这件事不重要。
 */
export function whenHolds(model: FormModel, when?: SurveyWhen): boolean {
  if (!when) return true;
  const value = model.values[when.field];
  const stated = (Array.isArray(value) ? value : [value])
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((v) => v && !NOT_AN_ANSWER.test(v));
  if (!stated.length) return true;
  return stated.some((v) => when.anyOf.includes(v));
}

export interface Classified {
  accepted: { item: DerivedItem; rank: ReworkRank | null }[];
  /** 被筛掉的推导项：判据不成立，或指不到字段（硬约束：指不到字段的不出现） */
  dropped: DerivedItem[];
}

export function classifyDerived(derived: DerivedItem[]): Classified {
  const accepted: Classified['accepted'] = [];
  const dropped: DerivedItem[] = [];
  derived.forEach((item) => {
    const impact = item.impact ?? [];
    // 判据一条都说不出、或指不到字段的：不进清单
    if (!impact.length || !item.relatedFieldIds?.length) {
      dropped.push(item);
      return;
    }
    accepted.push({ item, rank: rankOf(impact) });
  });
  return { accepted, dropped };
}
