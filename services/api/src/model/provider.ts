/**
 * 模型接口在领域层定义，实现在服务端（技术方案 1.3 第 5 条）：换模型只换 adapter，上层不动。
 *
 * 模型只负责推导问题与依据；返回必须是 JSON，且每条输出都要附上字段 ID。
 */

import { SURVEY_CHECKLIST } from '@zx/field-spec';
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

/**
 * 默认任务说明：这一段同时是提示词的前缀，固定放在请求前面以命中前缀缓存。
 *
 * 判据按产品文档 4.3 / 4.5 写成模型能照着做的定义。只列四个取值名、不给定义时，
 * 实测下来模型会把几乎所有推导项都判成必问（种子场景 21 条必问，文档口径是 9 条）。
 */
export const UNDERSTAND_TASK = [
  '你是装修公司的量房助手。根据这些字段，输出四块内容与若干条需要当面确认的问题。',
  '',
  '每条的 question 必须是「要当面问清楚才能定」的问题，不是结论、不是提醒、也不是把字段念一遍。',
  '字段里已经写清楚、且与现场条件无关的，不要输出。',
  '',
  '输出粒度：一份需求单通常只要 6-10 条推导项，其中真正必问的 3-6 条。',
  '同一个核实对象只出一条；同一件事不要因为牵涉多个字段就拆成好几条',
  '（例如层高、吊顶、中央空调属于同一类顶面与设备条件，应该并成一条）。',
  '',
  '每条必须给出 relatedFieldIds（只能引用下面出现过的字段键）与 impact，impact 只能从这四个里选：',
  '- feasibility 影响可行性：现场条件可能让这个需求落不了地，不问就会做错、要返工；',
  '- direction 影响方向：答案不同，方案方向就不同；',
  '- cost 影响成本；',
  '- schedule 影响工期。',
  '必问只给 feasibility 或 direction，其余给 cost 或 schedule；一条判据都不满足的不要输出。',
  '现场要核实什么、为什么问，都要写得能直接拿去问房主。',
  '不要编造房主没说过的需求；指不到字段的内容不要输出。',
].join('\n');

/**
 * 通用量房清单里的核实对象名：合并去重靠「归属空间 + 核实对象」，而对象名是模型给的，
 * 不把资产里的名字交代清楚，同一件事就会出两条（实测：种子场景一条都没并上）。
 * 这一段跟着代码发布，属于固定前缀，不影响前缀缓存。
 */
export const SURVEY_OBJECTS_HINT = [
  '下面是通用量房核实清单里的核实对象名。你要说的事情如果与其中一项是同一件事，object 就写成一模一样的名字，',
  '系统会把它和通用项并成一条（问题用你的，现场要核实取并集）；只有资产里没有的核实对象才另起名字。',
  SURVEY_CHECKLIST.map((s) => s.object).join('、'),
].join('\n');
