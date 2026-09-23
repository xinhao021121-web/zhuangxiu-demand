/**
 * 四类来源（产品文档 4.2）。
 *
 * 空缺的推荐项与答「不清楚」的项由规则算出来，是表格理解里「待确认项」的来源；
 * 从已填内容推导的问题由模型给出；16 项通用量房清单是现成资产。
 */

import {
  RECOMMENDED_FIELDS,
  SURVEY_CHECKLIST,
  fieldKey,
  fieldOf,
  instanceName,
  isEmptyValue,
  sectionOf,
  splitKey,
  visibleFields,
} from '@zx/field-spec';
import type { FieldValue, FormModel, SurveyItem } from '@zx/field-spec';
import { classifyDerived } from './judge';
import { baseSpaceOf, resolveSpace, spaceOfFieldKey } from './space';
import type { Candidate, DerivedItem, OpenQuestion } from './types';

/** 「不清楚 / 听设计师建议」这类选项：房主明说「我不确定，你来定」。 */
export const UNCLEAR = /不清楚|不确定|听设计师建议|还没想好|说不好/;

export function show(v: FieldValue): string {
  if (Array.isArray(v)) return v.join('、');
  if (v === undefined || v === null || v === '') return '';
  return String(v);
}

/** 推荐填写项里没填的：9 项推荐项是需求清晰度的分母。 */
export function missingRecommended(model: FormModel): OpenQuestion[] {
  const out: OpenQuestion[] = [];
  RECOMMENDED_FIELDS.forEach((f) => {
    if (f.scope === '固定') {
      if (isEmptyValue(model.values[f.id])) {
        out.push({ fieldKey: f.id, label: f.label, space: baseSpaceOf(f.section), why: '推荐填写项未填' });
      }
      return;
    }
    (model.instances[f.section] ?? []).forEach((inst) => {
      if (isEmptyValue(inst.values[f.id])) {
        out.push({
          fieldKey: fieldKey(inst.key, f.id),
          label: `${f.label}（${instanceName(model, inst)}）`,
          space: instanceName(model, inst),
          why: '推荐填写项未填',
        });
      }
    });
  });
  return out;
}

/** 房主答「不清楚」的项：等于房主明说「你来定」，是量房时最该聊的。 */
export function unclearAnswers(model: FormModel): OpenQuestion[] {
  const out: OpenQuestion[] = [];
  const push = (key: string, label: string, space: string, v: FieldValue) => {
    out.push({
      fieldKey: key,
      label,
      space,
      why: `房主选了「${show(v)}」，等于把判断交给设计师`,
    });
  };
  Object.entries(model.values).forEach(([id, v]) => {
    const f = fieldOf(id);
    if (!f || isEmptyValue(v) || !UNCLEAR.test(show(v))) return;
    push(id, f.label, baseSpaceOf(f.section), v);
  });
  Object.entries(model.instances).forEach(([section, list]) => {
    list.forEach((inst) => {
      visibleFields(section, inst).forEach((f) => {
        const v = inst.values[f.id];
        if (isEmptyValue(v) || !UNCLEAR.test(show(v))) return;
        push(fieldKey(inst.key, f.id), `${f.label}（${instanceName(model, inst)}）`, instanceName(model, inst), v);
      });
    });
  });
  return out;
}

/** 表格理解第四块：待确认项 = 空缺的推荐项 + 答「不清楚」的项。 */
export function openQuestions(model: FormModel): OpenQuestion[] {
  return [...missingRecommended(model), ...unclearAnswers(model)];
}

/** 从已填内容推导的问题：模型输出，先过判据，再过硬约束（指不到字段的不出现）。 */
export function derivedCandidates(
  derived: DerivedItem[],
  model: FormModel,
): { candidates: Candidate[]; dropped: DerivedItem[] } {
  const { accepted, dropped } = classifyDerived(derived);
  const candidates = accepted.map(({ item, tier }) => {
    const [, primaryId] = splitKey(item.relatedFieldIds[0]!);
    return {
      object: item.object,
      space: item.space
        ? resolveSpace(model, item.space, sectionOf(primaryId))
        : spaceOfFieldKey(model, item.relatedFieldIds[0]!),
      tier,
      question: item.question,
      why: item.why,
      onsiteChecks: [...item.onsiteChecks],
      relatedFields: [...item.relatedFieldIds],
      source: 'derived' as const,
    };
  });
  return { candidates, dropped };
}

/** 16 项通用量房确认清单：现成资产，按它声明的分区与档位进清单。 */
export function surveyCandidates(model: FormModel, survey: SurveyItem[] = SURVEY_CHECKLIST): Candidate[] {
  return survey.map((s) => ({
    object: s.object,
    space: resolveSpace(model, s.space, s.section),
    tier: s.tier,
    question: s.item,
    why: `通用量房核实项：${s.goal}`,
    onsiteChecks: [s.item],
    relatedFields: [...s.relatedFields],
    source: 'survey' as const,
  }));
}
