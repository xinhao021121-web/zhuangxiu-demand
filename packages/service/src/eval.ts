/**
 * 清单质量评估：把「模型好不好」拆成能自动判的部分（技术方案 4.7、产品文档第十章）。
 *
 * 三条原则：
 *
 * 1. **先分清哪些能自动判、哪些必须人判。** 可溯源、同对象重复、降级、期望覆盖都是确定判断，
 *    写在这里；「这条问得有没有价值」只能人评，落在 `evals/rubric.md` 的评审表里。
 * 2. **离线与真机共用一套口径。** 离线跑录制输出（一次提交一次种子场景回归），真机跑真实模型
 *    （质量度量与稳定性），换的只是 provider，评分器一行不改。
 * 3. **期望不抄输出。** 每个用例的期望由人工单独标注并写明理由（见 `evals/cases.ts` 的 intent），
 *    否则测的只是自己写的东西。
 *
 * 不判的东西也写清楚：清单条数、分区分布、模型产出的新核实对象数都只报数不判死——
 * 它们是「筛得准不准」的观测项，阈值要等真实数据（产品文档第十章）。
 */

import { openQuestions } from '@zx/checklist';
import type { Checklist } from '@zx/checklist';
import { SURVEY_CHECKLIST } from '@zx/field-spec';
import type { FormModel } from '@zx/field-spec';
import type { UnderstandingIssues } from '@zx/contracts';
import { generateChecklist } from './pipeline';
import type { ModelProvider, TokenUsage } from './model';
import type {
  ChecklistRecord,
  OutboundRecordRecord,
  ServiceStore,
  SheetRecord,
} from './types';

/** 一个评测用例：一份需求单 + 人工标注的期望。 */
export interface EvalCase {
  /** 用例 id，同时是需求单 id（真机跑时必须唯一） */
  id: string;
  /** 这个用例在考什么，写进报告 */
  intent: string;
  /** 需求单名字，只用于展示 */
  demandName: string;
  /** 需求单内容 */
  model: FormModel;
  expectation: EvalExpectation;
  /** 有没有录制输出：没有的用例离线回归跳过，只等真机跑 */
  recorded: boolean;
}

/**
 * 期望只写「必须发生什么」，不写「必须输出什么」：
 * 前者是这份需求单里房主已经暴露的信息，后者会变成抄答案。
 */
export interface EvalExpectation {
  /** 清单里必须有条目指到这些字段键（含实例字段的「实例键.字段ID」写法） */
  coverFields?: string[];
  /** 清单里必须出现这些核实对象 */
  coverObjects?: string[];
  /** 这些核实对象必须与通用清单合并成一条（source 为 both），不能只出通用提醒 */
  mergeObjects?: string[];
  /** 通用清单之外的新核实对象的上限；用来抓「硬凑条数」 */
  maxNovelObjects?: number;
}

export interface EvalMetrics {
  items: number;
  must: number;
  suggest: number;
  bySource: { derived: number; both: number; survey: number };
  /** 通用清单之外的核实对象：模型真的读懂了才有，堆量时会异常多 */
  novelObjects: string[];
  /** 同一个核实对象落在多个分区：通常是实例拆分，也可能是一次分区漂移 */
  multiSpaceObjects: { object: string; spaces: string[] }[];
  degraded: boolean;
  issues?: UnderstandingIssues;
  /** 指不到字段、也不是通用资产的条目，应为空 */
  untraceable: string[];
  /** 同一分区 + 同一核实对象出了两条，应为空 */
  duplicates: string[];
  missingFields: string[];
  missingObjects: string[];
  missingMerges: string[];
  /** 房主自己暴露的不确定（空缺推荐项 + 答「不清楚」）有几条 */
  ruleCandidates: number;
  /** 其中被清单接住了几条；差值是「只进了表格理解、没进清单」的部分 */
  ruleCovered: number;
  /** 没被清单接住的那些是哪几条：这是口径证据，不是模型问题 */
  ruleUncovered: { fieldKey: string; label: string; why: string }[];
  failures: string[];
}

const SURVEY_OBJECTS = new Set(SURVEY_CHECKLIST.map((s) => s.object));

export function scoreChecklist(input: {
  model: FormModel;
  checklist: Checklist;
  expectation: EvalExpectation;
  degraded: boolean;
  issues?: UnderstandingIssues;
}): EvalMetrics {
  const { checklist, expectation } = input;
  const items = checklist.items;

  const bySource = { derived: 0, both: 0, survey: 0 };
  const untraceable: string[] = [];
  items.forEach((item) => {
    bySource[item.source] += 1;
    // 通用核实项里本来就允许没有来源字段（结构类，业主无法判断）；推导项不允许
    if (item.source !== 'survey' && item.relatedFields.length === 0) untraceable.push(item.object);
  });

  const samePlace = new Map<string, number>();
  items.forEach((item) => {
    const key = `${item.space}|${item.object}`;
    samePlace.set(key, (samePlace.get(key) ?? 0) + 1);
  });
  const duplicates = [...samePlace.entries()].filter(([, n]) => n > 1).map(([key]) => key);

  const spacesOf = new Map<string, Set<string>>();
  items.forEach((item) => {
    const set = spacesOf.get(item.object) ?? new Set<string>();
    set.add(item.space);
    spacesOf.set(item.object, set);
  });
  const multiSpaceObjects = [...spacesOf.entries()]
    .filter(([, spaces]) => spaces.size > 1)
    .map(([object, spaces]) => ({ object, spaces: [...spaces] }));

  const coveredFields = new Set(items.flatMap((i) => i.relatedFields));
  const coveredObjects = new Set(items.map((i) => i.object));
  const mergedObjects = new Set(items.filter((i) => i.source === 'both').map((i) => i.object));
  const novelObjects = [...coveredObjects].filter((o) => !SURVEY_OBJECTS.has(o));

  const missingFields = (expectation.coverFields ?? []).filter((k) => !coveredFields.has(k));
  const missingObjects = (expectation.coverObjects ?? []).filter((o) => !coveredObjects.has(o));
  const missingMerges = (expectation.mergeObjects ?? []).filter((o) => !mergedObjects.has(o));

  const candidates = openQuestions(input.model);
  const ruleCovered = candidates.filter((c) => coveredFields.has(c.fieldKey)).length;
  const ruleUncovered = candidates
    .filter((c) => !coveredFields.has(c.fieldKey))
    .map((c) => ({ fieldKey: c.fieldKey, label: c.label, why: c.why }));

  const failures: string[] = [];
  if (untraceable.length) failures.push(`指不到字段的条目 ${untraceable.length} 条：${untraceable.join('、')}`);
  if (duplicates.length) failures.push(`同一分区同一核实对象出了多条：${duplicates.join('、')}`);
  if (input.degraded) failures.push('模型部分未生成，清单降级为纯规则');
  if (missingFields.length) failures.push(`房主填过的内容没被问到：${missingFields.join('、')}`);
  if (missingObjects.length) failures.push(`该出现的核实对象没出现：${missingObjects.join('、')}`);
  if (missingMerges.length) failures.push(`没能与通用清单合并：${missingMerges.join('、')}`);
  if (expectation.maxNovelObjects !== undefined && novelObjects.length > expectation.maxNovelObjects) {
    failures.push(`新核实对象 ${novelObjects.length} 个，超过上限 ${expectation.maxNovelObjects}：${novelObjects.join('、')}`);
  }

  return {
    items: items.length,
    must: checklist.counts.must,
    suggest: checklist.counts.suggest,
    bySource,
    novelObjects,
    multiSpaceObjects,
    degraded: input.degraded,
    issues: input.issues,
    untraceable,
    duplicates,
    missingFields,
    missingObjects,
    missingMerges,
    ruleCandidates: candidates.length,
    ruleCovered,
    ruleUncovered,
    failures,
  };
}

/** 多条采样之间的稳定性：必问条数飘不飘、条目集合像不像同一条清单。 */
export interface EvalStability {
  runs: number;
  must: { min: number; max: number };
  total: { min: number; max: number };
  /** 两两采样的条目集合平均 Jaccard（1 表示每次一模一样） */
  itemJaccard: number;
  /** 不是每次都出现的核实对象 */
  unstableObjects: string[];
}

export interface EvalCaseResult {
  id: string;
  intent: string;
  samples: EvalMetrics[];
  stability?: EvalStability;
}

export interface EvalReport {
  label: string;
  provider: string;
  runs: number;
  /** 判不判通过：离线回归判，真机实测只测量（报告头要据此措辞） */
  gated: boolean;
  results: EvalCaseResult[];
  passed: boolean;
  /** 调用用量：给了就出成本段（只有真机实测才有） */
  usage?: TokenUsage[];
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  let shared = 0;
  a.forEach((v) => {
    if (b.has(v)) shared += 1;
  });
  return shared / union.size;
}

/** 只认读写的内存仓储：评测要换 provider，所以不复用固定桩 provider 的演示服务。 */
function createEvalStore(sheet: SheetRecord): ServiceStore {
  let latest: ChecklistRecord | undefined;
  const outbound: OutboundRecordRecord[] = [];
  return {
    getDemandSheet: (id) => (id === sheet.id ? sheet : undefined),
    latestChecklist: (demandSheetId) => (latest?.demandSheetId === demandSheetId ? latest : undefined),
    listSiteRecords: () => [],
    createOutboundRecord: (record) => {
      outbound.push(record);
      return record;
    },
    createChecklist: (input) => {
      const record: ChecklistRecord = {
        id: `eval-${input.demandSheetId}`,
        demandSheetId: input.demandSheetId,
        createdAt: '2000-01-01T00:00:00.000Z',
        model: input.model,
        ruleVersion: input.ruleVersion,
        policyName: input.policyName,
        policyVersion: input.policyVersion,
        degraded: input.degraded,
        understanding: input.understanding,
        dropped: input.checklist.dropped,
        items: input.checklist.items.map((i) => ({ ...i, removed: false })),
      };
      latest = record;
      return record;
    },
  };
}

export interface EvalRunOptions {
  label: string;
  cases: EvalCase[];
  provider: ModelProvider;
  /** 每个用例采样几次；>1 时同时给出稳定性（真机实测用） */
  runs?: number;
  /** 判不判通过：离线回归判（判死项必须为 0），真机实测只测量 */
  gated: boolean;
  /** 调用用量的收集器：调用方建一个空数组，接上 provider 的 onUsage，报告就会出成本段 */
  usage?: TokenUsage[];
}

export async function runEval(options: EvalRunOptions): Promise<EvalReport> {
  const runs = options.runs ?? 1;
  const results: EvalCaseResult[] = [];

  for (const evalCase of options.cases) {
    const sheet: SheetRecord = {
      id: evalCase.id,
      demandName: evalCase.demandName,
      schemaVersion: '1.0',
      submittedAt: '2000-01-01T00:00:00.000Z',
      source: 'file',
      submittedBy: null,
      createdAt: '2000-01-01T00:00:00.000Z',
      payload: evalCase.model,
      aiMarks: [],
    };
    const samples: EvalMetrics[] = [];
    const itemKeys: Set<string>[] = [];
    const objectSets: Set<string>[] = [];

    for (let run = 0; run < runs; run += 1) {
      const store = createEvalStore(sheet);
      const result = await generateChecklist(store, options.provider, {
        demandSheetId: evalCase.id,
        operator: 'eval',
        at: '2000-01-01T00:00:00.000Z',
      });
      samples.push(
        scoreChecklist({
          model: evalCase.model,
          checklist: result.checklist,
          expectation: evalCase.expectation,
          degraded: result.degraded,
          issues: result.issues,
        }),
      );
      itemKeys.push(new Set(result.checklist.items.map((i) => i.key)));
      objectSets.push(new Set(result.checklist.items.map((i) => i.object)));
    }

    const stability: EvalStability | undefined =
      runs > 1
        ? {
            runs,
            must: {
              min: Math.min(...samples.map((s) => s.must)),
              max: Math.max(...samples.map((s) => s.must)),
            },
            total: {
              min: Math.min(...samples.map((s) => s.items)),
              max: Math.max(...samples.map((s) => s.items)),
            },
            itemJaccard: averagePairs(itemKeys),
            unstableObjects: [...objectSets.reduce((acc, set) => {
              set.forEach((o) => acc.add(o));
              return acc;
            }, new Set<string>())].filter((object) => objectSets.some((set) => !set.has(object))),
          }
        : undefined;

    results.push({ id: evalCase.id, intent: evalCase.intent, samples, stability });
  }

  return {
    label: options.label,
    provider: options.provider.name,
    runs,
    gated: options.gated,
    results,
    passed: results.every((r) => r.samples.every((s) => s.failures.length === 0)),
    usage: options.usage,
  };
}

function averagePairs(sets: Set<string>[]): number {
  let pairs = 0;
  let sum = 0;
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      sum += jaccard(sets[i]!, sets[j]!);
      pairs += 1;
    }
  }
  return pairs === 0 ? 1 : Number((sum / pairs).toFixed(3));
}

/** 报告刻意不带时间戳：重跑不改文件，才好当作回归基线提交。 */
export function renderReport(report: EvalReport): string {
  const lines: string[] = [];
  const failedCases = report.results.filter((r) => r.samples.some((s) => s.failures.length)).length;
  lines.push(`# 清单质量评估 · ${report.label}`);
  lines.push('');
  lines.push(`- 用例数：${report.results.length}（每个采样 ${report.runs} 次）`);
  lines.push(`- provider：\`${report.provider}\``);
  lines.push(
    report.gated
      ? `- 结论：${report.passed ? '**通过**' : '**未通过**'}`
      : `- 结论：本次是**测量**，不设通过阈值——${failedCases} 个用例有期望未覆盖，逐条进 \`evals/badcases.md\` 判断`,
  );
  lines.push('');
  lines.push('判据见 `evals/rubric.md`：只判确定性的部分（可溯源、重复、降级、期望覆盖），');
  lines.push('条数与分区分布只报数不判死。');
  lines.push('');

  lines.push('## 逐用例');
  lines.push('');
  lines.push('| 用例 | 考什么 | 条目 | 必问 | 建议问 | 合并 | 新对象 | 降级 | 判定 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  report.results.forEach((result) => {
    const s = result.samples[0]!;
    const failed = result.samples.filter((x) => x.failures.length).length;
    lines.push(
      `| \`${result.id}\` | ${result.intent} | ${s.items} | ${s.must} | ${s.suggest} | ${s.bySource.both} | ${s.novelObjects.length} | ${s.degraded ? '是' : '否'} | ${failed ? `不通过 ${failed}/${result.samples.length}` : '通过'} |`,
    );
  });
  lines.push('');
  if (report.runs > 1) {
    lines.push('> 表里的条目 / 必问 / 合并取自第 1 次采样，跨采样的区间见稳定性表。');
    lines.push('> 「不通过 x/y」= y 次采样里有 x 次没满足期望，判定看的是全部采样。');
    lines.push('');
  }

  const failed = report.results.filter((r) => r.samples.some((s) => s.failures.length));
  if (failed.length) {
    lines.push('## 未通过明细');
    lines.push('');
    failed.forEach((result) => {
      lines.push(`### \`${result.id}\``);
      lines.push('');
      result.samples.forEach((s, index) => {
        if (!s.failures.length) return;
        lines.push(`- 第 ${index + 1} 次采样`);
        s.failures.forEach((f) => {
          lines.push(`  - ${f}`);
        });
      });
      lines.push('');
    });
  }

  const withStability = report.results.filter((r) => r.stability);
  if (withStability.length) {
    lines.push('## 稳定性（多次采样）');
    lines.push('');
    lines.push('| 用例 | 必问区间 | 条目区间 | 条目集合 Jaccard | 不是每次都出现的对象 |');
    lines.push('| --- | --- | --- | --- | --- |');
    withStability.forEach((result) => {
      const st = result.stability!;
      lines.push(
        `| \`${result.id}\` | ${st.must.min}–${st.must.max} | ${st.total.min}–${st.total.max} | ${st.itemJaccard} | ${st.unstableObjects.join('、') || '无'} |`,
      );
    });
    lines.push('');
  }

  lines.push('## 观测项（不判死）');
  lines.push('');
  lines.push('| 用例 | 通用清单外的新对象 | 同对象跨分区 | 房主暴露的不确定项（接住/总数） |');
  lines.push('| --- | --- | --- | --- |');
  report.results.forEach((result) => {
    const s = result.samples[0]!;
    const multi = s.multiSpaceObjects.map((m) => `${m.object}（${m.spaces.join('/')}）`).join('、') || '无';
    lines.push(
      `| \`${result.id}\` | ${s.novelObjects.join('、') || '无'} | ${multi} | ${s.ruleCovered}/${s.ruleCandidates} |`,
    );
  });
  lines.push('');
  lines.push('> 「房主暴露的不确定项」= 空缺的推荐填写项 + 房主答「不清楚」的项。答「不清楚」的项会进清单');
  lines.push('> （能落到通用清单的并成一条，落不到的用 field-spec 的待定项资产）；空缺的推荐填写项仍只在');
  lines.push('> 表格理解的待确认项里，属于口径差异——见 `evals/rubric.md` 第六节。');
  lines.push('');

  const uncovered = report.results.flatMap((result) =>
    result.samples[0]!.ruleUncovered.map((u) => ({ caseId: result.id, ...u })),
  );
  if (uncovered.length) {
    lines.push('### 房主暴露、但清单没接住的项');
    lines.push('');
    lines.push('| 用例 | 字段 | 为什么算「房主已经暴露」 |');
    lines.push('| --- | --- | --- |');
    uncovered.forEach((u) => {
      lines.push(`| \`${u.caseId}\` | ${u.label}（\`${u.fieldKey}\`） | ${u.why} |`);
    });
    lines.push('');
  }

  if (report.usage?.length) {
    const calls = report.usage.length;
    const sum = (pick: (u: TokenUsage) => number) => report.usage!.reduce((acc, u) => acc + pick(u), 0);
    const prompt = sum((u) => u.promptTokens);
    const completion = sum((u) => u.completionTokens);
    const cached = sum((u) => u.cachedPromptTokens);
    const avg = (total: number) => Math.round(total / calls);
    lines.push('## 成本口径');
    lines.push('');
    lines.push(`- 调用次数：${calls}（用例 ${report.results.length} 个 × 采样 ${report.runs} 次；降级才会重试第二次）`);
    lines.push(`- 输入 token：合计 ${prompt} · 单次均值 ${avg(prompt)}`);
    lines.push(`- 输出 token：合计 ${completion} · 单次均值 ${avg(completion)}`);
    lines.push(`- 前缀缓存命中：${cached} / ${prompt}（${prompt ? Math.round((cached / prompt) * 100) : 0}%）`);
    lines.push('');
    lines.push('> **单份解读 = 1 次调用**（模型两道红线没过才重试一次，重试的用量也计在这里）。');
    lines.push('> 这里只记 token，不记钱：单价随官方调整，写死会把报告写过期。');
    lines.push('> 换算成钱与盈亏平衡见 `research/问需_成本与ROI模型_V1.md`。');
    lines.push('');
  }

  return lines.join('\n');
}
