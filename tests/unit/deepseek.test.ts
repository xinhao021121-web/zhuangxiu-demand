// DeepSeek adapter 的传输层测试。
//
// 真机实测（pnpm run eval:model）跑的就是这一层：请求怎么拼、返回怎么解析、失败怎么报。
// 这几条不测通，真机跑失败时分不清是模型不行还是代码不行——两边都要烧掉一次调用额度。
//
// 用 adapter 自己留的 fetchImpl 注入假 fetch，不发真实请求。

import { describe, expect, it } from 'vitest';
import type { OutboundField } from '@zx/redact';
import { createDeepSeekProvider } from '../../services/api/src/model/deepseek';

const FIELDS: OutboundField[] = [
  { fieldKey: 'kt_form', label: '厨房形式', value: '开放式', tier: 'raw', hits: [] },
  { fieldKey: 'kt_freq', label: '下厨频率', value: '经常', tier: 'raw', hits: [] },
];

const request = { demandSheetId: 'd1', task: '任务说明', fields: FIELDS };

const reply = (content: string, finishReason = 'stop') =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

interface Sent {
  model: string;
  max_tokens: number;
  response_format: unknown;
  messages: { role: string; content: string }[];
}

describe('DeepSeek adapter', () => {
  it('请求带上核实对象名与字段，并要求 JSON 输出', async () => {
    let sent: Sent | undefined;
    const provider = createDeepSeekProvider({
      apiKey: 'test-key',
      fetchImpl: (async (_url: string, init: { body: string }) => {
        sent = JSON.parse(init.body) as Sent;
        return reply('{"profile":[]}');
      }) as unknown as typeof fetch,
    });

    const result = await provider.understand(request);

    expect(result).toEqual({ profile: [] });
    expect(sent!.model).toBe('deepseek-chat');
    expect(sent!.response_format).toEqual({ type: 'json_object' });
    expect(sent!.max_tokens).toBeGreaterThan(4096); // 默认 4096 会把长需求单的 JSON 截断
    expect(sent!.messages[0]!.role).toBe('system');
    // 注意：adapter 目前忽略 request.task，系统提示用的是它自己那份默认任务说明
    // （流水线传的也是同一份常量，所以行为一致）。要改成听调用方的，这一条要一起改。
    expect(sent!.messages[0]!.content).toContain('你是装修公司的量房助手');
    // 核实对象名必须交代给模型，否则同一件事会出两条（技术方案 6.7）
    expect(sent!.messages[0]!.content).toContain('层高吊顶');
    // 输出结构要在系统提示里交代清楚：少给一块会被判结构不合法
    expect(sent!.messages[0]!.content).toContain('"derivedItems"');
    expect(sent!.messages[1]!.role).toBe('user');
    expect(JSON.parse(sent!.messages[1]!.content).fields).toEqual([
      { key: 'kt_form', label: '厨房形式', value: '开放式' },
      { key: 'kt_freq', label: '下厨频率', value: '经常' },
    ]);
  });

  it('模型把 JSON 裹进代码块时剥掉围栏，照常解析', async () => {
    const provider = createDeepSeekProvider({
      apiKey: 'test-key',
      fetchImpl: (async () => reply('```json\n{"profile":[{"label":"家庭","text":"三口之家"}]}\n```')) as unknown as typeof fetch,
    });
    await expect(provider.understand(request)).resolves.toEqual({
      profile: [{ label: '家庭', text: '三口之家' }],
    });
  });

  it('输出被上限截断时按可诊断的错误抛出，不把半截 JSON 往上送', async () => {
    const provider = createDeepSeekProvider({
      apiKey: 'test-key',
      fetchImpl: (async () => reply('{"profile":[{"label":"家', 'length')) as unknown as typeof fetch,
    });
    await expect(provider.understand(request)).rejects.toThrow(/截断/);
  });

  it('返回的不是 JSON 时抛出，并把开头一段带进错误信息', async () => {
    const provider = createDeepSeekProvider({
      apiKey: 'test-key',
      fetchImpl: (async () => reply('好的，我来分析一下这份需求单')) as unknown as typeof fetch,
    });
    await expect(provider.understand(request)).rejects.toThrow(/不是 JSON/);
  });

  it('HTTP 失败与空内容都抛出，降级交给上游的流水线', async () => {
    const failing = createDeepSeekProvider({
      apiKey: 'test-key',
      fetchImpl: (async () => new Response('限流', { status: 429 })) as unknown as typeof fetch,
    });
    await expect(failing.understand(request)).rejects.toThrow(/429/);

    const empty = createDeepSeekProvider({
      apiKey: 'test-key',
      fetchImpl: (async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })) as unknown as typeof fetch,
    });
    await expect(empty.understand(request)).rejects.toThrow(/没有内容/);
  });
});
