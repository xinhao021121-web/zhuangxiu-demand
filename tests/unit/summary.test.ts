import { describe, expect, it } from 'vitest';
import { addInstance, createModel, setValue } from '@zx/field-spec';
import { OVERVIEW_LIMIT, buildOverview, buildSummary, buildSurveyChecklist } from '@zx/summary';

function scenario() {
  let model = createModel();
  model = setValue(model, 'base_area', 89);
  model = setValue(model, 'base_house_state', '旧房翻新');
  model = setValue(model, 'budget_total', '20-30万');
  model = setValue(model, 'live_members', ['夫妻', '儿子']);
  model = setValue(model, 'live_pet', ['猫']);
  model = setValue(model, 'bl_dryer', '是');
  model = setValue(model, 'i1.wc_bath', '浴缸加淋浴');
  model = addInstance(model, '其他卧室');
  model = setValue(model, `${model.instances['其他卧室'][0].key}.room_type`, '儿童房');
  return model;
}

describe('需求摘要', () => {
  it('核心摘要控制在 150 字以内', () => {
    const text = buildOverview(scenario(), ['先确认油烟方案']);
    expect(text.length).toBeLessThanOrEqual(OVERVIEW_LIMIT);
    expect(text).toContain('89');
  });

  it('完整摘要按空间与实例展开，并列出已确认的发现', () => {
    const text = buildSummary(scenario(), ['先确认油烟方案']);
    expect(text).toContain('需求摘要');
    expect(text).toContain('卫生间（2 个）');
    expect(text).toContain('主卫');
    expect(text).toContain('次卧1 · 儿童房');
    expect(text).toContain('二、助手发现并确认的需求');
    expect(text).toContain('先确认油烟方案');
    expect(text).toContain('烘干机：是');
  });

  it('量房确认清单 16 项随摘要一起输出', () => {
    const text = buildSurveyChecklist();
    expect(text).toContain('16 项');
    expect(text.split('\n')).toHaveLength(17);
  });
});
