/**
 * 现场记录（F11）：只回答「问没问、问出了什么」。
 *
 * 清单是生成物，现场记录是资产：记录不回改清单，也不在现场端修正房主原填的内容。
 * 记录按条目稳定标识挂，标识不带分组，所以重新生成清单、调分组都不会让记录失联。
 */

import type { Checklist, ChecklistItem } from './types';
import type { ChecklistHeading } from './format';

export type SiteRecordStatus = 'asked' | 'skip';

export interface SiteRecord {
  /** 条目的稳定标识（核实对象 + 主要来源字段） */
  itemKey: string;
  status: SiteRecordStatus;
  /** 已问时是一句话结论，没问上时是一句原因 */
  note: string;
  at: string;
  /** 离线时先存在本机、标成待同步；从服务端读回来的记录缺省即视为已同步 */
  synced?: boolean;
}

export interface SiteStats {
  total: number;
  asked: number;
  skip: number;
  left: number;
  must: number;
  mustAsked: number;
  /** 必问里还没落的（含标了没问上的） */
  mustOpen: ChecklistItem[];
}

/** 同一条目多条记录时以最后一条为准：记录只追加，不合并。 */
export function latestRecords(records: SiteRecord[]): Map<string, SiteRecord> {
  const map = new Map<string, SiteRecord>();
  records.forEach((r) => map.set(r.itemKey, r));
  return map;
}

export function siteStats(checklist: Checklist, records: SiteRecord[]): SiteStats {
  const latest = latestRecords(records);
  const statusOf = (i: ChecklistItem) => latest.get(i.key)?.status;
  const asked = checklist.items.filter((i) => statusOf(i) === 'asked').length;
  const skip = checklist.items.filter((i) => statusOf(i) === 'skip').length;
  const must = checklist.items.filter((i) => i.tier === 'must');
  return {
    total: checklist.items.length,
    asked,
    skip,
    left: checklist.items.length - asked - skip,
    must: must.length,
    mustAsked: must.filter((i) => statusOf(i) === 'asked').length,
    mustOpen: must.filter((i) => statusOf(i) !== 'asked'),
  };
}

/** 带回公司的速记：已问的带结论，没问上的带原因。 */
export function buildSiteRecordMarkdown(
  checklist: Checklist,
  records: SiteRecord[],
  heading: ChecklistHeading,
): string {
  const latest = latestRecords(records);
  const stats = siteStats(checklist, records);
  let out = `# 量房记录 · ${heading.name}\n\n${heading.overview}\n`;
  out += `已问 ${stats.asked} 条 · 没问上 ${stats.skip} 条 · 还没问到 ${stats.left} 条\n`;
  checklist.groups.forEach((g) => {
    out += `\n## ${g.space}\n`;
    g.items.forEach((i) => {
      const r = latest.get(i.key);
      const tag = r ? (r.status === 'asked' ? '已问' : '没问上') : '还没问到';
      out += `\n- [${tag}] ${i.question}\n`;
      if (r?.note) out += (r.status === 'asked' ? '  结论：' : '  原因：') + r.note + '\n';
    });
  });
  return out;
}
