/**
 * 合并、排序与计数（产品文档 4.4 / 4.5）。
 *
 * 合并键是「归属空间 + 核实对象」，不用文字相似度：两条落在同一个键上就并成一条，
 * 问题用推导项（它带着这份需求单的具体依据），现场要核实取并集，来源标为两者；
 * 匹配不上就并列两条，宁可多一条让设计师删，也不要错合并掉一条真实问题。
 *
 * 档位与条数在合并之后统一定（judge 的 `MUST_LIMIT` / `RANK`）：候选先按返工代价排，
 * 前 8 条是必问，其余是建议问。同一个核实对象被两种来源说中时取更靠前的那一档。
 */

import { SURVEY_CHECKLIST } from '@zx/field-spec';
import type { SurveyItem } from '@zx/field-spec';
import { MUST_LIMIT, MUST_OWN_MIN } from './judge';
import { derivedCandidates, surveyCandidates, unclearCandidates } from './sources';
import { spaceOrder } from './space';
import type { Candidate, Checklist, ChecklistInput, ChecklistItem, ItemSource, ReworkRank, Tier } from './types';

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

  const { candidates: derivedList, dropped } = derivedCandidates(derived, model, survey, input.objects);
  const unclearList = unclearCandidates(model, survey);
  const surveyList = surveyCandidates(model, survey, input.dropInapplicable);

  /** 合并期间的条目：`tier` 还没定（合并完按返工代价统一判），档位另存一张表。 */
  type DraftItem = Omit<ChecklistItem, 'tier'>;
  const bySpaceObject = new Map<string, DraftItem>();
  const drafts: DraftItem[] = [];
  const rankByKey = new Map<string, ReworkRank | null>();

  /** 同一个键被多个来源说中：取更靠前的那一档（`null` 最靠后）。 */
  const betterRank = (a: ReworkRank | null, b: ReworkRank | null): ReworkRank | null =>
    a === null ? b : b === null ? a : (Math.min(a, b) as ReworkRank);

  const absorb = (c: Candidate) => {
    const found = bySpaceObject.get(`${c.space}|${c.object}`);
    if (!found) {
      const item: DraftItem = {
        key: `${c.object}#${primaryFieldOf(c.object, c.relatedFields, canonical)}`,
        object: c.object,
        space: c.space,
        source: c.source,
        question: c.question,
        why: c.why,
        onsiteChecks: [...c.onsiteChecks],
        relatedFields: [...c.relatedFields],
      };
      bySpaceObject.set(`${c.space}|${c.object}`, item);
      drafts.push(item);
      rankByKey.set(item.key, c.rank);
      return;
    }
    found.onsiteChecks = union(found.onsiteChecks, c.onsiteChecks);
    found.relatedFields = union(found.relatedFields, c.relatedFields);
    rankByKey.set(found.key, betterRank(rankByKey.get(found.key) ?? null, c.rank));
    if (found.source === c.source) return;
    if (c.source === 'derived') {
      // 推导项带着这份需求单的具体依据，问题用它的
      found.question = c.question;
      found.why = c.why;
    }
    found.source = 'both';
  };

  /*
   * 吸收顺序有讲究：推导项 → 答「不清楚」的项 → 通用项。
   * 合并时「先到的那条留住自己的问题」，所以模型已经说过的对象，房主那句「你来定」只补进
   * 「为什么问」与关联字段，不会把模型的针对性问题冲掉；而通用项总是最后到场，已经被房主或
   * 模型说过的对象就以它俩为准。档位不看先后——合并完统一按返工代价判。
   */
  derivedList.forEach(absorb);
  unclearList.forEach(absorb);
  surveyList.forEach(absorb);

  const order = spaceOrder(model);
  const spaceIndex = new Map(order.map((space, index) => [space, index]));

  /*
   * 档位：候选按返工代价排，前 8 条是必问（B4）。同档内按分区顺序 → 来源 → 问题文本排，
   * 全是不看模型输出顺序的确定键，所以同一份需求单每次生成的必问集合一致。
   */
  const ranked = drafts
    .filter((d) => rankByKey.get(d.key) !== null)
    .sort(
      (a, b) =>
        rankByKey.get(a.key)! - rankByKey.get(b.key)! ||
        (spaceIndex.get(a.space) ?? order.length) - (spaceIndex.get(b.space) ?? order.length) ||
        SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
        a.question.localeCompare(b.question, 'zh'),
    );

  /*
   * 这一家的项要占的位置（MUST_OWN_MIN）：没有通用清单兜底的那些只靠抢名额会被挤掉，
   * 所以候选不够时，把排在后面的这一家的项换进来，替掉排在最末的通用项。
   */
  const own = (d: DraftItem) => d.source === 'derived';
  const picked = ranked.slice(0, MUST_LIMIT);
  for (const candidate of ranked.slice(MUST_LIMIT)) {
    if (picked.filter(own).length >= MUST_OWN_MIN) break;
    if (!own(candidate)) continue;
    const victim = [...picked].reverse().find((d) => !own(d));
    if (!victim) break;
    picked.splice(picked.indexOf(victim), 1);
    picked.push(candidate);
  }

  const mustKeys = new Set(picked.map((d) => d.key));
  const items: ChecklistItem[] = drafts.map((d) => ({
    ...d,
    tier: mustKeys.has(d.key) ? 'must' : 'suggest',
  }));

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
