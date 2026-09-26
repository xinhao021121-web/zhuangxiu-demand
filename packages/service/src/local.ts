/**
 * 内存实现的服务：线上展示版用，测试里也用。
 *
 * 它跟真实服务走的是同一条流水线与同一份读模型，区别只在于存储与模型：
 * 存储是内存数组，模型是种子数据里的固定输出（对应服务端的 fake provider）。
 * 这样「线上演示点出来的清单」就是真代码跑出来的，不是另一套假数据。
 *
 * 状态默认只活在这一次页面会话里（测试要的就是这个）；展示版会注入 `persistence`，
 * 把五张表落到浏览器的共享存储里——刷新不丢，三个入口共用一份（作品集演示，见 `demo-store.ts`）。
 */

import { siteStats } from '@zx/checklist';
import type { ChecklistItem, SiteRecord } from '@zx/checklist';
import type { User } from '@zx/contracts';
import type { FormModel } from '@zx/field-spec';
import { createFixtureProvider } from './fixture';
import type { DemoPersistence, DemoTables } from './demo-store';
import { generateChecklist } from './pipeline';
import { toChecklistSummary, toChecklistView, toDetail, toDomainChecklist, toSummary } from './projections';
import { buildReports, omissionLedger } from './reports';
import type { ReportSource } from './reports';
import type {
  ChecklistRecord,
  ServiceStore,
  SheetRecord,
} from './types';
import type { ModelProvider } from './model';
import type { Omission, OmissionCategory, Reports } from '@zx/contracts';
import type { DemandSheetImport } from '@zx/contracts';

export interface LocalSeedSheet {
  id: string;
  demandName: string;
  schemaVersion: string;
  submittedAt: string;
  source: string;
  aiMarks: string[];
  form: FormModel;
  understanding: unknown;
}

export interface LocalSeedUser {
  id: string;
  name: string;
  phone: string;
  role: 'admin' | 'designer';
}

export interface LocalSeed {
  sheets: LocalSeedSheet[];
  users: LocalSeedUser[];
}

export interface LocalServiceOptions {
  /** 展示版要能自己点进去，验证码写在明面上 */
  authCode?: string;
  now?: () => string;
  /** 模型名只用于界面展示 */
  modelName?: string;
  /**
   * 演示持久化：给了就把五张表读写到外面（浏览器里是三个入口共享的 localStorage），
   * 刷新不丢；不给就是纯内存，测试与早期用法不变。
   */
  persistence?: DemoPersistence;
}

export class LocalServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createLocalService(seed: LocalSeed, options: LocalServiceOptions = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const authCode = options.authCode ?? '000000';
  const provider: ModelProvider = createFixtureProvider(seed.sheets, options.modelName ?? '演示数据');
  const persistence = options.persistence ?? null;

  /** 种子里那五张表：第一次打开与「重置演示数据」都回到这里。 */
  const seedTables = (): DemoTables => ({
    sheets: seed.sheets.map((s) => ({
      id: s.id,
      demandName: s.demandName,
      schemaVersion: s.schemaVersion,
      submittedAt: s.submittedAt,
      source: s.source,
      submittedBy: null,
      createdAt: s.submittedAt,
      payload: s.form,
      aiMarks: s.aiMarks,
    })),
    checklists: [],
    outbound: [],
    sites: [],
    events: [],
  });

  const stored = persistence?.load() ?? null;
  const tables: DemoTables = stored ?? seedTables();
  const { sheets, checklists, outbound, sites, events } = tables;
  const persist = () => persistence?.save(tables);
  // 第一次打开（或本机那份坏了）：先把种子落下去，之后每次改动都累加在这一份上
  if (!stored) persist();

  /** 原地换掉一个数组的内容：下面的闭包握着的是数组本身，不能换成新数组。 */
  const adopt = (next: DemoTables) => {
    const swap = <T>(target: T[], source: T[]) => target.splice(0, target.length, ...source);
    swap(sheets, next.sheets);
    swap(checklists, next.checklists);
    swap(outbound, next.outbound);
    swap(sites, next.sites);
    swap(events, next.events);
  };

  /** 这一份内存 store 同时满足流水线与报表的读能力：报表要的「列全部需求单 / 列全部事件」也在这里。 */
  const store: ServiceStore & ReportSource = {
    getDemandSheet: (id) => sheets.find((s) => s.id === id),
    listDemandSheets: () => sheets,
    latestChecklist: (demandSheetId) =>
      [...checklists].reverse().find((c) => c.demandSheetId === demandSheetId),
    listSiteRecords: (checklistId) => sites.filter((r) => r.checklistId === checklistId),
    listEvents: (demandSheetId?: string) =>
      demandSheetId ? events.filter((e) => e.demandSheetId === demandSheetId) : events,
    createOutboundRecord: (record) => {
      outbound.push(record);
      persist();
      return record;
    },
    createChecklist: (input) => {
      const record: ChecklistRecord = {
        id: crypto.randomUUID(),
        demandSheetId: input.demandSheetId,
        createdAt: now(),
        model: input.model,
        ruleVersion: input.ruleVersion,
        policyName: input.policyName,
        policyVersion: input.policyVersion,
        degraded: input.degraded,
        understanding: input.understanding,
        dropped: input.checklist.dropped,
        items: input.checklist.items.map((i) => ({ ...i, removed: false })),
      };
      checklists.push(record);
      persist();
      return record;
    },
  };

  let current: User | null = null;

  const requireChecklist = (checklistId: string): ChecklistRecord => {
    const found = checklists.find((c) => c.id === checklistId);
    if (!found) throw new LocalServiceError(404, '清单不存在');
    return found;
  };
  const requireSheet = async (id: string): Promise<SheetRecord> => {
    const found = await store.getDemandSheet(id);
    if (!found) throw new LocalServiceError(404, '需求单不存在');
    return found;
  };
  const listOmissions = async (sheet: SheetRecord): Promise<Omission[]> =>
    omissionLedger(await store.listEvents(sheet.id), new Map([[sheet.id, sheet.demandName]]));

  return {
    /**
     * 预生成清单：演示时希望一进来就是「已经解读过」的状态，
     * 走的是同一条流水线（桩 provider），所以数字与真实服务一致。
     */
    async warmup(ids: string[] = seed.sheets.map((s) => s.id)) {
      for (const id of ids) {
        if (await store.latestChecklist(id)) continue;
        if (!(await store.getDemandSheet(id))) continue;
        await generateChecklist(store, provider, { demandSheetId: id, operator: '演示数据', at: now() });
      }
    },

    /** 展示版没有后端：token 是个标记，用来让界面走完登录动线 */
    async login(phone: string, code: string) {
      const user = seed.users.find((u) => u.phone === phone);
      if (!user || code !== authCode) throw new LocalServiceError(401, '手机号或验证码不对（演示账号 13800000002 / 000000）');
      current = { ...user, teamId: null };
      return { token: `demo.${user.id}`, user: current };
    },

    async listSheets() {
      return Promise.all(sheets.map((s) => toSummary(store, s)));
    },

    /**
     * 文件导入：与真实服务同一条路（内部通道的 `POST /demand-sheets`），
     * 来源固定成 `file`，提交人是当前登录的人。
     *
     * 演示模式下导入进来的需求单不在种子 fixture 里，解读时会退化成纯规则清单
     * （没有模型的推导项）——这是桩 provider 的既定行为，不是降级错误。
     */
    async importSheet(input: DemandSheetImport) {
      const sheet: SheetRecord = {
        id: input.submissionId ?? crypto.randomUUID(),
        demandName: input.demandName,
        schemaVersion: input.schemaVersion,
        submittedAt: input.submittedAt,
        // 文件导入是 file；采集端那条通道落的是 miniapp（与真实服务同一个字段）
        source: input.source ?? 'file',
        submittedBy: current?.id ?? null,
        createdAt: now(),
        payload: input.form,
        aiMarks: input.aiMarks,
      };
      // 刚导入的排最前，方便看一眼；演示模式不按提交时间重排（真实服务按 submitted_at 倒序）
      sheets.unshift(sheet);
      persist();
      return await toSummary(store, sheet);
    },

    /**
     * 把采集端在演示模式下提交的需求单收进来（同源共享的收件箱，见 `@zx/data` 的 `demo-inbox`）。
     *
     * 幂等与采集通道同口径：同一个 `submissionId` 已经落库就不落第二份。
     * 随提交带出的埋点一并落成客户端事件，所以「规则健康度」看得到房主那一边拒绝了什么。
     */
    async receiveSubmissions(): Promise<number> {
      const inbox = persistence?.submissions() ?? [];
      let added = 0;
      for (const entry of inbox) {
        if (await store.getDemandSheet(entry.submissionId)) continue;
        sheets.unshift({
          id: entry.submissionId,
          demandName: entry.demandName,
          schemaVersion: entry.schemaVersion,
          submittedAt: entry.submittedAt,
          source: entry.source,
          submittedBy: null,
          createdAt: entry.submittedAt,
          payload: entry.form,
          aiMarks: entry.aiMarks,
        });
        const batch = entry.telemetry;
        batch?.events.forEach((event, seq) => {
          const at = new Date(event.at);
          events.push({
            id: `${batch.batchId}-${seq}`,
            demandSheetId: entry.submissionId,
            name: event.name,
            at: Number.isNaN(at.getTime()) ? now() : at.toISOString(),
            source: 'client',
            operator: null,
            props: event.props ?? {},
          });
        });
        added += 1;
      }
      if (added) persist();
      return added;
    },

    async detail(id: string) {
      return await toDetail(store, await requireSheet(id));
    },

    async generate(id: string, selected?: Record<string, boolean>) {
      await requireSheet(id);
      await generateChecklist(store, provider, {
        demandSheetId: id,
        operator: current?.name ?? '演示账号',
        at: now(),
        selected,
      });
      return toChecklistView((await store.latestChecklist(id))!);
    },

    async checklist(checklistId: string) {
      return toChecklistView(requireChecklist(checklistId));
    },

    async setItemRemoved(checklistId: string, key: string, removed: boolean) {
      const record = requireChecklist(checklistId);
      const item = record.items.find((i) => i.key === key);
      if (!item) throw new LocalServiceError(404, '清单项不存在');
      item.removed = removed;
      persist();
      return { key, removed } satisfies Pick<ChecklistItem, 'key'> & { removed: boolean };
    },

    async outboundRecords(demandSheetId: string) {
      await requireSheet(demandSheetId);
      return outbound.filter((r) => r.demandSheetId === demandSheetId).reverse();
    },

    /** 改名：与 API 的 `PATCH /demand-sheets/:id` 同一件事，只动名字、只回报改完了没有。 */
    async renameSheet(id: string, demandName: string): Promise<void> {
      const name = demandName.trim();
      if (!name) throw new LocalServiceError(400, '名字不能为空');
      (await requireSheet(id)).demandName = name;
      persist();
    },

    /** 遗漏补录：与 API 一样落成一条 `omission_log` 事件，台账就是这些事件本身。 */
    async addOmission(id: string, input: { space: string; category: OmissionCategory; note?: string }): Promise<Omission[]> {
      const sheet = await requireSheet(id);
      if (!input.space?.trim()) throw new LocalServiceError(400, '补录要选一个分区');
      events.push({
        id: crypto.randomUUID(),
        demandSheetId: sheet.id,
        name: 'omission_log',
        at: now(),
        source: 'server',
        operator: current?.name ?? '演示账号',
        props: { space: input.space, category: input.category, note: input.note ?? '' },
      });
      persist();
      return await listOmissions(sheet);
    },

    /**
     * 重置这份演示数据：清掉本机存的（含采集端收件箱），回到种子状态。
     * 作品集里给评审用——前一个人点乱了，下一个人一键回到干净的开场。
     */
    async resetDemo(): Promise<void> {
      persistence?.reset();
      adopt(seedTables());
      persist();
    },

    async omissions(id: string): Promise<Omission[]> {
      return await listOmissions(await requireSheet(id));
    },

    /** 四张回流报表：与真实服务同一份聚合（`buildReports`），只是数据在内存里。 */
    async reports(): Promise<Reports> {
      return await buildReports(store);
    },

    async summary(checklistId: string) {
      return await toChecklistSummary(store, requireChecklist(checklistId));
    },

    async siteRecords(checklistId: string) {
      const record = requireChecklist(checklistId);
      const records = await store.listSiteRecords(record.id);
      return {
        records,
        stats: siteStats(toDomainChecklist(record), records as SiteRecord[]),
      };
    },

    async pushRecords(
      checklistId: string,
      incoming: { id: string; itemKey: string; status: 'asked' | 'skip'; note: string; at: string; operator: string }[],
    ) {
      const record = requireChecklist(checklistId);
      incoming.forEach((r) => {
        if (sites.some((s) => s.id === r.id)) return; // 同一条记录重复同步不写重
        if (!record.items.some((i) => i.key === r.itemKey)) {
          throw new LocalServiceError(400, `记录指向的清单条目不存在：${r.itemKey}`);
        }
        sites.push({
          id: r.id,
          demandSheetId: record.demandSheetId,
          checklistId: record.id,
          itemKey: r.itemKey,
          status: r.status,
          note: r.note,
          at: r.at,
          operator: current?.name ?? r.operator,
        });
      });
      persist();
      const records = await store.listSiteRecords(record.id);
      return { records, stats: siteStats(toDomainChecklist(record), records as SiteRecord[]) };
    },
  };
}

export type LocalService = ReturnType<typeof createLocalService>;
