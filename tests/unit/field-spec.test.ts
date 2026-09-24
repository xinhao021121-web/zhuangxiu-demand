import { describe, expect, it } from 'vitest';
import {
  FIELD_SPEC,
  INSTANCE_DEF,
  SECTION_NAMES,
  SECTIONS,
  SURVEY_CHECKLIST,
  UNCLEAR_CHECKLIST,
  addInstance,
  createModel,
  instanceName,
  instanceType,
  recommendStats,
  sectionStats,
  setValue,
  visibleFields,
} from '@zx/field-spec';

describe('字段规格', () => {
  it('13 个大类、191 个表单字段', () => {
    expect(SECTION_NAMES).toHaveLength(13);
    expect(FIELD_SPEC).toHaveLength(191);
  });

  it('每个大类的字段数与产品文档一致', () => {
    const expected: Record<string, number> = {
      认识你家: 43,
      设备与系统: 9,
      玄关: 13,
      客厅: 12,
      餐厅: 9,
      厨房: 18,
      阳台: 12,
      主卧: 14,
      其他卧室: 12,
      书房与电竞房: 13,
      卫生间: 21,
      收纳与家政: 11,
      补充说明: 4,
    };
    SECTIONS.forEach((s) => expect(s.fields.length, s.name).toBe(expected[s.name]));
  });

  it('没有必填项：只有推荐填写 / 实例必选 / 选填', () => {
    expect([...new Set(FIELD_SPEC.map((f) => f.suggest))].sort()).toEqual(['实例必选', '推荐填写', '选填'].sort());
    expect(FIELD_SPEC.filter((f) => f.suggest === '推荐填写')).toHaveLength(9);
    expect(FIELD_SPEC.filter((f) => f.suggest === '实例必选')).toHaveLength(2);
  });

  it('量房确认清单 16 项', () => {
    expect(SURVEY_CHECKLIST).toHaveLength(16);
    expect(SURVEY_CHECKLIST[0].item.length).toBeGreaterThan(0);
  });

  it('给了「不清楚 / 听设计师建议」选项的字段，都有直接对应的量房核实项', () => {
    const UNCLEAR = /不清楚|不确定|听设计师建议|还没想好|说不好/;
    const withOption = FIELD_SPEC.filter((f) => f.options.some((o) => UNCLEAR.test(o)));
    const mapped = new Set(SURVEY_CHECKLIST.flatMap((s) => s.relatedFields));

    // 采集端目前在这 9 个专业判断字段上给了该选项；字段清单变了要回来重新决定
    expect(withOption).toHaveLength(9);
    expect(UNCLEAR_CHECKLIST).toHaveLength(6);

    const missing = withOption.filter((f) => !mapped.has(f.id) && !UNCLEAR_CHECKLIST.some((u) => u.fieldId === f.id));
    expect(missing.map((f) => f.id), '这些字段答「不清楚」时没有可问的条目').toEqual([]);

    // 反向：资产里不留多余的行——字段不再有该选项，或它已经有通用项可落，就该删掉
    const stale = UNCLEAR_CHECKLIST.filter((u) => !withOption.some((f) => f.id === u.fieldId));
    expect(stale.map((u) => u.fieldId), '这些待定项已经用不上了').toEqual([]);
    const duplicated = UNCLEAR_CHECKLIST.filter((u) => mapped.has(u.fieldId));
    expect(duplicated.map((u) => u.fieldId), '这些字段已经能落到通用清单上，不该再单独配一条').toEqual([]);
  });

  it('待定项资产与通用清单不撞核实对象，否则会互相并掉', () => {
    const surveyObjects = new Set(SURVEY_CHECKLIST.map((s) => s.object));
    expect(UNCLEAR_CHECKLIST.filter((u) => surveyObjects.has(u.object)).map((u) => u.object)).toEqual([]);
  });

  it('空间实例：卫生间默认两个，次卧上限 4 个', () => {
    const model = createModel();
    expect(model.instances['卫生间']).toHaveLength(2);
    expect(model.instances['其他卧室']).toHaveLength(0);
    expect(instanceName(model, model.instances['卫生间'][0])).toBe('主卫');
    expect(instanceName(model, model.instances['卫生间'][1])).toBe('客卫');
    let many = model;
    for (let i = 0; i < 10; i += 1) many = addInstance(many, '其他卧室');
    expect(many.instances['其他卧室']).toHaveLength(INSTANCE_DEF['其他卧室'].max);
  });

  it('房型决定字段显隐：选了儿童房就不问长辈房的问题', () => {
    let model = addInstance(createModel(), '其他卧室');
    const inst = model.instances['其他卧室'][0];
    expect(visibleFields('其他卧室', inst).some((f) => f.id === 'ch_activity')).toBe(false);
    model = setValue(model, `${inst.key}.room_type`, '儿童房');
    const kid = model.instances['其他卧室'][0];
    const ids = visibleFields('其他卧室', kid).map((f) => f.id);
    expect(instanceType(kid)).toBe('儿童房');
    expect(ids).toContain('ch_activity');
    expect(ids).not.toContain('el_safety');
    expect(ids).toContain('room_bed');
    expect(instanceName(model, kid)).toBe('次卧1 · 儿童房');
  });

  it('需求清晰度按推荐填写项计算，含实例内的推荐项', () => {
    const model = createModel();
    const base = recommendStats(model);
    expect(base.total).toBe(10); // 8 个固定推荐项 + 两个卫生间各一次泡澡需求
    expect(base.done).toBe(0);
    const filled = setValue(setValue(model, 'base_area', 89), 'base_house_state', '毛坯');
    expect(recommendStats(filled).done).toBe(2);
    expect(recommendStats(filled).percent).toBe(20);
  });

  it('分区统计按实例展开', () => {
    const model = createModel();
    const wc = sectionStats(model, '卫生间');
    expect(wc.count).toBe(2);
    expect(wc.total).toBe(visibleFields('卫生间', model.instances['卫生间'][0]).length * 2);
    expect(sectionStats(model, '厨房').total).toBe(FIELD_SPEC.filter((f) => f.section === '厨房').length);
  });
});
