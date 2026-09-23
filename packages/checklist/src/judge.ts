/**
 * 判据筛选（产品文档 4.3）：一条信息进清单，当且仅当它满足三条判据里的任意一条。
 *
 * 必问 = 影响可行性 或 影响方向（不问就会做错、要返工）；
 * 建议问 = 影响成本或工期，以及触发了字段但现场条件不一定成立的通用项。
 */

import type { DerivedItem, Impact, Tier } from './types';

export function tierOf(impact: Impact[]): Tier | null {
  if (impact.includes('feasibility') || impact.includes('direction')) return 'must';
  if (impact.includes('cost') || impact.includes('schedule')) return 'suggest';
  return null;
}

export interface Classified {
  accepted: { item: DerivedItem; tier: Tier }[];
  /** 被筛掉的推导项：判据不成立，或指不到字段（硬约束：指不到字段的不出现） */
  dropped: DerivedItem[];
}

export function classifyDerived(derived: DerivedItem[]): Classified {
  const accepted: Classified['accepted'] = [];
  const dropped: DerivedItem[] = [];
  derived.forEach((item) => {
    const tier = tierOf(item.impact ?? []);
    if (!tier || !item.relatedFieldIds?.length) {
      dropped.push(item);
      return;
    }
    accepted.push({ item, tier });
  });
  return { accepted, dropped };
}
