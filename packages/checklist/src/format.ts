/** 清单导出（F6）：Markdown 或可复制文本，用于打印或带进现场。 */

import type { Checklist } from './types';

export interface ChecklistHeading {
  name: string;
  overview: string;
  submitted: string;
}

const TIER_NAME = { must: '必问', suggest: '建议问' } as const;

export function buildChecklistMarkdown(checklist: Checklist, heading: ChecklistHeading): string {
  let out = `# 量房沟通清单 · ${heading.name}\n\n> ${heading.overview}（提交 ${heading.submitted}）\n`;
  out += `> 必问 ${checklist.counts.must} 条 · 共 ${checklist.counts.total} 条\n`;
  checklist.groups.forEach((g) => {
    out += `\n## ${g.space}　${g.items.length} 条\n`;
    g.items.forEach((i) => {
      out += `\n- [${TIER_NAME[i.tier]}] ${i.question}\n`;
      out += `  为什么问：${i.why}\n`;
      out += `  现场要核实：${i.onsiteChecks.join('；')}\n`;
    });
  });
  return out;
}
