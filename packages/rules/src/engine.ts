/**
 * 发现引擎：输入表单快照，输出发现项数组。纯函数，不读全局状态、不产生副作用。
 *
 * 执行时保证四件事：同一条发现会话内只出现一次、风险提醒被「保持需求」后不再出现、
 * 按 P0 → P1 → P2 排序（风险提醒优先）、连续 3 次不感兴趣进入静默。
 */

import { INSTANCE_DEF, RECOMMENDED_FIELDS, isEmptyValue } from '@zx/field-spec';
import type { FormModel } from '@zx/field-spec';
import { createContext } from './context';
import { RULES, ruleMeta } from './rules';
import { handledCount } from './state';
import type { AssistantState, Priority, RuleMeta, Suggestion, SuggestionKind } from './types';

const PRIORITY_ORDER: Record<Priority, number> = { P0: 0, P1: 1, P2: 2 };
const KIND_ORDER: Record<SuggestionKind, number> = { risk: 0, discover: 1, fill: 2 };

/** 规则元信息：可序列化，后续可被云端配置覆盖，命中判断仍在客户端执行。 */
export const RULE_META: RuleMeta[] = RULES.map(ruleMeta);

/** 补全兜底最多同时提示的固定推荐项条数，避免把助手变成缺项清单。 */
const MAX_FILL_SUGGESTIONS = 2;

export function evaluateRules(model: FormModel): Suggestion[] {
  const ctx = createContext(model);
  const out: Suggestion[] = [];
  RULES.forEach((rule) => {
    let hits: ReturnType<typeof rule.run> = [];
    try {
      hits = rule.run(ctx) ?? [];
    } catch {
      hits = [];
    }
    hits.forEach((h) => {
      const instKey = h.instKey;
      out.push({
        id: `${rule.id}#${instKey ?? '-'}`,
        ruleId: rule.id,
        p: rule.p,
        kind: rule.kind ?? 'discover',
        section: rule.section,
        instKey,
        target: h.target ?? rule.target,
        action: rule.action ?? 'append',
        value: h.value ?? rule.value,
        title: h.title,
        text: h.text,
        why: h.why,
        trigger: rule.trigger,
      });
    });
  });
  return out;
}

/** 补全：推荐填写项与实例房型未填时兜底提示。 */
export function fillSuggestions(model: FormModel): Suggestion[] {
  const out: Suggestion[] = [];
  RECOMMENDED_FIELDS.filter((f) => f.scope === '固定' && isEmptyValue(model.values[f.id]))
    .slice(0, MAX_FILL_SUGGESTIONS)
    .forEach((f) => {
      out.push({
        id: `fill#${f.id}`,
        ruleId: `fill#${f.id}`,
        p: 'P1',
        kind: 'fill',
        section: f.section,
        target: f.id,
        action: 'append',
        title: `还差一项关键信息：${f.label}`,
        text: '这项直接影响助手给建议的准确度，勾选一下就行。',
        why: '推荐填写项未完成',
        trigger: '推荐填写项为空',
      });
    });
  Object.entries(INSTANCE_DEF).forEach(([section, def]) => {
    if (!def.typeField) return;
    (model.instances[section] ?? []).forEach((inst, i) => {
      if (!isEmptyValue(inst.values[def.typeField!])) return;
      out.push({
        id: `type#${inst.key}`,
        ruleId: `type#${inst.key}`,
        p: 'P1',
        kind: 'fill',
        section,
        instKey: inst.key,
        target: def.typeField!,
        action: 'append',
        title: `${def.namePrefix}${i + 1} 还没选用途`,
        text: '选完用途后，这里只显示相关的需求项，不用填无关内容。',
        why: '房间用途会影响需要了解的内容',
        trigger: '实例房型未选',
      });
    });
  });
  return out;
}

export function sortSuggestions(list: Suggestion[]): Suggestion[] {
  return list
    .map((s, i) => ({ s, i }))
    .sort(
      (a, b) =>
        PRIORITY_ORDER[a.s.p] - PRIORITY_ORDER[b.s.p] ||
        KIND_ORDER[a.s.kind] - KIND_ORDER[b.s.kind] ||
        a.i - b.i,
    )
    .map((x) => x.s);
}

function dedupe(list: Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  return list.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

/** 全部发现：补全兜底 + 规则命中，按优先级排序并去重。 */
export function suggestionsOf(model: FormModel): Suggestion[] {
  return sortSuggestions(dedupe([...fillSuggestions(model), ...evaluateRules(model)]));
}

/** 待处理发现：同一条发现会话内只出现一次，忽略或采纳后不再回到列表。 */
export function openSuggestions(model: FormModel, state: AssistantState): Suggestion[] {
  return suggestionsOf(model).filter((s) => !state.handled[s.id]);
}

export function suggestionStats(model: FormModel, state: AssistantState) {
  const all = suggestionsOf(model);
  const open = openSuggestions(model, state);
  const adopted = Object.values(state.handled).filter((h) => h.status === 'adopted').length;
  return { found: all.length, open: open.length, handled: handledCount(state), adopted };
}
