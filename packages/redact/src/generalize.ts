/**
 * 泛化：把可识别的细节降成粗粒度描述再外发（产品文档 7.2）。
 *
 * 泛化粒度也是策略的一部分：公司要更严的口径，改的是这份规则，不是这段代码。
 */

import type { GeneralizeKind } from './types';

/** 城市等级：只发等级，不发具体城市。 */
export const CITY_TIERS: Record<string, string> = {
  北京: '一线城市', 上海: '一线城市', 广州: '一线城市', 深圳: '一线城市',
  成都: '新一线城市', 重庆: '新一线城市', 杭州: '新一线城市', 武汉: '新一线城市',
  西安: '新一线城市', 苏州: '新一线城市', 天津: '新一线城市', 南京: '新一线城市',
  郑州: '新一线城市', 长沙: '新一线城市', 东莞: '新一线城市', 沈阳: '新一线城市',
  青岛: '新一线城市', 合肥: '新一线城市', 佛山: '新一线城市',
  宁波: '二线城市', 昆明: '二线城市', 福州: '二线城市', 无锡: '二线城市', 厦门: '二线城市',
  哈尔滨: '二线城市', 长春: '二线城市', 南昌: '二线城市', 济南: '二线城市', 大连: '二线城市',
  贵阳: '二线城市', 温州: '二线城市', 石家庄: '二线城市', 泉州: '二线城市', 南宁: '二线城市',
  金华: '二线城市', 常州: '二线城市', 珠海: '二线城市', 惠州: '二线城市', 嘉兴: '二线城市',
  南通: '二线城市', 中山: '二线城市', 保定: '二线城市', 兰州: '二线城市', 台州: '二线城市',
  徐州: '二线城市', 太原: '二线城市', 绍兴: '二线城市', 烟台: '二线城市', 廊坊: '二线城市',
};

export function cityTier(city: string): string {
  const text = city.trim();
  if (!text) return '城市未填写';
  const hit = Object.keys(CITY_TIERS).find((k) => text.includes(k));
  return hit ? CITY_TIERS[hit] : '其他城市';
}

/** 年龄段：只发年龄段与人数，不发具体年龄。 */
const AGE_BANDS: { max: number; label: string }[] = [
  { max: 2, label: '幼儿' },
  { max: 5, label: '学龄前' },
  { max: 11, label: '学龄' },
  { max: 17, label: '青少年' },
  { max: Infinity, label: '成年' },
];

export function ageBand(text: string): string {
  const ages = [...text.matchAll(/(\d{1,3})\s*(?:岁|周岁|个月)?/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 120);
  if (!ages.length) return '年龄段未填写';
  const counts = new Map<string, number>();
  ages.forEach((age) => {
    const band = AGE_BANDS.find((b) => age <= b.max)!.label;
    counts.set(band, (counts.get(band) ?? 0) + 1);
  });
  // 从年长到年幼排：读起来先看到承担决策的成年人
  return [...AGE_BANDS].reverse().map((b) => b.label)
    .filter((label) => counts.has(label))
    .map((label) => `${label} ${counts.get(label)} 人`)
    .join('、');
}

/** 时间点：只发相对时间段，不发具体月份。 */
export function relativePeriod(text: string, now: Date): string {
  const m = /(\d{4})\s*[-/年.]\s*(\d{1,2})/.exec(text);
  if (!m) return '时间待确认';
  const months = (Number(m[1]) - now.getFullYear()) * 12 + (Number(m[2]) - 1 - now.getMonth());
  if (months <= 0) return '已过计划时间';
  if (months <= 3) return '3 个月内';
  if (months <= 6) return '3-6 个月内';
  if (months <= 12) return '6-12 个月内';
  if (months <= 24) return '1-2 年内';
  return '两年以后';
}

export function generalizeValue(kind: GeneralizeKind, raw: string, now: Date): string {
  if (kind === 'city-tier') return cityTier(raw);
  if (kind === 'age-band') return ageBand(raw);
  return relativePeriod(raw, now);
}
