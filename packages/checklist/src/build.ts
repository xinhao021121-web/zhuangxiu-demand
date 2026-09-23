/**
 * 合并、排序与计数（产品文档 4.4 / 4.5）。
 *
 * 合并键是「归属空间 + 核实对象」，不用文字相似度：两条落在同一个键上就并成一条，
 * 问题用推导项（它带着这份需求单的具体依据），现场要核实取并集，来源标为两者；
 * 匹配不上就并列两条，宁可多一条让设计师删，也不要错合并掉一条真实问题。
 */

import { SURVEY_CHECKLIST } from '@zx/field-spec';
import type { SurveyItem } from '@zx/field-spec';
import { derivedCandidates, surveyCandidates } from './sources';
import { spaceOrder } from './space';
import type { Candidate, Checklist, ChecklistInput, ChecklistItem, ItemSource, Tier } from './types';

const TIER_RANK: Record<Tier, number> = { must: 0, suggest: 1 };
/** 同一组内「需求推导」排在「通用核实」前面：先看到针对这家的、非模板的问题。 */
const SOURCE_RANK: Record<ItemSource, number> = { derived: 0, both: 1, survey: 2 };

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

/**
 * 稳定标识：核实对象 + 主要来源字段，不带分组（产品文档 4.6）。
 *
 * 主字段优先取通用清单资产里同一核实对象声明的第一个字段：资产是确定的，
 * 这样换模型、重新生成清单都不会让现场记录失联；资产里没有的对象才用推导项的首个字段。
 */
function primaryFieldOf(object: string, relatedFields: string[], canonical: Map<string, string>): string {
  return canonical.get(object) ?? relatedFields[0] ?? 'survey';
}

export function buildChecklist(input: ChecklistInput): Checklist {
  const { model, derived } = input;
  const survey: SurveyItem[] = input.survey ?? SURVEY_CHECKLIST;
  const canonical = new Map(survey.map((s) => [s.object, s.relatedFields[0] ?? 'survey']));

  const { candidates: derivedList, dropped } = derivedCandidates(derived, model, survey);
  const surveyList = surveyCandidates(model, survey);

  const bySpaceObject = new Map<string, ChecklistItem>();
  const items: ChecklistItem[] = [];

  const absorb = (c: Candidate) => {
    const found = bySpaceObject.get(`${c.space}|${c.object}`);
    if (!found) {
      const item: ChecklistItem = {
        key: `${c.object}#${primaryFieldOf(c.object, c.relatedFields, canonical)}`,
        object: c.object,
        space: c.space,
        tier: c.tier,
        source: c.source,
        question: c.question,
        why: c.why,
        onsiteChecks: [...c.onsiteChecks],
        relatedFields: [...c.relatedFields],
      };
      bySpaceObject.set(`${c.space}|${c.object}`, item);
      items.push(item);
      return;
    }
    found.onsiteChecks = union(found.onsiteChecks, c.onsiteChecks);
    found.relatedFields = union(found.relatedFields, c.relatedFields);
    if (found.source === c.source) return;
    if (c.source === 'derived') {
      // 推导项带着这份需求单的具体依据，问题与档位用它的
      found.question = c.question;
      found.why = c.why;
      found.tier = c.tier;
    }
    found.source = 'both';
  };

  derivedList.forEach(absorb);
  surveyList.forEach(absorb);

  const order = spaceOrder(model);
  const groups = order
    .map((space) => {
      const list = items
        .filter((i) => i.space === space)
        .sort(
          (a, b) =>
            TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
            SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
            a.question.localeCompare(b.question, 'zh'),
        );
      return {
        space,
        items: list,
        must: list.filter((i) => i.tier === 'must').length,
        suggest: list.filter((i) => i.tier === 'suggest').length,
      };
    })
    .filter((g) => g.items.length > 0);

  const bySpace: Record<string, number> = {};
  groups.forEach((g) => {
    bySpace[g.space] = g.items.length;
  });

  return {
    groups,
    items: groups.flatMap((g) => g.items),
    counts: {
      total: items.length,
      must: items.filter((i) => i.tier === 'must').length,
      suggest: items.filter((i) => i.tier === 'suggest').length,
      bySpace,
    },
    dropped,
  };
}
