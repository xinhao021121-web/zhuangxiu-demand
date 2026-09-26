/** 清单导出（F6）：Markdown 或可复制文本，用于打印或带进现场。 */

import type { Checklist } from './types';

export interface ChecklistHeading {
  name: string;
  overview: string;
  submitted: string;
}

const TIER_NAME = { must: '必问', suggest: '建议问' } as const;

/**
 * 建议问里的两级（产品文档 5.6）：这一家推出来的排在通用核实前面。
 *
 * 来源不是 `survey` 的都算「这一家的」——包括两者合并的那一类，它带着这份需求单的具体依据。
 */
const own = (source: Checklist['items'][number]['source']) => source !== 'survey';

function labelOf(item: Checklist['items'][number]): string {
  if (item.tier === 'must') return TIER_NAME.must;
  return own(item.source) ? '建议问 · 这一家的' : '建议问 · 通用核实';
}

export function buildChecklistMarkdown(checklist: Checklist, heading: ChecklistHeading): string {
  const ownSuggest = checklist.items.filter((i) => i.tier === 'suggest' && own(i.source)).length;
  let out = `# 量房沟通清单 · ${heading.name}\n\n> ${heading.overview}（提交 ${heading.submitted}）\n`;
  out += `> 必问 ${checklist.counts.must} 条 · 共 ${checklist.counts.total} 条\n`;
  out += `> 建议问 ${checklist.counts.suggest} 条里，这一家的 ${ownSuggest} 条排在前面，其余是通用核实\n`;
  checklist.groups.forEach((g) => {
    out += `\n## ${g.space}　${g.items.length} 条\n`;
    g.items.forEach((i) => {
      out += `\n- [${labelOf(i)}] ${i.question}\n`;
      out += `  为什么问：${i.why}\n`;
      out += `  现场要核实：${i.onsiteChecks.join('；')}\n`;
    });
  });
  return out;
}
