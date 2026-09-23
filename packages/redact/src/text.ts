/**
 * 自由文本的识别与替换（产品文档 7.3）。
 *
 * 中文人名不做自动识别——没有可靠的正则，硬做会误伤（把「想装新中式」这类词也当成人名）。
 * 这个缺口由逐条确认界面兜住：判决权交给看得见上下文的人。
 */

import type { RedactedText, RedactionHit, TextKind } from './types';

/** 命中后替换成的占位符，原文只留在这份需求单里。 */
export const PLACEHOLDER = (label: string) => `[已隐去：${label}]`;

/** 门牌单元：号 / 栋 / 幢 / 单元 / 室 / 楼 / 座。 */
const UNIT = String.raw`(?:\s*\d{1,5}\s*[-－]?\s*(?:号|栋|幢|单元|室|楼|座))`;
/** 地址前面的地名：路 / 街 / 小区 / 花园 …，有它一个单元就能判定。 */
const PLACE = String.raw`(?:路|街|道|巷|弄|小区|花园|苑|城|村|镇|园区|新区)`;
/** 前面的普通字符：留给「洪山区珞喻路」这类前缀。 */
const PREFIX = String.raw`[\u4e00-\u9fa5A-Za-z0-9]{0,12}`;

/**
 * 门牌地址的三条判据：有地名；或连着两个以上门牌单元；或紧跟在「地址 / 住址 / 门牌 / 住在」后面。
 *
 * 只出现一个门牌单元、又没有任何上下文时不认——「3室2厅2卫」这种户型写法正好卡在这里，
 * 不该被当成地址。
 */
const ADDRESS = new RegExp(
  [
    `${PREFIX}${PLACE}${UNIT}+(?:\\s*\\d{1,5})?`,
    `${PREFIX}${UNIT}{2,}(?:\\s*\\d{1,5})?`,
    `(?:地址|住址|门牌|住在|搬到)\\s*[:：]?\\s*${PREFIX}?${UNIT}+`,
  ].join('|'),
  'g',
);

/**
 * 识别顺序即优先级：同一个起始位置上，排在前的先算。
 *
 * 身份证号排在手机号前面：身份证里连着 18 位数字，手机号的正则会切走中间一段。
 */
export const TEXT_PATTERNS: { kind: TextKind; label: string; re: RegExp }[] = [
  {
    kind: 'idcard',
    label: '身份证号',
    re: /[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g,
  },
  { kind: 'phone', label: '手机号', re: /1[3-9]\d{9}/g },
  { kind: 'landline', label: '固定电话', re: /0\d{2,3}-?\d{7,8}/g },
  { kind: 'email', label: '邮箱', re: /[\w.+-]+@[\w-]+\.[\w.]+/g },
  {
    kind: 'wechat',
    label: '微信号',
    re: /(?:微信号|微信|weixin|wechat|vx|VX|v信)\s*[:：]?\s*[A-Za-z][-_A-Za-z0-9]{5,19}/g,
  },
  { kind: 'address', label: '门牌地址', re: ADDRESS },
];

interface Match {
  kind: TextKind;
  label: string;
  index: number;
  length: number;
  order: number;
}

/** 在原文上一次性找出全部命中，重叠时保留起点更早的（起点相同按识别顺序）。 */
export function findHits(text: string): Match[] {
  const found: Match[] = [];
  TEXT_PATTERNS.forEach((p, order) => {
    const re = new RegExp(p.re.source, p.re.flags);
    let m = re.exec(text);
    while (m) {
      if (m[0]) found.push({ kind: p.kind, label: p.label, index: m.index, length: m[0].length, order });
      m = re.exec(text);
    }
  });
  found.sort((a, b) => a.index - b.index || a.order - b.order || b.length - a.length);
  const kept: Match[] = [];
  found.forEach((m) => {
    const end = m.index + m.length;
    if (kept.some((k) => m.index < k.index + k.length && k.index < end)) return;
    kept.push(m);
  });
  return kept;
}

export function redactText(text: string): RedactedText {
  if (!text) return { text, hits: [] };
  const matches = findHits(text);
  const hits: RedactionHit[] = matches.map((m) => ({
    kind: m.kind,
    label: m.label,
    index: m.index,
    length: m.length,
  }));
  let out = '';
  let cursor = 0;
  matches.forEach((m) => {
    out += text.slice(cursor, m.index) + PLACEHOLDER(m.label);
    cursor = m.index + m.length;
  });
  out += text.slice(cursor);
  return { text: out, hits };
}
