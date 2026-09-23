/** 接口的读模型投影：把仓储里的行拼成界面直接能用的形状。 */

import { recommendStats } from '@zx/field-spec';
import type { FormModel } from '@zx/field-spec';
import { openQuestions } from '@zx/checklist';
import type { Checklist, ChecklistGroup, OpenQuestion } from '@zx/checklist';
import { suggestionsOf } from '@zx/rules';
import { buildOverview } from '@zx/summary';
import { DEFAULT_POLICY, previewOutbound } from '@zx/redact';
import type { Understanding } from '@zx/contracts';
import type { ChecklistView, DemandSheetDetail, DemandSheetSummary, UnderstandingView } from '@zx/contracts';
import type { DemandSheetRow, Repo, StoredChecklist } from './repo';

const EMPTY_UNDERSTANDING: Understanding = { profile: [], demands: [], conflicts: [], derivedItems: [] };

function understandingOf(stored: StoredChecklist | undefined): Understanding {
  const value = stored?.understanding as Partial<Understanding> | undefined;
  if (!value || typeof value !== 'object') return EMPTY_UNDERSTANDING;
  return {
    profile: value.profile ?? [],
    demands: value.demands ?? [],
    conflicts: value.conflicts ?? [],
    derivedItems: value.derivedItems ?? [],
  };
}

/** 说明白的矛盾与风险 = 模型给的矛盾 + 规则算出来的风险（技术方案 4.4）。 */
function risksOf(model: FormModel, stored: StoredChecklist | undefined): { label: string; text: string }[] {
  const fromModel = understandingOf(stored).conflicts.map((c) => ({ label: c.label, text: c.text }));
  const fromRules = suggestionsOf(model)
    .filter((s) => s.kind === 'risk')
    .map((s) => ({ label: s.title, text: s.text }));
  return [...fromModel, ...fromRules];
}

export function toUnderstandingView(
  model: FormModel,
  stored: StoredChecklist | undefined,
): UnderstandingView {
  const value = understandingOf(stored);
  return {
    profile: value.profile,
    demands: value.demands,
    risks: risksOf(model, stored),
    toConfirm: openQuestions(model).map((q: OpenQuestion) => ({
      fieldKey: q.fieldKey,
      label: q.label,
      space: q.space,
      why: q.why,
    })),
    derivedItems: value.derivedItems,
  };
}

/** 从库里的条目重建清单：条目按写入顺序（即分组顺序）取出，按空间切开即可。 */
export function toDomainChecklist(stored: StoredChecklist): Checklist {
  const groups: ChecklistGroup[] = [];
  stored.items.forEach((item) => {
    let group = groups.find((g) => g.space === item.space);
    if (!group) {
      group = { space: item.space, items: [], must: 0, suggest: 0 };
      groups.push(group);
    }
    const { removed: _removed, ...clean } = item;
    group.items.push(clean);
    if (clean.tier === 'must') group.must += 1;
    else group.suggest += 1;
  });
  const items = groups.flatMap((g) => g.items);
  const bySpace: Record<string, number> = {};
  groups.forEach((g) => {
    bySpace[g.space] = g.items.length;
  });
  return {
    groups,
    items,
    counts: {
      total: items.length,
      must: items.filter((i) => i.tier === 'must').length,
      suggest: items.filter((i) => i.tier === 'suggest').length,
      bySpace,
    },
    dropped: stored.dropped,
  };
}

export function toChecklistView(stored: StoredChecklist): ChecklistView {
  const domain = toDomainChecklist(stored);
  return {
    ...domain,
    id: stored.id,
    createdAt: stored.createdAt,
    model: stored.model,
    ruleVersion: stored.ruleVersion,
    policyVersion: stored.policyVersion,
    degraded: stored.degraded,
    removedKeys: stored.items.filter((i) => i.removed).map((i) => i.key),
  };
}

export function toSummary(repo: Repo, sheet: DemandSheetRow): DemandSheetSummary {
  const stored = repo.latestChecklist(sheet.id);
  return {
    id: sheet.id,
    demandName: sheet.demandName,
    submittedAt: sheet.submittedAt,
    source: sheet.source,
    overview: buildOverview(sheet.payload, []),
    progress: recommendStats(sheet.payload),
    hasChecklist: !!stored,
    checklistId: stored?.id ?? null,
  };
}

export function toDetail(repo: Repo, sheet: DemandSheetRow): DemandSheetDetail {
  const stored = repo.latestChecklist(sheet.id);
  return {
    sheet: {
      id: sheet.id,
      demandName: sheet.demandName,
      schemaVersion: sheet.schemaVersion,
      submittedAt: sheet.submittedAt,
      source: sheet.source,
      aiMarks: sheet.aiMarks,
    },
    form: sheet.payload,
    progress: recommendStats(sheet.payload),
    understanding: toUnderstandingView(sheet.payload, stored),
    outboundPreview: previewOutbound(sheet.payload, DEFAULT_POLICY),
    checklist: stored ? toChecklistView(stored) : null,
  };
}
