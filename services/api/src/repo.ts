/**
 * 仓储层：服务端只做编排与持久化，业务判断全在领域包里（技术方案 3.1 的分层纪律）。
 *
 * 方法一律异步：底层驱动可能是同步的 `node:sqlite`，也可能是只有异步 API 的 Cloudflare D1
 * （`db/driver.ts` 解释了为什么定在异步一侧）。换存储就是换驱动，这一层与上面的路由、
 * 流水线都不动——技术方案 9.2 的那句话到这里才算真的成立。
 */

import { randomUUID } from 'node:crypto';
import type { Checklist, ChecklistItem, DerivedItem } from '@zx/checklist';
import type { FormModel, FieldValue } from '@zx/field-spec';
import type { TextKind } from '@zx/redact';
import type { Db } from './db/driver';

export interface UserRow {
  id: string;
  name: string;
  phone: string;
  role: 'admin' | 'designer';
  teamId: string | null;
}

export interface DemandSheetRow {
  id: string;
  demandName: string;
  schemaVersion: string;
  submittedAt: string;
  source: string;
  submittedBy: string | null;
  createdAt: string;
  payload: FormModel;
  aiMarks: string[];
}

export interface StoredChecklist {
  id: string;
  demandSheetId: string;
  createdAt: string;
  model: string;
  ruleVersion: string;
  policyName: string;
  policyVersion: string;
  degraded: boolean;
  understanding: unknown;
  dropped: DerivedItem[];
  items: (ChecklistItem & { removed: boolean })[];
}

export interface OutboundRecordRow {
  id: string;
  demandSheetId: string;
  policyName: string;
  policyVersion: string;
  fieldKeys: string[];
  redactions: { fieldKey: string; label: string; kinds: TextKind[]; count: number }[];
  unselectedFreeText: number;
  at: string;
  operator: string;
}

export interface SiteRecordRow {
  id: string;
  demandSheetId: string;
  checklistId: string;
  itemKey: string;
  status: 'asked' | 'skip';
  note: string;
  at: string;
  operator: string;
}

export interface EventRow {
  id: string;
  demandSheetId: string;
  name: string;
  /** 事件发生时间：客户端事件由客户端时钟换算，服务端事件就是落库时间 */
  at: string;
  source: 'client' | 'server';
  operator: string | null;
  /** 整批上报的批次 id；服务端自己产生的事件为 null */
  batchId: string | null;
  seq: number;
  props: Record<string, unknown>;
}

const json = (v: unknown) => JSON.stringify(v ?? null);
const parse = <T>(v: unknown): T => JSON.parse(String(v)) as T;
const toBool = (v: unknown) => Number(v) === 1;

type UserDbRow = {
  id: string;
  name: string;
  phone: string;
  role: 'admin' | 'designer';
  team_id: string | null;
};

export function createRepo(db: Db) {
  const all = <T>(sql: string, ...params: unknown[]): Promise<T[]> => db.all<T>(sql, ...params);
  const one = <T>(sql: string, ...params: unknown[]): Promise<T | undefined> => db.get<T>(sql, ...params);
  const run = (sql: string, ...params: unknown[]): Promise<void> => db.run(sql, ...params);

  /* ---------------- 账号与角色 ---------------- */
  const mapUser = (r: UserDbRow): UserRow => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    role: r.role,
    teamId: r.team_id,
  });

  const createUser = async (
    user: Omit<UserRow, 'teamId'> & { teamId?: string | null },
  ): Promise<UserRow> => {
    await run(
      'INSERT INTO users (id, name, phone, role, team_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      user.id,
      user.name,
      user.phone,
      user.role,
      user.teamId ?? null,
      new Date().toISOString(),
    );
    return { ...user, teamId: user.teamId ?? null } as UserRow;
  };

  const listUsers = async (): Promise<UserRow[]> =>
    (
      await all<UserDbRow>('SELECT id, name, phone, role, team_id FROM users ORDER BY created_at')
    ).map(mapUser);

  const findUserByPhone = async (phone: string): Promise<UserRow | undefined> => {
    const row = await one<UserDbRow>('SELECT id, name, phone, role, team_id FROM users WHERE phone = ?', phone);
    return row ? mapUser(row) : undefined;
  };

  const findUserById = async (id: string): Promise<UserRow | undefined> => {
    const row = await one<UserDbRow>('SELECT id, name, phone, role, team_id FROM users WHERE id = ?', id);
    return row ? mapUser(row) : undefined;
  };

  /* ---------------- 需求单 ---------------- */
  const mapSheet = (row: Record<string, unknown>): DemandSheetRow => ({
    id: String(row.id),
    demandName: String(row.demand_name),
    schemaVersion: String(row.schema_version),
    submittedAt: String(row.submitted_at),
    source: String(row.source),
    submittedBy: row.submitted_by === null ? null : String(row.submitted_by),
    createdAt: String(row.created_at),
    payload: parse<FormModel>(row.payload),
    aiMarks: parse<string[]>(row.ai_marks),
  });

  const createDemandSheet = async (input: {
    id?: string;
    demandName: string;
    schemaVersion: string;
    submittedAt: string;
    source: string;
    submittedBy: string | null;
    payload: FormModel;
    aiMarks: string[];
  }): Promise<DemandSheetRow> => {
    const id = input.id ?? randomUUID();
    const createdAt = new Date().toISOString();
    await run(
      `INSERT INTO demand_sheets
         (id, demand_name, schema_version, payload, ai_marks, submitted_at, source, submitted_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.demandName,
      input.schemaVersion,
      json(input.payload),
      json(input.aiMarks),
      input.submittedAt,
      input.source,
      input.submittedBy,
      createdAt,
    );
    return { ...input, id, createdAt };
  };

  const listDemandSheets = async (): Promise<DemandSheetRow[]> =>
    (await all<Record<string, unknown>>('SELECT * FROM demand_sheets ORDER BY submitted_at DESC')).map(mapSheet);

  const getDemandSheet = async (id: string): Promise<DemandSheetRow | undefined> => {
    const row = await one<Record<string, unknown>>('SELECT * FROM demand_sheets WHERE id = ?', id);
    return row ? mapSheet(row) : undefined;
  };

  /** 改名：只动名字，房主填的内容一个字都不动（技术方案 5.3 的待定项 9）。 */
  const renameDemandSheet = async (id: string, demandName: string): Promise<DemandSheetRow | undefined> => {
    const existing = await getDemandSheet(id);
    if (!existing) return undefined;
    await run('UPDATE demand_sheets SET demand_name = ? WHERE id = ?', demandName, id);
    return { ...existing, demandName };
  };

  /* ---------------- 清单 ---------------- */
  const mapItem = (r: Record<string, unknown>): ChecklistItem & { removed: boolean } => ({
    key: String(r.item_key),
    object: String(r.item_object),
    space: String(r.space),
    tier: String(r.tier) as ChecklistItem['tier'],
    source: String(r.source) as ChecklistItem['source'],
    question: String(r.question),
    why: String(r.why),
    onsiteChecks: parse<string[]>(r.onsite_checks),
    relatedFields: parse<string[]>(r.related_fields),
    removed: toBool(r.removed),
  });

  const createChecklist = async (input: {
    demandSheetId: string;
    checklist: Checklist;
    model: string;
    ruleVersion: string;
    policyName: string;
    policyVersion: string;
    degraded: boolean;
    understanding: unknown;
  }): Promise<StoredChecklist> => {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    await run(
      `INSERT INTO checklists
         (id, demand_sheet_id, created_at, model, rule_version, policy_name, policy_version, degraded, understanding, dropped)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.demandSheetId,
      createdAt,
      input.model,
      input.ruleVersion,
      input.policyName,
      input.policyVersion,
      input.degraded ? 1 : 0,
      json(input.understanding),
      json(input.checklist.dropped),
    );
    // 条目逐条写：D1 的预处理语句不能跨调用复用，语句与绑定值一起交给驱动
    for (const item of input.checklist.items) {
      await run(
        `INSERT INTO checklist_items
           (id, checklist_id, item_key, item_object, space, tier, source, question, why, onsite_checks, related_fields, removed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        randomUUID(),
        id,
        item.key,
        item.object,
        item.space,
        item.tier,
        item.source,
        item.question,
        item.why,
        json(item.onsiteChecks),
        json(item.relatedFields),
      );
    }
    return {
      id,
      demandSheetId: input.demandSheetId,
      createdAt,
      model: input.model,
      ruleVersion: input.ruleVersion,
      policyName: input.policyName,
      policyVersion: input.policyVersion,
      degraded: input.degraded,
      understanding: input.understanding,
      dropped: input.checklist.dropped,
      items: input.checklist.items.map((i) => ({ ...i, removed: false })),
    };
  };

  const getChecklist = async (id: string): Promise<StoredChecklist | undefined> => {
    const row = await one<Record<string, unknown>>('SELECT * FROM checklists WHERE id = ?', id);
    if (!row) return undefined;
    const items = (
      await all<Record<string, unknown>>('SELECT * FROM checklist_items WHERE checklist_id = ? ORDER BY rowid', id)
    ).map(mapItem);
    return {
      id: String(row.id),
      demandSheetId: String(row.demand_sheet_id),
      createdAt: String(row.created_at),
      model: String(row.model),
      ruleVersion: String(row.rule_version),
      policyName: String(row.policy_name),
      policyVersion: String(row.policy_version),
      degraded: toBool(row.degraded),
      understanding: parse(row.understanding),
      dropped: parse<DerivedItem[]>(row.dropped),
      items,
    };
  };

  const latestChecklist = async (demandSheetId: string): Promise<StoredChecklist | undefined> => {
    const row = await one<Record<string, unknown>>(
      'SELECT * FROM checklists WHERE demand_sheet_id = ? ORDER BY created_at DESC LIMIT 1',
      demandSheetId,
    );
    return row ? getChecklist(String(row.id)) : undefined;
  };

  const setItemRemoved = async (input: {
    checklistId: string;
    itemKey: string;
    removed: boolean;
    operator: string;
    at: string;
  }): Promise<(ChecklistItem & { removed: boolean }) | undefined> => {
    const existing = await one<Record<string, unknown>>(
      'SELECT * FROM checklist_items WHERE checklist_id = ? AND item_key = ?',
      input.checklistId,
      input.itemKey,
    );
    if (!existing) return undefined;
    await run(
      'UPDATE checklist_items SET removed = ?, removed_at = ?, removed_by = ? WHERE id = ?',
      input.removed ? 1 : 0,
      input.removed ? input.at : null,
      input.removed ? input.operator : null,
      String(existing.id),
    );
    return { ...mapItem(existing), removed: input.removed };
  };

  /* ---------------- 外发审计 ---------------- */
  const createOutboundRecord = async (record: OutboundRecordRow): Promise<OutboundRecordRow> => {
    await run(
      `INSERT INTO outbound_records
         (id, demand_sheet_id, policy_name, policy_version, field_keys, redactions, unselected_freetext, at, operator)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.demandSheetId,
      record.policyName,
      record.policyVersion,
      json(record.fieldKeys),
      json(record.redactions),
      record.unselectedFreeText,
      record.at,
      record.operator,
    );
    return record;
  };

  const listOutboundRecords = async (demandSheetId: string): Promise<OutboundRecordRow[]> =>
    (
      await all<Record<string, unknown>>(
        'SELECT * FROM outbound_records WHERE demand_sheet_id = ? ORDER BY at DESC',
        demandSheetId,
      )
    ).map((r) => ({
      id: String(r.id),
      demandSheetId: String(r.demand_sheet_id),
      policyName: String(r.policy_name),
      policyVersion: String(r.policy_version),
      fieldKeys: parse<string[]>(r.field_keys),
      redactions: parse(r.redactions),
      unselectedFreeText: Number(r.unselected_freetext),
      at: String(r.at),
      operator: String(r.operator),
    }));

  /* ---------------- 现场记录 ---------------- */
  const createSiteRecords = async (records: SiteRecordRow[]): Promise<SiteRecordRow[]> => {
    const createdAt = new Date().toISOString();
    for (const r of records) {
      await run(
        `INSERT INTO site_records
           (id, demand_sheet_id, checklist_id, item_key, status, note, at, operator, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
        r.id,
        r.demandSheetId,
        r.checklistId,
        r.itemKey,
        r.status,
        r.note,
        r.at,
        r.operator,
        createdAt,
      );
    }
    return records;
  };

  const listSiteRecords = async (checklistId: string): Promise<SiteRecordRow[]> =>
    (
      await all<Record<string, unknown>>(
        'SELECT * FROM site_records WHERE checklist_id = ? ORDER BY at, created_at',
        checklistId,
      )
    ).map((r) => ({
      id: String(r.id),
      demandSheetId: String(r.demand_sheet_id),
      checklistId: String(r.checklist_id),
      itemKey: String(r.item_key),
      status: String(r.status) as 'asked' | 'skip',
      note: String(r.note),
      at: String(r.at),
      operator: String(r.operator),
    }));

  /* ---------------- 埋点（技术方案 6.11） ---------------- */
  /** 整批写入；带了 batchId 的按 (batchId, 批内序号) 幂等，返回真正写进去的条数。 */
  const createEvents = async (input: {
    demandSheetId: string;
    source: 'client' | 'server';
    operator?: string | null;
    batchId?: string | null;
    at: string;
    events: { name: string; at: string; props?: Record<string, unknown> }[];
  }): Promise<number> => {
    let inserted = 0;
    for (const [seq, event] of input.events.entries()) {
      if (input.batchId) {
        const seen = await one<{ id: string }>(
          'SELECT id FROM events WHERE batch_id = ? AND seq = ?',
          input.batchId,
          seq,
        );
        if (seen) continue;
      }
      await run(
        `INSERT INTO events
           (id, demand_sheet_id, name, at, source, operator, batch_id, seq, props, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(),
        input.demandSheetId,
        event.name,
        event.at,
        input.source,
        input.operator ?? null,
        input.batchId ?? null,
        seq,
        json(event.props ?? {}),
        input.at,
      );
      inserted += 1;
    }
    return inserted;
  };

  const listEvents = async (demandSheetId?: string): Promise<EventRow[]> => {
    const rows = demandSheetId
      ? await all<Record<string, unknown>>(
          'SELECT * FROM events WHERE demand_sheet_id = ? ORDER BY at, seq',
          demandSheetId,
        )
      : await all<Record<string, unknown>>('SELECT * FROM events ORDER BY at, seq');
    return rows.map((r) => ({
      id: String(r.id),
      demandSheetId: String(r.demand_sheet_id),
      name: String(r.name),
      at: String(r.at),
      source: String(r.source) as 'client' | 'server',
      operator: r.operator === null ? null : String(r.operator),
      batchId: r.batch_id === null ? null : String(r.batch_id),
      seq: Number(r.seq),
      props: parse<Record<string, unknown>>(r.props),
    }));
  };

  return {
    createUser,
    listUsers,
    findUserByPhone,
    findUserById,
    createDemandSheet,
    listDemandSheets,
    getDemandSheet,
    renameDemandSheet,
    createChecklist,
    getChecklist,
    latestChecklist,
    setItemRemoved,
    createOutboundRecord,
    listOutboundRecords,
    createSiteRecords,
    listSiteRecords,
    createEvents,
    listEvents,
  };
}

export type Repo = ReturnType<typeof createRepo>;

export function firstInstanceKey(model: FormModel, section: string): string | undefined {
  return model.instances[section]?.[0]?.key;
}

export type { FieldValue };
