import type { FormModel } from '@zx/field-spec';
import type { AssistantState } from '@zx/rules';

/** 草稿结构版本：字段清单或结构变化时递增，旧草稿按版本迁移。 */
export const SCHEMA_VERSION = 2;

export interface TrackEvent {
  name: string;
  at: number;
  props?: Record<string, unknown>;
}

export interface Draft {
  schemaVersion: number;
  model: FormModel;
  /** 助手写入过的字段键，用于字段旁的「助手建议 · 撤销」标记 */
  aiMarks: Record<string, true>;
  assistant: AssistantState;
  /** 已声明「这个空间没有需求」的实例分区 */
  noNeed: Record<string, boolean>;
  events: TrackEvent[];
}

/** 存储适配器：小程序端映射到 wx.storage，H5 端映射到 localStorage。 */
export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** V1 不引入后端，但接口按将来要接的能力设计：草稿、提交、埋点。 */
export interface DemandRepository {
  loadDraft(): Draft;
  saveDraft(draft: Draft): void;
  clearDraft(): void;
  track(name: string, props?: Record<string, unknown>): void;
  submit(payload: { summary: string }): { ok: boolean; at: number };
}
