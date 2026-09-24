/**
 * 生成访谈现场要带的材料（《用户研究方案》6.2 里那几样还不存在的）：
 *   research/materials/分档卡片.html        16 张卡片，打印后剪开用，不带序号也不带档位
 *   research/materials/发现卡片判定材料.md   d1–d3 三个种子场景的发现卡片，验证 H12 用
 *
 * 为什么用脚本生成而不是手抄：卡片文字来自 `survey-checklist.json`，发现卡片来自规则引擎
 * （采集端跑的是同一份 `suggestionsOf`）。手抄会随资产改动失真，而这份材料一旦失真，
 * 访谈收集到的判断就没法与代码比对。
 *
 * 用法：pnpm run build:research
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SECTIONS,
  SURVEY_CHECKLIST,
  instanceName,
  isEmptyValue,
  labelOf,
  visibleFields,
} from '../packages/field-spec/src/index.ts';
import type { FieldValue, FormModel, InstanceState, SectionSpec } from '../packages/field-spec/src/index.ts';
import { suggestionsOf } from '../packages/rules/src/index.ts';
import type { Suggestion } from '../packages/rules/src/index.ts';
import seedSheets from '../services/api/seed/demand-sheets.json' with { type: 'json' };

const ROOT = path.resolve(import.meta.dirname, '..');
export const OUT_DIR = path.join(ROOT, 'research', 'materials');

interface SeedSheet {
  id: string;
  demandName: string;
  submittedAt: string;
  form: FormModel;
}

const SHEETS = seedSheets as unknown as SeedSheet[];
/** 每个场景在 5 分钟版里抽几张：30 分钟的访谈排不下 30 多道判断题（见执行包的 Q12） */
const SAMPLE_PER_SHEET = 8;

const show = (v: FieldValue): string => {
  if (Array.isArray(v)) return v.join('、');
  if (v === undefined || v === null || v === '') return '';
  return String(v);
};

/* ---------------- 材料一：16 张分档卡片 ---------------- */

/**
 * 每张卡片只有一行字（资产里的 `item`），没有序号、没有档位、没有来源。
 * 序号与档位一旦印上去，这个任务就退化成核对答案——方案 6.2 与 7.2 都写明了这一点。
 */
export function tierCardsHtml(items: string[] = SURVEY_CHECKLIST.map((s) => s.item)): string {
  const cards = items.map((text) => `      <div class="card"><span>${text}</span></div>`).join('\n');
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>问需 · 分档卡片（16 张）</title>',
    '<style>',
    '  @page { size: A4 portrait; margin: 12mm; }',
    '  * { box-sizing: border-box; }',
    '  body { margin: 0; font: 15px/1.5 "PingFang SC", "Microsoft YaHei", sans-serif; color: #1e2430; }',
    '  .tip { border: 1px dashed #b9c1cc; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; font-size: 13px; line-height: 1.7; }',
    '  .tip b { color: #b0392f; }',
    '  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7mm; }',
    '  .card { border: 1px solid #6b7480; border-radius: 6px; min-height: 60mm; display: flex;',
    '          align-items: center; justify-content: center; text-align: center; padding: 7mm; }',
    '  .card span { font-size: 19px; font-weight: 600; letter-spacing: .02em; }',
    '  @media print { .tip { display: none; } }',
    '</style>',
    '</head>',
    '<body>',
    '  <div class="tip">',
    `    <b>这张纸不要交给受访者看。</b>剪开成 ${items.length} 张，只说任务：「这里 ${items.length} 张卡片，都是量房现场要核实的内容，请分成两堆：一堆是不问就会做错、要返工的；一堆是问一下更好的。」`,
    '    卡片上没有序号也没有档位，这是刻意的——印上去，这个任务就变成核对答案了。',
    '    分完追问：哪张犹豫最久、为什么、如果现场只剩 20 分钟你先问哪几张、有没有哪张会因为情况不同换堆。',
    '  </div>',
    '  <div class="grid">',
    cards,
    '  </div>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/* ---------------- 材料二：发现卡片判定材料 ---------------- */

/** 把一份需求单渲染成「房主填了什么」：按 13 个大类，标签：取值，空的跳过。 */
export function filledForm(model: FormModel): string {
  const lines: string[] = [];
  const row = (label: string, value: FieldValue) => {
    if (!isEmptyValue(value)) lines.push(`- ${label}：${show(value)}`);
  };
  const instanceRows = (section: SectionSpec, inst: InstanceState) => {
    visibleFields(section.name, inst).forEach((f) => row(`${instanceName(model, inst)} · ${f.label}`, inst.values[f.id]));
  };

  SECTIONS.forEach((section) => {
    const before = lines.length;
    if (section.scope === '固定') {
      section.fields.forEach((f) => row(f.label, model.values[f.id]));
    } else {
      (model.instances[section.name] ?? []).forEach((inst) => instanceRows(section, inst));
    }
    if (lines.length > before) lines.splice(before, 0, `**${section.name}**`);
  });
  return lines.join('\n');
}

const KIND_LABEL: Record<string, string> = { discover: '需求发现', risk: '风险提醒', fill: '信息补充' };

/** 等距抽样：按引擎给的顺序每隔 k 条取一条。按优先级取前几条会让命中率虚高。 */
export function sampleSuggestions(all: Suggestion[], size = SAMPLE_PER_SHEET): Suggestion[] {
  if (all.length <= size) return all;
  const step = Math.ceil(all.length / size);
  return all.filter((_, i) => i % step === 0).slice(0, size);
}

export function suggestionTable(items: Suggestion[], withVerdict: boolean): string {
  const head = withVerdict
    ? '| # | 卡片标题 | 为什么给这条（系统原话） | 建议写入 | 对这位客户成立吗 |'
    : '| # | 卡片标题 | 为什么给这条（系统原话） | 建议写入 |';
  const divider = withVerdict ? '| --- | --- | --- | --- | --- |' : '| --- | --- | --- | --- |';
  const rows = items.map((s, i) => {
    const target = s.instKey ? `${s.instKey} · ${labelOf(s.target)}` : labelOf(s.target);
    const cells = `| ${i + 1} | ${s.title}（${KIND_LABEL[s.kind] ?? s.kind}） | ${s.why} | ${target} |`;
    return withVerdict ? `${cells} |` : cells;
  });
  return [head, divider, ...rows].join('\n');
}

export function discoverySheet(sheets: SeedSheet[] = SHEETS): string {
  const sampledTotal = sheets.reduce((sum, sheet) => sum + sampleSuggestions(suggestionsOf(sheet.form)).length, 0);
  const blocks = sheets.map((sheet) => {
    const all = suggestionsOf(sheet.form);
    const sampled = sampleSuggestions(all);
    return [
      `## ${sheet.demandName}（${sheet.id}）`,
      '',
      `提交时间：${sheet.submittedAt}`,
      '',
      '### 一、这位房主填了什么',
      '',
      filledForm(sheet.form),
      '',
      `### 二、系统给出的发现（共 ${all.length} 条）`,
      '',
      '> 只念卡片，不解释规则；他一问「为什么给这条」，就念「为什么给这条」那一列，那是系统原话。',
      '',
      suggestionTable(all, true),
      '',
      `### 三、这一组 ${sampled.length} 张（5 分钟版用）`,
      '',
      sampled.length === all.length
        ? `> 这个场景一共只有 ${all.length} 条，全部判一遍。`
        : `> 30 分钟的访谈排不下 ${all.length} 条，只判这一组：等距抽样（每隔 ${Math.ceil(all.length / sampled.length)} 条取一条）。`,
      sampled.length === all.length ? '' : '> 不按优先级取前几条，否则拿到的全是规则最有把握的那些，命中率会虚高。',
      '',
      suggestionTable(sampled, true),
      '',
      '---',
      '',
    ].join('\n');
  });

  return [
    '# 问需 · 发现卡片判定材料（H12）',
    '',
    '| 项目 | 内容 |',
    '| --- | --- |',
    '| 用途 | 请设计师判断：系统给的这些发现，「对这位客户成立吗」 |',
    '| 对应方案 | 《用户研究方案》H12，执行包的「Q12 发现卡片判定」 |',
    `| 样本 | 三个种子场景，每个最多取 ${SAMPLE_PER_SHEET} 张，共 ${sampledTotal} 张 |`,
    '| 判定标准 | 每位设计师认为 ≥ 1/3 成立 → H12 成立 |',
    '| 数据来源 | `services/api/seed/demand-sheets.json` + 规则引擎 `suggestionsOf`（采集端跑的是同一份） |',
    '',
    '**这份材料是脚本生成的**：`pnpm run build:research`。改了规则或种子数据要重新生成，',
    '否则访谈收集到的判断就跟代码对不上了（单测会卡住这件事）。',
    '',
    '**怎么用**：先给设计师看这位房主填的内容（一、），再一条条念发现（二、），让他当场判断。',
    '不解释规则怎么算的。',
    '',
    '---',
    '',
    ...blocks,
    '**文档结束** | 问需 · 发现卡片判定材料（由 `pnpm run build:research` 生成）',
    '',
  ].join('\n');
}

/* ---------------- 落盘 ---------------- */

export function writeMaterials(dir = OUT_DIR): string[] {
  fs.mkdirSync(dir, { recursive: true });
  const files: [string, string][] = [
    ['分档卡片.html', tierCardsHtml()],
    ['发现卡片判定材料.md', discoverySheet()],
  ];
  files.forEach(([name, body]) => fs.writeFileSync(path.join(dir, name), body, 'utf8'));
  return files.map(([name]) => path.join(dir, name));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeMaterials().forEach((file) => console.log(`已生成 ${path.relative(ROOT, file)}`));
}
