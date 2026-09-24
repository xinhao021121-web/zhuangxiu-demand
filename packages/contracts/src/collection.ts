/**
 * 采集通道契约（技术方案 5.3）：房主不是用户，所以这条路与内部通道在路由层分开——
 * 独立前缀 `/a`，独立的最小化鉴权（匿名会话换一个会话令牌），只有写入口，没有任何读接口。
 */

import { z } from 'zod';

/**
 * 匿名会话：采集端先换一个令牌，随后带着它提交。
 *
 * 与内部 token 是两把钥匙（密钥与 scope 都不同），互相拿着也调不通对面的接口——
 * 「房主数据对外不可读」因此是一次结构性保证，不是一句约定。
 */
export const CollectionSessionSchema = z.object({
  token: z.string().min(1),
  /** 令牌到期时间（ISO）：采集端不用管，过期后重新换一个即可 */
  expiresAt: z.string(),
});

/**
 * 提交回执。`replay` 为 true 表示这次是重试、服务端认出是同一份需求单：落库只有一份，
 * 但房主看到的仍然是「提交成功」，不必自己判断该不该重来。
 */
export const CollectionSubmitSchema = z.object({
  id: z.string(),
  submittedAt: z.string(),
  /** 这次真正写进去的埋点条数（重试时为 0） */
  acceptedEvents: z.number().int().nonnegative(),
  replay: z.boolean(),
});

export type CollectionSession = z.infer<typeof CollectionSessionSchema>;
export type CollectionSubmit = z.infer<typeof CollectionSubmitSchema>;
