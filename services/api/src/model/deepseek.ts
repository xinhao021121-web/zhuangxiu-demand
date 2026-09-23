/**
 * DeepSeek adapter：官方 API 或私有化部署，两者 API 形态一致，只换这一层。
 *
 * 用 JSON Output，不解析自由文本（技术方案 4.7 第 1 条）；超时、重试与可中断由调用方管。
 */

import { UNDERSTAND_TASK } from './provider';
import type { ModelProvider, UnderstandRequest } from './provider';

const SYSTEM_PROMPT = `${UNDERSTAND_TASK}

只返回一个 JSON 对象，结构如下：
{
  "profile": [{ "label": "家庭", "text": "..." }],
  "demands": ["..."],
  "conflicts": [{ "label": "预算与配置", "text": "..." }],
  "derivedItems": [{
    "object": "核实对象",
    "question": "要当面问什么",
    "why": "依据",
    "onsiteChecks": ["现场要核实"],
    "relatedFieldIds": ["字段键"],
    "impact": ["feasibility"],
    "space": "归属分区，可省略"
  }]
}`;

export interface DeepSeekOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createDeepSeekProvider(options: DeepSeekOptions): ModelProvider {
  const baseUrl = options.baseUrl ?? 'https://api.deepseek.com';
  const model = options.model ?? 'deepseek-chat';
  const timeoutMs = options.timeoutMs ?? 120_000;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    name: `deepseek:${model}`,
    async understand(request: UnderstandRequest) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await doFetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${options.apiKey}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              {
                role: 'user',
                content: JSON.stringify({
                  task: request.task,
                  fields: request.fields.map((f) => ({ key: f.fieldKey, label: f.label, value: f.value })),
                }),
              },
            ],
          }),
        });
        if (!response.ok) {
          throw new Error(`DeepSeek 返回 ${response.status}`);
        }
        const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
        const content = body.choices?.[0]?.message?.content;
        if (!content) throw new Error('DeepSeek 返回里没有内容');
        return JSON.parse(content) as unknown;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
