/**
 * 清单质量评估（技术方案 4.7、产品文档第十章）。
 *
 * 两段，共用同一套评分器与同一份用例：
 *
 * 1. **离线回归**（每次提交都跑）：用种子的录制输出，断言实现没退化——可溯源、无重复、
 *    期望全覆盖。这是「一次改动 = 一次提交 + 一次种子场景回归」里的那个回归。
 * 2. **真实模型实测**（有 DEEPSEEK_API_KEY 才跑）：跑全部用例并各采样 3 次，
 *    出报告与稳定性数据。**它只测量、不设通过阈值**——阈值要等基线出来（产品文档 7.5），
 *    所以这里只守一条红线：不许出现指不到字段的条目。
 *
 * 报告落在 `evals/report-offline.md` 与 `evals/report-model.md`；离线报告不带时间戳，
 * 重跑不改文件，可以当基线提交。
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFixtureProvider, renderReport, runEval } from '@zx/service';
import { EVAL_CASES, RECORDED_CASES } from '../../evals/cases';
import { createDeepSeekProvider } from '../../services/api/src/model/deepseek';
import seed from '../../services/api/seed/demand-sheets.json';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const write = (file: string, text: string) => fs.writeFileSync(path.join(ROOT, 'evals', file), text, 'utf8');

const API_KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';

describe('清单质量：离线回归', () => {
  it('种子场景不退化，并写出回归报告', async () => {
    const provider = createFixtureProvider(seed as never, 'recorded');
    const report = await runEval({ label: '离线回归 · 录制输出', cases: RECORDED_CASES, provider });
    write('report-offline.md', renderReport(report));

    const detail = report.results
      .flatMap((r) => r.samples.flatMap((s) => s.failures.map((f) => `${r.id}：${f}`)))
      .join('\n');
    expect(report.results.length, '录制的用例数').toBe(RECORDED_CASES.length);
    expect(detail, `回归失败：\n${detail}`).toBe('');
    expect(report.passed).toBe(true);
  });
});

describe.skipIf(!API_KEY)('清单质量：真实模型实测', () => {
  it('全部用例各采样三次，出报告与稳定性数据', async () => {
    const provider = createDeepSeekProvider({ apiKey: API_KEY!, model: MODEL });
    const report = await runEval({
      label: `真实模型 · ${MODEL}`,
      cases: EVAL_CASES,
      provider,
      runs: 3,
    });
    write('report-model.md', renderReport(report));

    // 只守红线：清单里不许出现指不到字段的条目。覆盖率与档位波动是测量结果，
    // 进 badcases.md 判断，不在这里判死。
    const untraceable = report.results.flatMap((r) =>
      r.samples.flatMap((s) => s.untraceable.map((o) => `${r.id}：${o}`)),
    );
    expect(untraceable, `出现指不到字段的条目：\n${untraceable.join('\n')}`).toEqual([]);
    // 13 个用例 × 3 次采样 = 39 次调用；实测单次 4–19s，降级还要重试一次，
    // 所以超时按 30 分钟给，别让跑了一半的实测被掐掉。
  }, 1_800_000);
});
