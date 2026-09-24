/**
 * 四张回流报表（产品文档 7.6）。
 *
 * 这里只做汇总与排序，不做判断：哪条规则该下架、哪条判据该收紧，是人看报表之后的事
 * （7.5 第 1 条）。所以每一列都给出分子与分母，率算不出来时给 null——界面显示「未采集」或
 * 「还没有样本」，不显示 0（第十章的原则：一个假的 0 比空着更糟）。
 *
 * 纯函数：输入是几个读能力，不 import 框架、不读环境变量，单测直接喂内存数据。
 */

import { fieldOf, isEmptyValue, splitKey } from '@zx/field-spec';
import type { FieldValue, FormModel } from '@zx/field-spec';
import { unclearAnswers } from '@zx/checklist';
import type { ItemSource, Tier } from '@zx/checklist';
import { RULE_META } from '@zx/rules';
import type { CriterionHealth, FieldHealth, OmissionCategory, Reports, RuleHealth } from '@zx/contracts';
import type { EventRecord, Maybe, SheetRecord, SiteRecordRecord, ChecklistRecord } from './types';

/** 报表需要的读能力：仓储层与内存实现都满足它，换存储不动这里。 */
export interface ReportSource {
  listDemandSheets(): Maybe<SheetRecord[]>;
  latestChecklist(demandSheetId: string): Maybe<ChecklistRecord | undefined>;
  listSiteRecords(checklistId: string): Maybe<SiteRecordRecord[]>;
  /** 不带参数就是全部事件（技术方案 6.11 的查询接口同口径） */
  listEvents(demandSheetId?: string): Maybe<EventRecord[]>;
}

/** 率一律是百分数（保留一位小数）；分母为 0 时是 null——「还没有样本」不是 0%。 */
function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

const SOURCE_LABEL: Record<ItemSource, string> = { derived: '需求推导', both: '推导+通用', survey: '通用核实' };
const TIER_LABEL: Record<Tier, string> = { must: '必问', suggest: '建议问' };
/** 报表里的固定顺序：推导项在最前（它最可能被删，是调判据的第一现场）。 */
const SOURCE_RANK: Record<ItemSource, number> = { derived: 0, both: 1, survey: 2 };
const TRIGGER_BY_RULE = new Map(RULE_META.map((m) => [m.id, m.trigger]));

/** 一张表单里「有值的字段」：固定字段与实例字段一视同仁，只按字段 id 归属。 */
function answeredFieldIds(model: FormModel): Set<string> {
  const ids = new Set<string>();
  const collect = (values: Record<string, FieldValue>) => {
    Object.entries(values).forEach(([id, value]) => {
      if (!isEmptyValue(value)) ids.add(id);
    });
  };
  collect(model.values);
  Object.values(model.instances).forEach((list) => list.forEach((inst) => collect(inst.values)));
  return ids;
}

/** 规则健康度：从展示 / 采纳 / 不感兴趣三个事件按 props.rule 归组。 */
function ruleReport(events: EventRecord[]): RuleHealth[] {
  const rows = new Map<string, RuleHealth>();
  const row = (ruleId: string): RuleHealth => {
    const found = rows.get(ruleId);
    if (found) return found;
    const created: RuleHealth = {
      ruleId,
      trigger: TRIGGER_BY_RULE.get(ruleId) ?? null,
      shown: 0,
      adopted: 0,
      rejected: 0,
      rejectRate: null,
    };
    rows.set(ruleId, created);
    return created;
  };

  events.forEach((event) => {
    const ruleId = typeof event.props?.rule === 'string' ? event.props.rule : '';
    // 没带规则的事件不进这张表：名字错了数字就错了（技术方案 6.11）
    if (!ruleId) return;
    if (event.name === 'shown') row(ruleId).shown += 1;
    else if (event.name === 'adopt') row(ruleId).adopted += 1;
    else if (event.name === 'ignore') row(ruleId).rejected += 1;
  });

  return [...rows.values()]
    .map((r) => ({ ...r, rejectRate: pct(r.rejected, r.shown) }))
    .sort((a, b) => b.shown - a.shown || (b.rejectRate ?? -1) - (a.rejectRate ?? -1) || a.ruleId.localeCompare(b.ruleId));
}

/**
 * 判据健康度：按「来源 · 档位」归组。
 *
 * 只统计每份需求单**最新那一份**清单：重新生成过的旧清单不再计入，否则「生成三次、删一次」
 * 会把同一条条目数成三条。删减取条目的当前状态（撤销后不计入被删，7.5 第 2 条）。
 */
async function criterionReport(sheets: SheetRecord[], source: ReportSource): Promise<CriterionHealth[]> {
  const rows = new Map<string, CriterionHealth>();
  for (const sheet of sheets) {
    const checklist = await source.latestChecklist(sheet.id);
    if (!checklist) continue;
    checklist.items.forEach((item) => {
      const group = `${SOURCE_LABEL[item.source]} · ${TIER_LABEL[item.tier]}`;
      const row =
        rows.get(group) ??
        { group, source: item.source, tier: item.tier, items: 0, removed: 0, removalRate: null };
      row.items += 1;
      if (item.removed) row.removed += 1;
      rows.set(group, row);
    });
  }

  return [...rows.values()]
    .map((r) => ({ ...r, removalRate: pct(r.removed, r.items) }))
    .sort(
      (a, b) =>
        SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
        (a.tier === 'must' ? 0 : 1) - (b.tier === 'must' ? 0 : 1),
    );
}

/**
 * 字段健康度：不清楚率（表单）与没问上率（现场）两个来源，各自算各自的分母。
 *
 * 同一条清单条目引用多个字段时，这条条目在这几个字段上各算一次——否则「一条问三件事」的
 * 条目会把分母算少，率会虚高。现场修正率没有来源（现场记录只标「已问 / 没问上」），恒为 null。
 */
async function fieldReport(sheets: SheetRecord[], source: ReportSource): Promise<FieldHealth[]> {
  const answered = new Map<string, number>();
  const unclear = new Map<string, number>();
  const referenced = new Map<string, number>();
  const skipped = new Map<string, number>();
  const bump = (map: Map<string, number>, id: string) => map.set(id, (map.get(id) ?? 0) + 1);

  for (const sheet of sheets) {
    answeredFieldIds(sheet.payload).forEach((id) => bump(answered, id));
    unclearAnswers(sheet.payload).forEach((q) => bump(unclear, splitKey(q.fieldKey)[1]));

    const checklist = await source.latestChecklist(sheet.id);
    if (!checklist) continue;
    const skippedItems = new Set(
      (await source.listSiteRecords(checklist.id)).filter((r) => r.status === 'skip').map((r) => r.itemKey),
    );
    checklist.items.forEach((item) => {
      new Set(item.relatedFields.map((key) => splitKey(key)[1])).forEach((id) => {
        bump(referenced, id);
        if (skippedItems.has(item.key)) bump(skipped, id);
      });
    });
  }

  const ids = new Set([...answered.keys(), ...unclear.keys(), ...referenced.keys(), ...skipped.keys()]);
  return [...ids]
    .map((fieldId): FieldHealth => {
      const has = (map: Map<string, number>) => map.get(fieldId) ?? 0;
      return {
        fieldId,
        label: fieldOf(fieldId)?.label ?? fieldId,
        answered: has(answered),
        unclear: has(unclear),
        unclearRate: pct(has(unclear), has(answered)),
        referenced: has(referenced),
        skipped: has(skipped),
        skipRate: pct(has(skipped), has(referenced)),
        corrected: null,
      };
    })
    .sort((a, b) => b.unclear + b.skipped - (a.unclear + a.skipped) || a.fieldId.localeCompare(b.fieldId));
}

export async function buildReports(source: ReportSource): Promise<Reports> {
  const sheets = await source.listDemandSheets();
  const events = await source.listEvents();
  const nameById = new Map(sheets.map((s) => [s.id, s.demandName]));

  return {
    rules: ruleReport(events),
    criteria: await criterionReport(sheets, source),
    fields: await fieldReport(sheets, source),
    omissions: omissionLedger(events, nameById),
    unavailable: [
      {
        column: '现场修正率',
        reason: '现场记录只标「已问 / 没问上」，没有「结论与房主原填不符」的落点；要这一列就得先在现场端记一次修正',
      },
    ],
  };
}

/**
 * 遗漏台账：把 `omission_log` 事件投影成台账行（新的在前）。
 *
 * 补录只追加、不回溯改历史（7.5 第 2 条），所以台账就是这些事件本身——不另起一张表，
 * 同一处事实只有一个来源（技术方案 6.11 第 1 条）。
 */
export function omissionLedger(
  events: EventRecord[],
  demandNameById: Map<string, string>,
): Reports['omissions'] {
  return events
    .filter((e) => e.name === 'omission_log')
    .map((e) => ({
      id: e.id,
      demandSheetId: e.demandSheetId,
      demandName: demandNameById.get(e.demandSheetId) ?? e.demandSheetId,
      space: typeof e.props?.space === 'string' ? e.props.space : '',
      category: (e.props?.category ?? '说不清') as OmissionCategory,
      note: typeof e.props?.note === 'string' ? e.props.note : '',
      at: e.at,
      operator: e.operator ?? '（未记名）',
    }))
    // 同一时刻补两条（时钟精度到秒、或同一次会话连补）时，后写的排前面：先把写入顺序反过来，
    // 再按时间做稳定排序，时间相同的就保持「后写在前」。
    .reverse()
    .sort((a, b) => b.at.localeCompare(a.at));
}
