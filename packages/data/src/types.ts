import type { FormModel } from '@zx/field-spec';
import type { AssistantState } from '@zx/rules';
import type { EventName } from './events';

/** 草稿结构版本：字段清单或结构变化时递增，旧草稿按版本迁移。 */
export const SCHEMA_VERSION = 2;

/**
 * 字段清单版本：需求单契约里的 `schemaVersion`，读入方按它做一次规范化。
 *
 * 与上面的草稿结构版本不是一回事——那个管「旧草稿能不能读回」，这个管「这份需求单是按哪版字段清单填的」。
 * 单一来源在这里，`@zx/contracts` 的 `DemandSheetImport` 引用它，采集端与读入方认的是同一个值。
 */
export const DEMAND_SCHEMA_VERSION = '1.0';

export interface TrackEvent {
  /** 事件名只能取 `EVENT_NAMES` 里的值：指标按名字取数，名字错了数字就错了 */
  name: EventName;
  /** 客户端时钟（毫秒）：填写时长这类跨事件差值靠它算 */
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

/**
 * 结构化需求单：采集端提交的东西，形状与契约的 `DemandSheetImport` 一致（技术方案 5.2）。
 *
 * 这里不 import `@zx/contracts`——契约反过来依赖本包（`EVENT_NAMES` 是事件名的单一来源），
 * 依赖只能从契约指向领域包。两边的形状由 API 测试里的「同一份 JSON 走一遍」卡住。
 */
export interface DemandSheetSubmission {
  /** 客户端生成的提交 id：弱网重试带同一个，服务端据此认出是同一份 */
  submissionId: string;
  schemaVersion: string;
  submittedAt: string;
  source: 'miniapp';
  form: FormModel;
  aiMarks: string[];
}

/** 提交结果：`delivered` 区分「真的送到了服务端」与「展示模式下只留本机」。 */
export type SubmitOutcome =
  | { ok: true; at: number; delivered: true; id: string }
  | { ok: true; at: number; delivered: false }
  | { ok: false; at: number; reason: string };

/** 采集通道的客户端（技术方案 5.3）：能提交，不能读——这条通道本来就没有读接口。 */
export interface DemandSubmitter {
  submit(sheet: DemandSheetSubmission, events: TrackEvent[]): Promise<{ id: string; replay: boolean; acceptedEvents: number }>;
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
  track(name: EventName, props?: Record<string, unknown>): void;
  /**
   * 提交一份结构化需求单。只做「提交」这一件事：埋点由 `track` 记（提交事件由调用方在
   * 提交时记一次），两条写同一份草稿会互相覆盖。
   *
   * 接入采集通道之后，实现换成真的上报（技术方案 5.3）；没接通道时只回报「留在了本机」。
   */
  submit(sheet: DemandSheetSubmission, events: TrackEvent[]): Promise<SubmitOutcome>;
}
