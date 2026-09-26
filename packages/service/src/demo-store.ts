/**
 * 浏览器内共享演示存储（作品集演示用）。
 *
 * 三个入口挂在同一个域名下（`/app/`、`/studio/`、`/onsite/`），localStorage 就是同一份：
 * 演示模式下的需求单、清单、现场记录、埋点都存这里，所以刷新不丢，三个端看到的是同一套数据。
 * 换一台设备／换一个浏览器就是换一份沙箱，评审之间互不打扰。
 *
 * 它只被「演示模式的接线」用：真实服务端的存储是 D1 与容器里的 SQLite（`services/api`），
 * 单测注入自己的 storage——两者都不碰 localStorage。
 */

import { clearDemoInbox, readDemoInbox } from '@zx/data';
import type { DemoInboxEntry, StorageAdapter } from '@zx/data';
import type {
  ChecklistRecord,
  EventRecord,
  OutboundRecordRecord,
  SheetRecord,
  SiteRecordRecord,
} from './types';

/** 这份状态的存储键。结构变了就换版本号，旧数据不再解析（演示数据不值得写迁移）。 */
export const DEMO_STATE_KEY = 'zx.demo.state.v1';
export const DEMO_STATE_VERSION = 1;

/** 与 `StorageAdapter` 同形，只是名字更贴这层的用途；浏览器里就是 `window.localStorage`。 */
export type DemoStorage = StorageAdapter;

/** 内存实现落的那五张表：换存储换的是它们，上层的流水线与报表不动。 */
export interface DemoTables {
  sheets: SheetRecord[];
  checklists: ChecklistRecord[];
  outbound: OutboundRecordRecord[];
  sites: SiteRecordRecord[];
  events: EventRecord[];
}

export interface DemoPersistence {
  /** 读到能用的一份就返回；没有、版本对不上、内容坏了都返回 null（调用方回落到种子）。 */
  load(): DemoTables | null;
  save(tables: DemoTables): void;
  /** 清掉这份演示数据，连同采集端的收件箱（下次打开从种子重新开始）。 */
  reset(): void;
  /** 采集端在演示模式下提交的需求单（同源共享）。没接收件箱时是空的。 */
  submissions(): DemoInboxEntry[];
}

/**
 * 拿浏览器的 localStorage：SSR 阶段、隐私模式禁用存储、配额满，
 * 都要退成「没有持久化」而不是让页面打不开。
 */
export function webDemoStorage(): DemoStorage | null {
  try {
    if (typeof window === 'undefined') return null;
    const storage = window.localStorage;
    const probe = 'zx.demo.probe';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

function isTables(value: unknown): value is DemoTables {
  const v = value as DemoTables | null;
  return (
    !!v &&
    Array.isArray(v.sheets) &&
    Array.isArray(v.checklists) &&
    Array.isArray(v.outbound) &&
    Array.isArray(v.sites) &&
    Array.isArray(v.events)
  );
}

export function createDemoPersistence(storage: DemoStorage | null = webDemoStorage()): DemoPersistence {
  return {
    load() {
      if (!storage) return null;
      try {
        const raw = storage.getItem(DEMO_STATE_KEY);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        if ((parsed as { version?: number } | null)?.version !== DEMO_STATE_VERSION) return null;
        const { version: _version, ...tables } = parsed as { version: number } & DemoTables;
        return isTables(tables) ? tables : null;
      } catch {
        return null;
      }
    },

    save(tables) {
      if (!storage) return;
      try {
        storage.setItem(DEMO_STATE_KEY, JSON.stringify({ version: DEMO_STATE_VERSION, ...tables }));
      } catch {
        /* 存不下（配额满/隐私模式）：这一次演示照常跑，只是刷新后回到上一次存住的状态 */
      }
    },

    reset() {
      if (storage) {
        try {
          storage.removeItem(DEMO_STATE_KEY);
        } catch {
          /* 同上 */
        }
        clearDemoInbox(storage);
      }
    },

    submissions() {
      return storage ? readDemoInbox(storage) : [];
    },
  };
}
