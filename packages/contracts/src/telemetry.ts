/**
 * 埋点上报契约（技术方案 6.11）。
 *
 * 事件名与字段的单一来源是 `@zx/data` 的 `EVENT_NAMES`——采集端按它记录，这里按同一份
 * 清单校验，指标按同一个名字取数。契约里只做「结构 + 名字」的校验，不重定义一份清单，
 * 否则两端会各飘各的。
 */

import { z } from 'zod';
import { EVENT_NAMES } from '@zx/data';

export const TrackEventSchema = z.object({
  name: z.enum(EVENT_NAMES),
  /** 客户端时钟（毫秒）；落库时换算成 ISO，填写时长这类跨事件差值用它算 */
  at: z.number(),
  /** 报表取数用的字段（每个事件带什么，见 `@zx/data` 的 events.ts 注释） */
  props: z.record(z.string(), z.unknown()).optional(),
});

/**
 * 一次上报：客户端先把事件攒在本机，随提交或断网重连一起发。
 *
 * 幂等靠 `batchId` + 事件在批内的序号：断网重试会带同一个 batchId，服务端只落第一次。
 * 这比逐条生成 id 省事，也更贴合真实失败形态——重试的是整批，不是单条。
 */
export const EventBatchSchema = z.object({
  batchId: z.string().min(1),
  events: z.array(TrackEventSchema).max(500),
});

/**
 * 落库之后的事件：服务端补上来源、操作人、批次，客户端时钟也换算成 ISO（查问题时按它读）。
 * 与上报体是两个形状：上报的是客户端原始记录，落库的是换算与补充之后的那一条。
 */
export const StoredEventSchema = z.object({
  id: z.string(),
  demandSheetId: z.string(),
  name: z.enum(EVENT_NAMES),
  at: z.string(),
  props: z.record(z.string(), z.unknown()),
  source: z.enum(['client', 'server']),
  operator: z.string().nullable(),
  batchId: z.string().nullable(),
  /** 批内序号：与 batchId 一起构成幂等键 */
  seq: z.number().int().nonnegative(),
});

export type TrackEventContract = z.infer<typeof TrackEventSchema>;
export type EventBatchContract = z.infer<typeof EventBatchSchema>;
export type StoredEventContract = z.infer<typeof StoredEventSchema>;
