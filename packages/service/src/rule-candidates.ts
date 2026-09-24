// 规则托底：把规则引擎算得出来的高信号发现，也变成清单候选（badcases.md BC-03）。
//
// 为什么要这一层：第一次真机实测里，房主填了养猫、清单三次全都没问猫砂盆位置——而采集端的
// 规则引擎（pet-cat）在房主填表时就已经命中过这条。同一个信号，确定的那一端算得出来，
// 到了量房清单反而取决于模型有没有注意到，这是不该有的赌。所以：规则命中的项直接进候选，
// 模型照旧可以出一条更贴合的——两条落在同一个「分区 + 核实对象」上会自动并成一条。
//
// 只覆盖 `rule-candidates.json` 里点名的规则，不是把 72 条规则全搬进清单：清单要的是
// 「到现场要核实的事」，收纳与偏好类的发现留在采集端给房主看。
//
// 不管「房主已经点过不感兴趣」——那一层状态只存在房主的草稿里，需求单没有把它带过来。
// 等采集端把拒绝上报（产品文档 7.2 回路 A）之后，这里再按拒绝与否过滤。
//
// 转换出来的东西和模型输出同形（DerivedItem），所以判据、合并、排序、导出都不用改一行。

import { SURVEY_CHECKLIST, UNCLEAR_CHECKLIST, findInstance, instanceName } from '@zx/field-spec';
import type { FormModel } from '@zx/field-spec';
import { evaluateRules } from '@zx/rules';
import type { DerivedItem, Impact, Tier } from '@zx/checklist';
import rows from './rule-candidates.json';

export interface RuleCandidateRow {
  ruleId: string;
  /** 触发这条规则的字段：清单项的溯源依据 */
  fieldIds: string[];
  /** 核实对象：与通用清单 / 待定项资产同名时自动并成一条 */
  object: string;
  /** 下面几项只在核实对象落不到已有资产时才写 */
  space?: string;
  tier?: Tier;
  question?: string;
  onsiteChecks?: string[];
}

export const RULE_CANDIDATE_ROWS = rows as unknown as RuleCandidateRow[];

const TIER_IMPACT: Record<Tier, Impact[]> = { must: ['feasibility'], suggest: ['cost'] };

interface Canonical {
  space: string;
  section: string;
  tier: Tier;
  question: string;
  checks: string[];
}

/** 已有资产里的核实对象：通用量房清单 + 房主答「不清楚」的待定项。 */
const CANONICAL: Map<string, Canonical> = new Map();
SURVEY_CHECKLIST.forEach((s) =>
  CANONICAL.set(s.object, { space: s.space, section: s.section, tier: s.tier, question: s.item, checks: [s.item] }),
);
UNCLEAR_CHECKLIST.forEach((u) =>
  CANONICAL.set(u.object, { space: u.space, section: u.section, tier: u.tier, question: u.item, checks: u.onsiteChecks }),
);

/** 把规则命中转成推导项；同一对象的重复命中在这里就并掉。 */
export function ruleDerivedItems(model: FormModel): DerivedItem[] {
  const byRule = new Map<string, RuleCandidateRow[]>();
  RULE_CANDIDATE_ROWS.forEach((row) => {
    byRule.set(row.ruleId, [...(byRule.get(row.ruleId) ?? []), row]);
  });

  const out: DerivedItem[] = [];
  evaluateRules(model).forEach((hit) => {
    (byRule.get(hit.ruleId) ?? []).forEach((row) => {
      const canonical = CANONICAL.get(row.object);
      const question = canonical?.question ?? row.question;
      const tier = canonical?.tier ?? row.tier;
      // 资产没写全就不生成条目；这种配置错误由单测挡住，不在运行期编一句问不出口的话
      if (!question || !tier) return;
      // 实例规则（儿童房、卫生间…）：字段键要带实例前缀，分区用实例名，
      // 否则「次卧1 的阅读区」会退化成一条不指向任何具体房间的通用项
      const inst = hit.instKey ? findInstance(model, hit.instKey) : undefined;
      out.push({
        object: row.object,
        question,
        why: hit.why,
        onsiteChecks: canonical ? [...canonical.checks] : [...(row.onsiteChecks ?? [])],
        relatedFieldIds: hit.instKey ? row.fieldIds.map((id) => `${hit.instKey}.${id}`) : [...row.fieldIds],
        impact: [...TIER_IMPACT[tier]],
        space: canonical?.space ?? (inst ? instanceName(model, inst) : row.space),
      });
    });
  });
  return out;
}
