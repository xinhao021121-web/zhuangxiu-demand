/**
 * 内存实现的服务：线上展示版用，测试里也用。
 *
 * 它跟真实服务走的是同一条流水线与同一份读模型，区别只在于存储与模型：
 * 存储是内存数组，模型是种子数据里的固定输出（对应服务端的 fake provider）。
 * 这样「线上演示点出来的清单」就是真代码跑出来的，不是另一套假数据。
 *
 * 状态只活在这一次页面会话里：刷新等于重置，演示用刚好。
 */

import { siteStats } from '@zx/checklist';
import type { ChecklistItem, SiteRecord } from '@zx/checklist';
import type { User } from '@zx/contracts';
import type { FormModel } from '@zx/field-spec';
import { createFixtureProvider } from './fixture';
import { generateChecklist } from './pipeline';
import { toChecklistSummary, toChecklistView, toDetail, toDomainChecklist, toSummary } from './projections';
import { buildReports, omissionLedger } from './reports';
import type { ReportSource } from './reports';
import type {
  ChecklistRecord,
  EventRecord,
  OutboundRecordRecord,
  ServiceStore,
  SheetRecord,
  SiteRecordRecord,
} from './types';
import type { ModelProvider } from './model';
import type { Omission, OmissionCategory, Reports } from '@zx/contracts';

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

  const sheets: SheetRecord[] = seed.sheets.map((s) => ({
    id: s.id,
    demandName: s.demandName,
    schemaVersion: s.schemaVersion,
    submittedAt: s.submittedAt,
    source: s.source,
    submittedBy: null,
    createdAt: s.submittedAt,
    payload: s.form,
    aiMarks: s.aiMarks,
  }));
  const checklists: ChecklistRecord[] = [];
  const outbound: OutboundRecordRecord[] = [];
  const sites: SiteRecordRecord[] = [];
  const events: EventRecord[] = [];

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
      return record;
    },
  };

  let current: User | null = null;

  const requireChecklist = (checklistId: string): ChecklistRecord => {
    const found = checklists.find((c) => c.id === checklistId);
    if (!found) throw new LocalServiceError(404, '清单不存在');
    return found;
  };
  const requireSheet = (id: string): SheetRecord => {
    const found = store.getDemandSheet(id);
    if (!found) throw new LocalServiceError(404, '需求单不存在');
    return found;
  };
  const listOmissions = (sheet: SheetRecord): Omission[] =>
    omissionLedger(store.listEvents(sheet.id), new Map([[sheet.id, sheet.demandName]]));

  return {
    /**
     * 预生成清单：演示时希望一进来就是「已经解读过」的状态，
     * 走的是同一条流水线（桩 provider），所以数字与真实服务一致。
     */
    async warmup(ids: string[] = seed.sheets.map((s) => s.id)) {
      for (const id of ids) {
        if (store.latestChecklist(id)) continue;
        if (!store.getDemandSheet(id)) continue;
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
      return sheets.map((s) => toSummary(store, s));
    },

    async detail(id: string) {
      return toDetail(store, requireSheet(id));
    },

    async generate(id: string, selected?: Record<string, boolean>) {
      requireSheet(id);
      await generateChecklist(store, provider, {
        demandSheetId: id,
        operator: current?.name ?? '演示账号',
        at: now(),
        selected,
      });
      return toChecklistView(store.latestChecklist(id)!);
    },

    async checklist(checklistId: string) {
      return toChecklistView(requireChecklist(checklistId));
    },

    async setItemRemoved(checklistId: string, key: string, removed: boolean) {
      const record = requireChecklist(checklistId);
      const item = record.items.find((i) => i.key === key);
      if (!item) throw new LocalServiceError(404, '清单项不存在');
      item.removed = removed;
      return { key, removed } satisfies Pick<ChecklistItem, 'key'> & { removed: boolean };
    },

    async outboundRecords(demandSheetId: string) {
      requireSheet(demandSheetId);
      return outbound.filter((r) => r.demandSheetId === demandSheetId).reverse();
    },

    /** 改名：与 API 的 `PATCH /demand-sheets/:id` 同一件事，只动名字、只回报改完了没有。 */
    async renameSheet(id: string, demandName: string): Promise<void> {
      const name = demandName.trim();
      if (!name) throw new LocalServiceError(400, '名字不能为空');
      requireSheet(id).demandName = name;
    },

    /** 遗漏补录：与 API 一样落成一条 `omission_log` 事件，台账就是这些事件本身。 */
    async addOmission(id: string, input: { space: string; category: OmissionCategory; note?: string }): Promise<Omission[]> {
      const sheet = requireSheet(id);
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
      return listOmissions(sheet);
    },

    async omissions(id: string): Promise<Omission[]> {
      return listOmissions(requireSheet(id));
    },

    /** 四张回流报表：与真实服务同一份聚合（`buildReports`），只是数据在内存里。 */
    async reports(): Promise<Reports> {
      return buildReports(store);
    },

    async summary(checklistId: string) {
      return toChecklistSummary(store, requireChecklist(checklistId));
    },

    async siteRecords(checklistId: string) {
      const record = requireChecklist(checklistId);
      const records = store.listSiteRecords(record.id);
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
      const records = store.listSiteRecords(record.id);
      return { records, stats: siteStats(toDomainChecklist(record), records as SiteRecord[]) };
    },
  };
}

export type LocalService = ReturnType<typeof createLocalService>;
