/**
 * 仓储层：服务端只做编排与持久化，业务判断全在领域包里（技术方案 3.1 的分层纪律）。
 *
 * 这里按表组织，接 Postgres 时换掉这一层即可，路由与流水线不动。
 */

import { randomUUID } from 'node:crypto';
import type { Checklist, ChecklistItem, DerivedItem } from '@zx/checklist';
import type { FormModel, InstanceState, FieldValue } from '@zx/field-spec';
import type { TextKind } from '@zx/redact';
import type { Db } from './db/sqlite';

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

export function createRepo(db: Db) {
  const all = <T>(sql: string, ...params: unknown[]): T[] =>
    db.prepare(sql).all(...(params as never[])) as T[];
  const one = <T>(sql: string, ...params: unknown[]): T | undefined =>
    db.prepare(sql).get(...(params as never[])) as T | undefined;
  const run = (sql: string, ...params: unknown[]) => db.prepare(sql).run(...(params as never[]));

  return {
    /* ---------------- 账号与角色 ---------------- */
    createUser(user: Omit<UserRow, 'teamId'> & { teamId?: string | null }) {
      run(
        'INSERT INTO users (id, name, phone, role, team_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        user.id,
        user.name,
        user.phone,
        user.role,
        user.teamId ?? null,
        new Date().toISOString(),
      );
      return { ...user, teamId: user.teamId ?? null } as UserRow;
    },
    listUsers(): UserRow[] {
      return all<{ id: string; name: string; phone: string; role: 'admin' | 'designer'; team_id: string | null }>(
        'SELECT id, name, phone, role, team_id FROM users ORDER BY created_at',
      ).map((r) => ({ id: r.id, name: r.name, phone: r.phone, role: r.role, teamId: r.team_id }));
    },
    findUserByPhone(phone: string): UserRow | undefined {
      const row = one<{ id: string; name: string; phone: string; role: 'admin' | 'designer'; team_id: string | null }>(
        'SELECT id, name, phone, role, team_id FROM users WHERE phone = ?',
        phone,
      );
      return row ? { id: row.id, name: row.name, phone: row.phone, role: row.role, teamId: row.team_id } : undefined;
    },
    findUserById(id: string): UserRow | undefined {
      const row = one<{ id: string; name: string; phone: string; role: 'admin' | 'designer'; team_id: string | null }>(
        'SELECT id, name, phone, role, team_id FROM users WHERE id = ?',
        id,
      );
      return row ? { id: row.id, name: row.name, phone: row.phone, role: row.role, teamId: row.team_id } : undefined;
    },

    /* ---------------- 需求单 ---------------- */
    createDemandSheet(input: {
      id?: string;
      demandName: string;
      schemaVersion: string;
      submittedAt: string;
      source: string;
      submittedBy: string | null;
      payload: FormModel;
      aiMarks: string[];
    }): DemandSheetRow {
      const id = input.id ?? randomUUID();
      const createdAt = new Date().toISOString();
      run(
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
    },
    listDemandSheets(): DemandSheetRow[] {
      return all<Record<string, unknown>>(
        'SELECT * FROM demand_sheets ORDER BY submitted_at DESC',
      ).map(mapSheet);
    },
    getDemandSheet(id: string): DemandSheetRow | undefined {
      const row = one<Record<string, unknown>>('SELECT * FROM demand_sheets WHERE id = ?', id);
      return row ? mapSheet(row) : undefined;
    },
    /** 改名：只动名字，房主填的内容一个字都不动（技术方案 5.3 的待定项 9）。 */
    renameDemandSheet(id: string, demandName: string): DemandSheetRow | undefined {
      const existing = this.getDemandSheet(id);
      if (!existing) return undefined;
      run('UPDATE demand_sheets SET demand_name = ? WHERE id = ?', demandName, id);
      return { ...existing, demandName };
    },

    /* ---------------- 清单 ---------------- */
    createChecklist(input: {
      demandSheetId: string;
      checklist: Checklist;
      model: string;
      ruleVersion: string;
      policyName: string;
      policyVersion: string;
      degraded: boolean;
      understanding: unknown;
    }): StoredChecklist {
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      run(
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
      const insertItem = db.prepare(
        `INSERT INTO checklist_items
           (id, checklist_id, item_key, item_object, space, tier, source, question, why, onsite_checks, related_fields, removed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      );
      input.checklist.items.forEach((item) => {
        insertItem.run(
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
      });
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
    },
    latestChecklist(demandSheetId: string): StoredChecklist | undefined {
      const row = one<Record<string, unknown>>(
        'SELECT * FROM checklists WHERE demand_sheet_id = ? ORDER BY created_at DESC LIMIT 1',
        demandSheetId,
      );
      return row ? this.getChecklist(String(row.id)) : undefined;
    },
    getChecklist(id: string): StoredChecklist | undefined {
      const row = one<Record<string, unknown>>('SELECT * FROM checklists WHERE id = ?', id);
      if (!row) return undefined;
      const items = all<Record<string, unknown>>(
        'SELECT * FROM checklist_items WHERE checklist_id = ? ORDER BY rowid',
        id,
      ).map(
        (r): ChecklistItem & { removed: boolean } => ({
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
        }),
      );
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
    },
    setItemRemoved(input: {
      checklistId: string;
      itemKey: string;
      removed: boolean;
      operator: string;
      at: string;
    }): (ChecklistItem & { removed: boolean }) | undefined {
      const existing = one<Record<string, unknown>>(
        'SELECT * FROM checklist_items WHERE checklist_id = ? AND item_key = ?',
        input.checklistId,
        input.itemKey,
      );
      if (!existing) return undefined;
      run(
        'UPDATE checklist_items SET removed = ?, removed_at = ?, removed_by = ? WHERE id = ?',
        input.removed ? 1 : 0,
        input.removed ? input.at : null,
        input.removed ? input.operator : null,
        String(existing.id),
      );
      return {
        key: input.itemKey,
        object: String(existing.item_object),
        space: String(existing.space),
        tier: String(existing.tier) as ChecklistItem['tier'],
        source: String(existing.source) as ChecklistItem['source'],
        question: String(existing.question),
        why: String(existing.why),
        onsiteChecks: parse<string[]>(existing.onsite_checks),
        relatedFields: parse<string[]>(existing.related_fields),
        removed: input.removed,
      };
    },

    /* ---------------- 外发审计 ---------------- */
    createOutboundRecord(record: OutboundRecordRow) {
      run(
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
    },
    listOutboundRecords(demandSheetId: string): OutboundRecordRow[] {
      return all<Record<string, unknown>>(
        'SELECT * FROM outbound_records WHERE demand_sheet_id = ? ORDER BY at DESC',
        demandSheetId,
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
    },

    /* ---------------- 现场记录 ---------------- */
    createSiteRecords(records: SiteRecordRow[]): SiteRecordRow[] {
      const stmt = db.prepare(
        `INSERT INTO site_records
           (id, demand_sheet_id, checklist_id, item_key, status, note, at, operator, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO NOTHING`,
      );
      const now = new Date().toISOString();
      records.forEach((r) => {
        stmt.run(r.id, r.demandSheetId, r.checklistId, r.itemKey, r.status, r.note, r.at, r.operator, now);
      });
      return records;
    },
    listSiteRecords(checklistId: string): SiteRecordRow[] {
      return all<Record<string, unknown>>(
        'SELECT * FROM site_records WHERE checklist_id = ? ORDER BY at, created_at',
        checklistId,
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
    },

    /* ---------------- 埋点（技术方案 6.11） ---------------- */
    /** 整批写入；带了 batchId 的按 (batchId, 批内序号) 幂等，返回真正写进去的条数。 */
    createEvents(input: {
      demandSheetId: string;
      source: 'client' | 'server';
      operator?: string | null;
      batchId?: string | null;
      at: string;
      events: { name: string; at: string; props?: Record<string, unknown> }[];
    }): number {
      let inserted = 0;
      input.events.forEach((event, seq) => {
        if (input.batchId) {
          const seen = one<{ id: string }>(
            'SELECT id FROM events WHERE batch_id = ? AND seq = ?',
            input.batchId,
            seq,
          );
          if (seen) return;
        }
        run(
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
      });
      return inserted;
    },
    listEvents(demandSheetId?: string): EventRow[] {
      const rows = demandSheetId
        ? all<Record<string, unknown>>(
            'SELECT * FROM events WHERE demand_sheet_id = ? ORDER BY at, seq',
            demandSheetId,
          )
        : all<Record<string, unknown>>('SELECT * FROM events ORDER BY at, seq');
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
    },
  };
}

export type Repo = ReturnType<typeof createRepo>;

function mapSheet(row: Record<string, unknown>): DemandSheetRow {
  return {
    id: String(row.id),
    demandName: String(row.demand_name),
    schemaVersion: String(row.schema_version),
    submittedAt: String(row.submitted_at),
    source: String(row.source),
    submittedBy: row.submitted_by === null ? null : String(row.submitted_by),
    createdAt: String(row.created_at),
    payload: parse<FormModel>(row.payload),
    aiMarks: parse<string[]>(row.ai_marks),
  };
}


export function firstInstanceKey(model: FormModel, section: string): string | undefined {
  return model.instances[section]?.[0]?.key;
}

export type { FieldValue };
