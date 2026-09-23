import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY,
  ageBand,
  buildOutbound,
  categoryOf,
  cityTier,
  defaultSelection,
  previewOutbound,
  redactText,
  relativePeriod,
} from '@zx/redact';
import { SEED_MODEL, SEED_NOW } from './fixtures/seed';

const textOf = (s: string) => redactText(s).text;
const labelsOf = (s: string) => [...new Set(redactText(s).hits.map((h) => h.label))];

describe('自由文本的识别与替换', () => {
  it('手机号与门牌地址被替换成占位符，原文不再外泄', () => {
    const r = redactText(SEED_MODEL.values.base_other as string);
    expect(r.text).not.toContain('13812345678');
    expect(r.text).toContain('[已隐去：手机号]');
    expect(r.text).toContain('[已隐去：门牌地址]');
    expect(r.text).not.toContain('珞喻路');
    expect(r.hits.map((h) => h.label)).toContain('手机号');
  });

  it('六类信息都认得出', () => {
    expect(labelsOf('手机 13812345678')).toEqual(['手机号']);
    expect(labelsOf('座机 027-87654321')).toEqual(['固定电话']);
    expect(labelsOf('身份证 110101199003071234')).toEqual(['身份证号']);
    expect(labelsOf('邮箱 zhang@example.com')).toEqual(['邮箱']);
    expect(labelsOf('微信号：zhang_xh2020')).toEqual(['微信号']);
    expect(labelsOf('住在幸福小区 12 栋 3 单元 501 室')).toEqual(['门牌地址']);
  });

  it('不该误伤的就不动它（中文人名交给逐条确认兜住）', () => {
    expect(labelsOf('想装新中式，喜欢原木')).toEqual([]);
    expect(textOf('户型 3室2厅2卫，层高 2.75m，预算 20-30万')).toBe('户型 3室2厅2卫，层高 2.75m，预算 20-30万');
    expect(textOf('希望厨房能做开放式，但担心油烟；收纳一定要够')).toBe('希望厨房能做开放式，但担心油烟；收纳一定要够');
  });

  it('原样返回并带上命中位置，供审计留档', () => {
    const r = redactText('电话 13812345678 找我');
    expect(r.hits[0].index).toBe(3);
    expect(r.hits[0].length).toBe(11);
    expect(r.hits[0].kind).toBe('phone');
  });
});

describe('泛化', () => {
  it('城市只发等级', () => {
    expect(cityTier('武汉')).toBe('新一线城市');
    expect(cityTier('杭州')).toBe('新一线城市');
    expect(cityTier('天水')).toBe('其他城市');
  });

  it('年龄只发年龄段与人数', () => {
    expect(ageBand('36岁 / 34岁 / 6岁')).toBe('成年 2 人、学龄 1 人');
    expect(ageBand('女儿 6 岁')).toBe('学龄 1 人');
    expect(ageBand('')).toBe('年龄段未填写');
  });

  it('时间只发相对时间段', () => {
    expect(relativePeriod('2026-12', SEED_NOW)).toBe('3 个月内');
    expect(relativePeriod('2027-06', SEED_NOW)).toBe('6-12 个月内');
    expect(relativePeriod('2026-01', SEED_NOW)).toBe('已过计划时间');
    expect(relativePeriod('还没想好', SEED_NOW)).toBe('时间待确认');
  });
});

describe('外发前逐条确认', () => {
  it('确认界面标出本次生效的策略与四个分组', () => {
    const groups = previewOutbound(SEED_MODEL, DEFAULT_POLICY, undefined, SEED_NOW);
    expect(groups.map((g) => g.title)).toEqual([
      '不外发｜留在本机',
      '泛化后外发',
      '自由文本｜默认不勾选',
      '原样外发｜选项类字段',
    ]);
    expect(groups[1].rows.map((r) => r.value)).toContain('武汉 → 新一线城市');
    expect(groups[0].rows.map((r) => r.fieldKey)).toEqual(['base_community']);
    expect(groups[0].rows[0].selectable).toBe(false);
  });

  it('命中的位置标注出来，让设计师知道发生了什么', () => {
    const free = previewOutbound(SEED_MODEL, DEFAULT_POLICY, undefined, SEED_NOW)[2];
    const row = free.rows.find((r) => r.fieldKey === 'base_other')!;
    expect(row.value).toContain('[已隐去：手机号]');
    expect(row.hits.map((h) => h.label)).toEqual(['手机号', '门牌地址']);
  });

  it('自由文本默认不勾选，选项类字段默认勾选', () => {
    const selection = defaultSelection(SEED_MODEL, DEFAULT_POLICY);
    expect(selection.base_other).toBe(false);
    expect(selection.note_free).toBe(false);
    expect(selection.kt_form).toBe(true);
    expect(selection.base_community).toBe(false);
    expect(categoryOf('base_other', DEFAULT_POLICY)).toBe('free-text');
    expect(categoryOf('base_community', DEFAULT_POLICY)).toBe('no-send');
    expect(categoryOf('live_ages', DEFAULT_POLICY)).toBe('generalize');
    expect(categoryOf('kt_form', DEFAULT_POLICY)).toBe('raw');
  });

  it('字段清单里没有的字段默认不外发（旧需求单仍可读，但不会外发）', () => {
    expect(categoryOf('某个新字段', DEFAULT_POLICY)).toBe('no-send');
  });
});

describe('外发 payload 与审计记录', () => {
  const out = buildOutbound({
    model: SEED_MODEL,
    policy: DEFAULT_POLICY,
    operator: '李工',
    at: '2026-09-23 10:05',
    now: SEED_NOW,
  });

  it('不外发字段的值不出现在请求里', () => {
    const json = JSON.stringify(out.payload);
    expect(json).not.toContain('万科城市花园');
    expect(json).not.toContain('13812345678');
    expect(out.payload.fields.map((f) => f.fieldKey)).not.toContain('base_community');
    expect(out.payload.withheld.map((w) => w.fieldKey)).toEqual(['base_community']);
  });

  it('自由文本没勾选就不参与解读，代价对设计师可见', () => {
    expect(out.payload.unselectedFreeText).toBeGreaterThan(0);
    expect(out.payload.fields.every((f) => categoryOf(f.fieldKey.split('.').pop()!, DEFAULT_POLICY) !== 'free-text')).toBe(true);
    expect(out.payload.fields.map((f) => f.fieldKey)).not.toContain('note_free');
  });

  it('勾选后自由文本以外发形态进入请求，命中位置留档', () => {
    const all = buildOutbound({
      model: SEED_MODEL,
      policy: DEFAULT_POLICY,
      operator: '李工',
      at: '2026-09-23 10:05',
      now: SEED_NOW,
      selected: { ...defaultSelection(SEED_MODEL, DEFAULT_POLICY), base_other: true },
    });
    const sent = all.payload.fields.find((f) => f.fieldKey === 'base_other')!;
    expect(sent.value).not.toContain('13812345678');
    expect(sent.value).toContain('[已隐去：手机号]');
    const logged = all.record.redactions.find((r) => r.fieldKey === 'base_other')!;
    expect(logged.kinds).toEqual(['phone', 'address']);
    expect(logged.count).toBe(2);
  });

  it('外发记录带字段清单、策略版本、时间与操作人', () => {
    expect(out.record.policyName).toBe('默认合规策略');
    expect(out.record.policyVersion).toBe('v1');
    expect(out.record.at).toBe('2026-09-23 10:05');
    expect(out.record.operator).toBe('李工');
    expect(out.record.fieldKeys).toEqual(out.payload.fields.map((f) => f.fieldKey));
    expect(out.payload.policyVersion).toBe(DEFAULT_POLICY.version);
  });

  it('泛化字段发出去的是粗粒度描述', () => {
    const city = out.payload.fields.find((f) => f.label === '所在城市')!;
    expect(city.value).toBe('新一线城市');
    expect(city.tier).toBe('generalize');
    const ages = out.payload.fields.find((f) => f.label === '成员年龄')!;
    expect(ages.value).toBe('成年 2 人、学龄 1 人');
  });
});
