/**
 * 服务端的存储契约：路由、投影、流水线都只认这几个形状，
 * 换 SQLite、换 Postgres、换成内存，上层都不动（技术方案 3.1 的分层纪律）。
 */

import type { Checklist, ChecklistItem, DerivedItem } from '@zx/checklist';
import type { FormModel } from '@zx/field-spec';
import type { TextKind } from '@zx/redact';

export interface SheetRecord {
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

export interface ChecklistRecord {
  id: string;
  demandSheetId: string;
  createdAt: string;
  model: string;
  ruleVersion: string;
  policyName: string;
  policyVersion: string;
  degraded: boolean;
  /** 模型返回的四块内容，逐字存下来，界面按需投影 */
  understanding: unknown;
  /** 判据筛掉的推导项：不落清单，留档供回头调判据 */
  dropped: DerivedItem[];
  items: (ChecklistItem & { removed: boolean })[];
}

export interface OutboundRecordRecord {
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

export interface SiteRecordRecord {
  id: string;
  demandSheetId: string;
  checklistId: string;
  itemKey: string;
  status: 'asked' | 'skip';
  note: string;
  at: string;
  operator: string;
}

/**
 * 埋点事件（技术方案 6.11）：报表按事件名取数，`props` 是取数用得到的字段。
 * 只列报表与投影用得到的那些键，比仓储层的行少几个（id、seq 这些落库细节报表不看）。
 */
export interface EventRecord {
  id: string;
  demandSheetId: string;
  name: string;
  at: string;
  source: 'client' | 'server';
  operator: string | null;
  props: Record<string, unknown>;
}

/** 读模型需要的读能力。 */
export interface SheetStore {
  getDemandSheet(id: string): SheetRecord | undefined;
  latestChecklist(demandSheetId: string): ChecklistRecord | undefined;
  listSiteRecords(checklistId: string): SiteRecordRecord[];
}

/** 生成流水线需要的写能力。 */
export interface ServiceStore extends SheetStore {
  createOutboundRecord(record: OutboundRecordRecord): OutboundRecordRecord;
  createChecklist(input: {
    demandSheetId: string;
    checklist: Checklist;
    model: string;
    ruleVersion: string;
    policyName: string;
    policyVersion: string;
    degraded: boolean;
    understanding: unknown;
  }): ChecklistRecord;
}
