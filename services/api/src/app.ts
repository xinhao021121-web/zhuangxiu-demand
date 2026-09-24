/**
 * API 服务：只做编排与持久化，业务判断全在领域包里（技术方案 3.1 的分层纪律）。
 *
 * 生成清单放在服务端的三个理由（技术方案 4.4）：模型调用必须在服务端、外发记录要可审计、
 * 三个客户端拿到同一份清单不会因为各自计算而分叉。
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { buildChecklistMarkdown, buildSiteRecordMarkdown, siteStats } from '@zx/checklist';
import { previewOutbound, DEFAULT_POLICY } from '@zx/redact';
import { buildOverview } from '@zx/summary';
import {
  DemandSheetImportSchema,
  EventBatchSchema,
  LoginSchema,
  SiteRecordBatchSchema,
  UserCreateSchema,
  openApiDocument,
} from '@zx/contracts';
import type { User } from '@zx/contracts';
import { can, signToken, verifyToken } from './auth';
import {
  generateChecklist,
  toChecklistSummary,
  toChecklistView,
  toDetail,
  toDomainChecklist,
  toSummary,
} from '@zx/service';
import type { GenerateInput, ModelProvider } from '@zx/service';
import type { ApiEnv } from './env';
import type { Repo } from './repo';

type Env = { Variables: { user: User } };

export interface AppDeps {
  repo: Repo;
  provider: ModelProvider;
  env: ApiEnv;
  /** 注入时钟，测试里好复现 */
  now?: () => string;
}

export function createApp(deps: AppDeps) {
  const { repo, provider, env } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const app = new Hono<Env>();

  app.get('/health', (c) => c.json({ ok: true, model: provider.name }));
  app.get('/openapi.json', (c) => c.json(openApiDocument()));

  app.post('/auth/login', async (c) => {
    const parsed = LoginSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: '请求体不合法', issues: parsed.error.issues }, 400);
    const user = repo.findUserByPhone(parsed.data.phone);
    if (!user || parsed.data.code !== env.authCode) return c.json({ error: '手机号或验证码不对' }, 401);
    const token = signToken(
      { sub: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) + env.tokenTtlSeconds },
      env.tokenSecret,
    );
    return c.json({ token, user });
  });

  /* 未授权访问不返回任何数据：除了健康检查、契约与登录，一律先过 token。 */
  app.use('*', async (c, next) => {
    const token = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const payload = token ? verifyToken(token, env.tokenSecret) : null;
    const user = payload ? repo.findUserById(payload.sub) : undefined;
    if (!user) return c.json({ error: '未授权' }, 401);
    c.set('user', user);
    await next();
  });



  /* ---------------- 账号与角色（管理员） ---------------- */

  app.get('/users', (c) => {
    const user = c.get('user');
    if (!can(user, 'account:manage')) return c.json({ error: '没有这个权限' }, 403);
    return c.json(repo.listUsers());
  });

  app.post('/users', async (c) => {
    const user = c.get('user');
    if (!can(user, 'account:manage')) return c.json({ error: '没有这个权限' }, 403);
    const parsed = UserCreateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: '账号信息不合法', issues: parsed.error.issues }, 400);
    if (repo.findUserByPhone(parsed.data.phone)) return c.json({ error: '这个手机号已经存在' }, 409);
    const created = repo.createUser({
      id: parsed.data.id || randomUUID(),
      name: parsed.data.name,
      phone: parsed.data.phone,
      role: parsed.data.role,
      teamId: parsed.data.teamId,
    });
    return c.json(created, 201);
  });
  /* ---------------- 需求单 ---------------- */

  app.get('/demand-sheets', (c) => c.json(repo.listDemandSheets().map((s) => toSummary(repo, s))));

  app.post('/demand-sheets', async (c) => {
    const user = c.get('user');
    if (!can(user, 'demand-sheet:write')) return c.json({ error: '没有这个权限' }, 403);
    const parsed = DemandSheetImportSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: '需求单格式不对', issues: parsed.error.issues }, 400);
    const input = parsed.data;
    const sheet = repo.createDemandSheet({
      demandName: input.demandName,
      schemaVersion: input.schemaVersion,
      submittedAt: input.submittedAt,
      source: input.source,
      submittedBy: user.id,
      payload: input.form,
      aiMarks: input.aiMarks,
    });
    // 采集端随提交带出的埋点（技术方案 6.11）：采纳率、不感兴趣率、填写时长的分子分母都在这里
    if (input.telemetry?.events.length) {
      repo.createEvents({
        demandSheetId: sheet.id,
        source: 'client',
        operator: user.name,
        batchId: input.telemetry.batchId,
        at: now(),
        events: input.telemetry.events.map((e) => ({
          name: e.name,
          at: toIsoAt(e.at, now()),
          props: e.props,
        })),
      });
    }
    return c.json(toSummary(repo, sheet), 201);
  });

  app.get('/demand-sheets/:id', (c) => {
    const sheet = repo.getDemandSheet(c.req.param('id'));
    if (!sheet) return c.json({ error: '需求单不存在' }, 404);
    return c.json(toDetail(repo, sheet));
  });

  /* ---------------- 清单 ---------------- */

  app.post('/demand-sheets/:id/checklist', async (c) => {
    const user = c.get('user');
    if (!can(user, 'checklist:generate')) return c.json({ error: '没有这个权限' }, 403);
    const sheet = repo.getDemandSheet(c.req.param('id'));
    if (!sheet) return c.json({ error: '需求单不存在' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { selected?: Record<string, boolean> };
    const input: GenerateInput = {
      demandSheetId: sheet.id,
      operator: user.name,
      at: now(),
      selected: body.selected,
    };
    // 单份解读耗时的口径就是这一次生成的墙钟时间（技术方案 6.11）：没有别的表能承载它
    const startedAt = Date.now();
    const result = await generateChecklist(repo, provider, input);
    const stored = repo.getChecklist(result.checklistId);
    repo.createEvents({
      demandSheetId: sheet.id,
      source: 'server',
      operator: user.name,
      at: now(),
      events: [
        {
          name: 'checklist_generate',
          at: now(),
          props: {
            durationMs: Date.now() - startedAt,
            degraded: result.degraded,
            model: provider.name,
            items: result.checklist.counts.total,
            must: result.checklist.counts.must,
            suggest: result.checklist.counts.suggest,
          },
        },
      ],
    });
    return c.json(toChecklistView(stored!), 201);
  });

  app.get('/demand-sheets/:id/checklist', (c) => {
    const stored = repo.latestChecklist(c.req.param('id'));
    if (!stored) return c.json({ error: '这份需求单还没有生成清单' }, 404);
    return c.json(toChecklistView(stored));
  });

  app.get('/checklists/:id', (c) => {
    const stored = repo.getChecklist(c.req.param('id'));
    if (!stored) return c.json({ error: '清单不存在' }, 404);
    return c.json(toChecklistView(stored));
  });

  app.patch('/checklists/:id/items/:key', async (c) => {
    const user = c.get('user');
    const stored = repo.getChecklist(c.req.param('id'));
    if (!stored) return c.json({ error: '清单不存在' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { removed?: boolean };
    if (typeof body.removed !== 'boolean') return c.json({ error: '请求体要带 removed 布尔值' }, 400);
    const item = repo.setItemRemoved({
      checklistId: stored.id,
      itemKey: c.req.param('key'),
      removed: body.removed,
      operator: user.name,
      at: now(),
    });
    if (!item) return c.json({ error: '清单项不存在' }, 404);
    return c.json(item);
  });

  app.get('/checklists/:id/export', (c) => {
    const user = c.get('user');
    const stored = repo.getChecklist(c.req.param('id'));
    if (!stored) return c.json({ error: '清单不存在' }, 404);
    const sheet = repo.getDemandSheet(stored.demandSheetId)!;
    const md = buildChecklistMarkdown(toDomainChecklist(stored), {
      name: sheet.demandName,
      overview: buildOverview(sheet.payload, []),
      submitted: sheet.submittedAt,
    });
    // 导出是流程的终点：生成了却没导出，断点会停在这里（技术方案 6.11）
    repo.createEvents({
      demandSheetId: sheet.id,
      source: 'server',
      operator: user.name,
      at: now(),
      events: [{ name: 'checklist_export', at: now(), props: { items: stored.items.length } }],
    });
    return c.body(md, 200, { 'content-type': 'text/markdown; charset=utf-8' });
  });

  app.get('/demand-sheets/:id/outbound-records', (c) => {
    const user = c.get('user');
    if (!can(user, 'audit:read')) return c.json({ error: '没有这个权限' }, 403);
    const sheet = repo.getDemandSheet(c.req.param('id'));
    if (!sheet) return c.json({ error: '需求单不存在' }, 404);
    return c.json(repo.listOutboundRecords(sheet.id));
  });

  /* ---------------- 埋点 ---------------- */

  /*
   * 采集端的埋点先攒在房主手机上，随提交或断网重连整批上报（技术方案 6.11）。
   * 房主端那条通道（A4 采集通道）还没开，所以现在只有内部 token 能调；通道开了之后
   * 鉴权换成匿名会话，这一段的校验与落库不动。
   */
  app.post('/demand-sheets/:id/events', async (c) => {
    const user = c.get('user');
    if (!can(user, 'demand-sheet:write')) return c.json({ error: '没有这个权限' }, 403);
    const sheet = repo.getDemandSheet(c.req.param('id'));
    if (!sheet) return c.json({ error: '需求单不存在' }, 404);
    const parsed = EventBatchSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: '事件格式不对', issues: parsed.error.issues }, 400);
    const accepted = repo.createEvents({
      demandSheetId: sheet.id,
      source: 'client',
      operator: user.name,
      batchId: parsed.data.batchId,
      at: now(),
      events: parsed.data.events.map((e) => ({ name: e.name, at: toIsoAt(e.at, now()), props: e.props })),
    });
    return c.json({ accepted, duplicates: parsed.data.events.length - accepted }, 201);
  });

  /* 埋点查得到：指标是拿它算的，出问题时也要能顺着看到原始事件。 */
  app.get('/demand-sheets/:id/events', (c) => {
    const user = c.get('user');
    if (!can(user, 'audit:read')) return c.json({ error: '没有这个权限' }, 403);
    const sheet = repo.getDemandSheet(c.req.param('id'));
    if (!sheet) return c.json({ error: '需求单不存在' }, 404);
    return c.json(repo.listEvents(sheet.id));
  });

  /* ---------------- 现场记录 ---------------- */

  app.get('/checklists/:id/site-records', (c) => {
    const stored = repo.getChecklist(c.req.param('id'));
    if (!stored) return c.json({ error: '清单不存在' }, 404);
    const records = repo.listSiteRecords(stored.id);
    const stats = siteStats(toDomainChecklist(stored), records);
    return c.json({ records, stats });
  });

  app.post('/checklists/:id/site-records', async (c) => {
    const user = c.get('user');
    if (!can(user, 'site-record:write')) return c.json({ error: '没有这个权限' }, 403);
    const stored = repo.getChecklist(c.req.param('id'));
    if (!stored) return c.json({ error: '清单不存在' }, 404);
    const parsed = SiteRecordBatchSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: '现场记录格式不对', issues: parsed.error.issues }, 400);
    const keys = new Set(stored.items.map((i) => i.key));
    const unknown = parsed.data.records.filter((r) => !keys.has(r.itemKey)).map((r) => r.itemKey);
    if (unknown.length) return c.json({ error: '记录指向的清单条目不存在', itemKeys: unknown }, 400);
    const saved = repo.createSiteRecords(
      parsed.data.records.map((r) => ({
        id: r.id || randomUUID(),
        demandSheetId: stored.demandSheetId,
        checklistId: stored.id,
        itemKey: r.itemKey,
        status: r.status,
        note: r.note,
        at: r.at,
        operator: user.name,
      })),
    );
    return c.json({ records: saved, stats: siteStats(toDomainChecklist(stored), repo.listSiteRecords(stored.id)) }, 201);
  });

  /* 现场端首页要的东西：今天要去的这一家、必问还剩几条。 */
  app.get('/checklists/:id/summary', (c) => {
    const stored = repo.getChecklist(c.req.param('id'));
    if (!stored) return c.json({ error: '清单不存在' }, 404);
    return c.json(toChecklistSummary(repo, stored));
  });

  app.get('/checklists/:id/preview-outbound', (c) => {
    const stored = repo.getChecklist(c.req.param('id'));
    if (!stored) return c.json({ error: '清单不存在' }, 404);
    const sheet = repo.getDemandSheet(stored.demandSheetId)!;
    return c.json(previewOutbound(sheet.payload, DEFAULT_POLICY));
  });

  app.notFound((c) => c.json({ error: '没有这个接口' }, 404));

  return app;
}

/**
 * 客户端时钟（毫秒）换算成落库时间：房主手机的时钟可能不准，明显不合法时用服务端时间兜住。
 * 填写时长这类跨事件差值要在同一个时钟下算，所以换算只做一次，落库后不再依赖客户端时钟。
 */
function toIsoAt(clientMs: number, fallback: string): string {
  if (!Number.isFinite(clientMs)) return fallback;
  const at = new Date(clientMs);
  return Number.isNaN(at.getTime()) ? fallback : at.toISOString();
}
