import { describe, expect, it } from 'vitest';
import { FIELD_BY_ID, FIELD_SPEC, addInstance, createModel, fieldOf, getValue, setValue } from '@zx/field-spec';
import type { FieldValue, FormModel } from '@zx/field-spec';
import {
  QUIET_THRESHOLD,
  RULE_META,
  applySuggestion,
  createAssistantState,
  evaluateRules,
  handleSuggestion,
  needsConfirm,
  openSuggestions,
  suggestionStats,
  suggestionsOf,
} from '@zx/rules';
import type { AssistantState } from '@zx/rules';

/** 示例场景：89㎡ 旧房翻新、三口之家养猫、开放式厨房、两个卫生间。 */
function demoModel(): FormModel {
  let model = createModel();
  const seed: Record<string, FieldValue> = {
    base_house_state: '旧房翻新',
    base_area: 89,
    live_members: ['夫妻', '儿子'],
    live_pet: ['猫'],
    live_elder: '是',
    budget_total: '20-30万',
    date_finish: '2026-10',
    date_movein: '2026-12',
    kt_freq: '经常',
    kt_form: '开放式',
    kt_height_m: 175,
    bl_dryer: '是',
    ex_boots: 2,
    sc_luggage: 2,
    clean_tools: ['扫地机器人'],
  };
  Object.entries(seed).forEach(([id, v]) => {
    model = setValue(model, id, v);
  });
  model = setValue(model, 'i1.wc_bath', '浴缸加淋浴');
  model = setValue(model, 'i1.wc_toilet', '智能马桶');
  model = setValue(model, 'i2.wc_bath', '淋浴');
  model = addInstance(model, '其他卧室');
  model = setValue(model, `${model.instances['其他卧室'][0].key}.room_type`, '儿童房');
  return model;
}

/** 逐个字段、逐个选项地试值，用于动态校验规则的字段与取值合法性。 */
function variants(): FormModel[] {
  let base = createModel();
  base = addInstance(base, '其他卧室');
  base = addInstance(base, '书房与电竞房');
  const out: FormModel[] = [];
  FIELD_SPEC.forEach((f) => {
    const picks: FieldValue[] = f.type === '单选'
      ? f.options
      : f.type === '多选'
        ? f.options.map((o) => [o])
        : f.type === '数字'
          ? [2]
          : f.type === '日期'
            ? ['2026-10']
            : ['示例文本'];
    picks.forEach((v) => {
      if (f.scope === '固定') {
        out.push(setValue(base, f.id, v));
        return;
      }
      (base.instances[f.section] ?? []).forEach((inst) => out.push(setValue(base, `${inst.key}.${f.id}`, v)));
    });
  });
  return out;
}

describe('规则表', () => {
  it('13 个大类每类 3-8 条，总量 60 条上下', () => {
    const bySection = new Map<string, number>();
    RULE_META.forEach((m) => bySection.set(m.section, (bySection.get(m.section) ?? 0) + 1));
    expect(bySection.size).toBe(13);
    [...bySection.entries()].forEach(([section, n]) => {
      expect(n, section).toBeGreaterThanOrEqual(3);
      expect(n, section).toBeLessThanOrEqual(8);
    });
    expect(RULE_META.length).toBeGreaterThanOrEqual(60);
  });

  it('规则引用的目标字段都存在于字段清单，防止规则与字段清单漂移', () => {
    expect(RULE_META.filter((m) => !FIELD_BY_ID.has(m.target)).map((m) => `${m.id}→${m.target}`)).toEqual([]);
  });

  it('任意取值下命中的目标字段存在、目标值在选项内', () => {
    const problems: string[] = [];
    const fired = new Set<string>();
    variants().forEach((model) => {
      evaluateRules(model).forEach((s) => {
        fired.add(s.ruleId);
        const field = fieldOf(s.target);
        if (!field) problems.push(`${s.ruleId}→${s.target} 不存在`);
        else if (s.value && (field.type === '单选' || field.type === '多选') && !field.options.includes(s.value)) {
          problems.push(`${s.ruleId}→${s.value} 不在 ${s.target} 的选项内`);
        }
      });
    });
    expect(problems).toEqual([]);
    expect(fired.size).toBeGreaterThanOrEqual(20);
  });

  it('每条发现都必须带依据文案', () => {
    suggestionsOf(demoModel()).forEach((s) => expect(s.why.length).toBeGreaterThan(0));
  });

  it('计划时间的依据文案跟实际填的对上，不替条件说话', () => {
    const whyOf = (values: Record<string, FieldValue>) => {
      let model = createModel();
      Object.entries(values).forEach(([id, v]) => {
        model = setValue(model, id, v);
      });
      return evaluateRules(model).find((s) => s.ruleId === 'schedule-conflict')!.why;
    };
    // 条件允许只填一个（填完工或填入住都算），文案就必须跟着变
    expect(whyOf({ date_movein: '2026-12' })).toContain('计划入住时间');
    expect(whyOf({ date_movein: '2026-12' })).not.toContain('两个');
    expect(whyOf({ date_finish: '2026-10' })).toContain('计划完工时间');
    expect(whyOf({ date_finish: '2026-10', date_movein: '2026-12' })).toContain('两个时间');
    // 一个都没填就不该出现
    expect(evaluateRules(createModel()).some((s) => s.ruleId === 'schedule-conflict')).toBe(false);
  });
});

describe('发现引擎', () => {
  it('按条件命中，并按实例分别计算', () => {
    const ids = evaluateRules(demoModel()).map((s) => s.id);
    expect(ids).toContain('pet-cat#-');
    expect(ids).toContain('open-kitchen-risk#-');
    expect(ids).toContain('balcony-dryer#-');
    expect(ids).toContain('bath-tub#i1');
    expect(ids).toContain('bath-smart-toilet#i1');
    expect(ids).not.toContain('bath-tub#i2');
  });

  it('不满足条件就不出现', () => {
    let model = createModel();
    model = setValue(model, 'kt_freq', '偶尔');
    model = setValue(model, 'kt_form', '封闭式');
    expect(evaluateRules(model).some((s) => s.ruleId === 'pet-cat')).toBe(false);
    expect(evaluateRules(model).some((s) => s.ruleId === 'open-kitchen-risk')).toBe(false);
  });

  it('按 P0 → P1 → P2 排序，风险提醒优先', () => {
    const list = suggestionsOf(demoModel());
    const ranks = list.map((s) => ({ P0: 0, P1: 1, P2: 2 })[s.p]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(list[0].p).toBe('P0');
    expect(list[0].kind).toBe('risk');
  });

  it('同一发现会话内只出现一次，处理后不再回到待处理列表', () => {
    const model = demoModel();
    const all = suggestionsOf(model);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    const target = all[0].id;
    let state: AssistantState = createAssistantState();
    expect(openSuggestions(model, state).some((s) => s.id === target)).toBe(true);
    state = handleSuggestion(state, target, 'ignored');
    expect(openSuggestions(model, state).some((s) => s.id === target)).toBe(false);
    expect(suggestionStats(model, state).handled).toBe(1);
  });

  it('风险提醒被「保持需求」后不再出现', () => {
    const model = demoModel();
    const risk = suggestionsOf(model).find((s) => s.kind === 'risk')!;
    const state = handleSuggestion(createAssistantState(), risk.id, 'kept');
    expect(openSuggestions(model, state).some((s) => s.id === risk.id)).toBe(false);
  });

  it('补全兜底最多提示 2 条固定推荐项，实例未选用途单独提示', () => {
    let model = addInstance(createModel(), '其他卧室');
    model = setValue(model, 'i1.wc_type', '');
    const fills = suggestionsOf(model).filter((s) => s.kind === 'fill');
    expect(fills.filter((s) => s.id.startsWith('fill#')).length).toBeLessThanOrEqual(2);
    expect(fills.some((s) => s.id === `type#${model.instances['其他卧室'][0].key}`)).toBe(true);
  });

  it('连续 3 次不感兴趣进入静默，采纳会打断连续计数', () => {
    let state = createAssistantState();
    state = handleSuggestion(state, 'a', 'ignored');
    state = handleSuggestion(state, 'b', 'ignored');
    state = handleSuggestion(state, 'c', 'adopted');
    state = handleSuggestion(state, 'd', 'ignored');
    state = handleSuggestion(state, 'e', 'ignored');
    expect(state.quiet).toBe(false);
    state = handleSuggestion(state, 'f', 'ignored');
    expect(state.dismissStreak).toBe(QUIET_THRESHOLD);
    expect(state.quiet).toBe(true);
  });
});

describe('写回动作', () => {
  it('单选字段写值', () => {
    const model = demoModel();
    const single = suggestionsOf(model).find((s) => s.ruleId === 'balcony-dryer')!;
    expect(getValue(applySuggestion(model, single).model, 'bl_hanger')).toEqual(['以烘干为主']);
  });

  it('文本字段追加，重复采纳会继续追加', () => {
    const model = demoModel();
    const rule = suggestionsOf(model).find((s) => s.ruleId === 'old-house')!;
    const once = applySuggestion(model, rule).model;
    expect(String(getValue(once, 'base_other'))).toContain('水电管线年限');
    const twice = applySuggestion(once, rule, '按我们的习惯改写：先查水电年限。').model;
    expect(String(getValue(twice, 'base_other'))).toContain('先查水电年限');
  });

  it('落不到字段的建议写进所属大类的其他补充', () => {
    const model = demoModel();
    const rule = suggestionsOf(model).find((s) => s.ruleId === 'schedule-conflict')!;
    const outcome = applySuggestion(model, rule);
    expect(outcome.key).toBe('base_other');
    expect(getValue(outcome.model, 'date_start')).toBeUndefined();
  });

  it('实例规则写回该实例的其他补充，不影响别的实例', () => {
    const model = demoModel();
    const rule = suggestionsOf(model).find((s) => s.ruleId === 'bath-tub')!;
    const outcome = applySuggestion(model, rule);
    expect(outcome.key).toBe('i1.wc_other');
    expect(String(getValue(outcome.model, 'i1.wc_other'))).toContain('浴缸');
    expect(getValue(outcome.model, 'i2.wc_other')).toBeUndefined();
  });

  it('字段已有不同值时替换需要二次确认', () => {
    let model = demoModel();
    const rule = suggestionsOf(model).find((s) => s.ruleId === 'budget-reserve')!;
    expect(needsConfirm(model, rule)).toBe(false);
    model = setValue(model, 'budget_reserve', '否');
    expect(needsConfirm(model, rule)).toBe(true);
    model = setValue(model, 'budget_reserve', '是');
    expect(needsConfirm(model, rule)).toBe(false);
  });
});
