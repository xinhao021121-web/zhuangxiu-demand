/**
 * DeepSeek adapter：官方 API 或私有化部署，两者 API 形态一致，只换这一层。
 *
 * 用 JSON Output，不解析自由文本（技术方案 4.7 第 1 条）；超时、重试与可中断由调用方管。
 */

import { SURVEY_OBJECTS_HINT, UNDERSTAND_TASK } from '@zx/service';
import type { ModelProvider, UnderstandRequest } from '@zx/service';

const SYSTEM_PROMPT = `${UNDERSTAND_TASK}

${SURVEY_OBJECTS_HINT}

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

/** 把模型偶尔裹上的 ```json 代码块剥掉：这是传输格式，不是自由文本解析。 */
function stripFence(content: string): string {
  return content
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
}

export interface DeepSeekOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  /** 输出上限：默认 4096 会把长需求单的 JSON 截断，这里给到模型支持的上限 */
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

export function createDeepSeekProvider(options: DeepSeekOptions): ModelProvider {
  const baseUrl = options.baseUrl ?? 'https://api.deepseek.com';
  const model = options.model ?? 'deepseek-chat';
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxTokens = options.maxTokens ?? 8192;
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
            max_tokens: maxTokens,
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
        const body = (await response.json()) as {
          choices?: { message?: { content?: string }; finish_reason?: string }[];
        };
        const choice = body.choices?.[0];
        const content = choice?.message?.content;
        if (!content) throw new Error('DeepSeek 返回里没有内容');
        if (choice?.finish_reason === 'length') {
          throw new Error('DeepSeek 输出被截断（finish_reason=length），调大 max_tokens 或减少一次外发的字段');
        }
        try {
          return JSON.parse(stripFence(content)) as unknown;
        } catch {
          throw new Error('DeepSeek 返回的不是 JSON：' + stripFence(content).slice(0, 120).replace(/\s+/g, ' '));
        }
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
