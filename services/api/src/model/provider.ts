/**
 * 模型接口在领域层定义，实现在服务端（技术方案 1.3 第 5 条）：换模型只换 adapter，上层不动。
 *
 * 模型只负责推导问题与依据；返回必须是 JSON，且每条输出都要附上字段 ID。
 */

import type { OutboundField } from '@zx/redact';

export interface UnderstandRequest {
  demandSheetId: string;
  /** 脱敏之后、真正要外发的字段 */
  fields: OutboundField[];
  task: string;
}

export interface ModelProvider {
  readonly name: string;
  understand(request: UnderstandRequest): Promise<unknown>;
}

/** 默认任务说明：这一段同时是提示词的前缀，固定放在请求前面以命中前缀缓存。 */
export const UNDERSTAND_TASK = [
  '你是装修公司的量房助手。根据这些字段，输出四块内容与若干条需要当面确认的问题。',
  '每条问题必须给出 relatedFieldIds（只能引用下面出现过的字段键）与 impact（feasibility/direction/cost/schedule）。',
  '指不到字段的内容不要输出；不要编造房主没说过的需求。',
].join('\n');
