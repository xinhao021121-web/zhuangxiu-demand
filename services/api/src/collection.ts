/**
 * 采集通道（技术方案 5.3）：房主提交需求单的那条路。
 *
 * 与内部通道的边界在**路由层**就分开：独立前缀 `/a`、独立密钥与 scope 的匿名会话，
 * 而且这条子应用只有两个写入口——换会话、提交需求单，一个读接口都没有。
 * 「房主数据对外不可读」因此是结构性的，不是靠业务代码里的判断守住的。
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { DemandSheetImportSchema } from '@zx/contracts';
import { signToken, verifyToken } from './auth';
import { toIsoAt } from './events';
import type { CollectionTokenPayload } from './auth';
import type { ApiEnv } from './env';
import type { Repo } from './repo';

export interface CollectionChannelDeps {
  repo: Repo;
  env: ApiEnv;
  /** 注入时钟，测试里好复现 */
  now?: () => string;
}

export function createCollectionChannel(deps: CollectionChannelDeps) {
  const { repo, env } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const channel = new Hono();

  /*
   * 换会话：注册在守卫之前，所以它自己是唯一不要令牌的入口。
   * V1 走匿名会话（技术方案待定项 1 的收敛）：小程序拿不到 code，微信登录换 session 留待有 appid 之后，
   * 那时只是把这里的入参从空换成 code，路由与权限结构不动。
   */
  channel.post('/session', (c) => {
    const exp = Math.floor(Date.now() / 1000) + env.collectionSessionTtlSeconds;
    const token = signToken({ sub: `anon:${randomUUID()}`, scope: 'collection', exp }, env.collectionSecret);
    return c.json({ token, expiresAt: new Date(exp * 1000).toISOString() });
  });

  /* 采集通道只认会话令牌：内部 token 是另一把钥匙、另一个 scope，拿到这里也不管用。 */
  channel.use('*', async (c, next) => {
    const token = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const session: CollectionTokenPayload | null = token
      ? (verifyToken(token, env.collectionSecret, 'collection') as CollectionTokenPayload | null)
      : null;
    if (!session) return c.json({ error: '会话无效' }, 401);
    await next();
  });

  channel.post('/demand-sheets', async (c) => {
    const parsed = DemandSheetImportSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: '需求单格式不对', issues: parsed.error.issues }, 400);
    const input = parsed.data;

    /*
     * 幂等：弱网下重试带的是同一个 submissionId，认出是同一份就不再落第二份。
     * 重放的回执只回客户端自己带上来的那两个值，不回库里的行——这条通道没有读接口，
     * 「回执」也不能变成读出别人数据的一个口子。
     */
    const id = input.submissionId ?? randomUUID();
    if (repo.getDemandSheet(id)) {
      return c.json({ id, submittedAt: input.submittedAt, acceptedEvents: 0, replay: true }, 200);
    }

    const sheet = repo.createDemandSheet({
      id,
      demandName: input.demandName,
      schemaVersion: input.schemaVersion,
      submittedAt: input.submittedAt,
      // 来源由通道决定，不认客户端写的是什么：这条路上来的就一定是房主提交的
      source: 'miniapp',
      // 房主不是用户：需求单不带提交人，读取与操作留痕都在内部通道那一侧
      submittedBy: null,
      payload: input.form,
      aiMarks: input.aiMarks,
    });

    // 提交随带的一整批埋点（技术方案 6.11）：采纳率、不感兴趣率、填写时长的分子分母都在这里
    const acceptedEvents = input.telemetry?.events.length
      ? repo.createEvents({
          demandSheetId: sheet.id,
          source: 'client',
          operator: null,
          batchId: input.telemetry.batchId,
          at: now(),
          events: input.telemetry.events.map((e) => ({
            name: e.name,
            at: toIsoAt(e.at, now()),
            props: e.props,
          })),
        })
      : 0;

    return c.json(
      { id: sheet.id, submittedAt: sheet.submittedAt, acceptedEvents, replay: false },
      201,
    );
  });

  /*
   * 兜底：这条通道上除了上面两个写入口，什么都不认。
   *
   * 写成兜底路由而不是 `notFound()`——父应用是靠 `route()` 挂上这条子应用的，而 `route()` 只搬路由、
   * 不搬子应用的 `notFound`；不兜住的话，请求会漏到内部通道的守卫那里，回一句「未授权」，
   * 边界就从路由层滑回了业务层。
   */
  channel.all('*', (c) => c.json({ error: '采集通道没有这个接口' }, 404));

  return channel;
}
