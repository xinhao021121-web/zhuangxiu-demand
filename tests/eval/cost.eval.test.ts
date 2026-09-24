// 成本口径实测：每个用例跑一次，记下每次调用的 token 用量，写 evals/report-cost.md。
//
// 为什么单独一个文件：清单质量的基线报告不能被成本实测的另一次采样覆盖——采样之间有方差，
// 而 badcases 里引用的数字要对得上那份报告。
//
// 这里只量 token，不算钱：单价随官方调整，写死会把报告写过期。换算与盈亏平衡见
// research/问需_成本与ROI模型_V1.md。

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderReport, runEval } from '@zx/service';
import type { TokenUsage } from '@zx/service';
import { EVAL_CASES } from '../../evals/cases';
import { createDeepSeekProvider } from '../../services/api/src/model/deepseek';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const API_KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';

describe.skipIf(!API_KEY)('成本口径：真实模型实测', () => {
  it('每个用例跑一次，记下 token 用量与缓存命中', async () => {
    const usage: TokenUsage[] = [];
    const provider = createDeepSeekProvider({
      apiKey: API_KEY!,
      model: MODEL,
      onUsage: (u) => usage.push(u),
    });
    const report = await runEval({
      label: `成本口径 · ${MODEL}`,
      cases: EVAL_CASES,
      provider,
      runs: 1,
      gated: false,
      usage,
    });
    fs.writeFileSync(path.join(ROOT, 'evals', 'report-cost.md'), renderReport(report), 'utf8');

    // 一次解读 = 一次调用；只有降级的用例才会第二次，所以条数不会少于用例数
    expect(usage.length).toBeGreaterThanOrEqual(EVAL_CASES.length);
    expect(usage.every((u) => u.promptTokens > 0)).toBe(true);
  }, 900_000);
});
