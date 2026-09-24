/** 本地实现的仓储：草稿、埋点、提交都只落在本机存储，接云端时只换实现。 */

import { createDraft, migrateDraft } from './migrate';
import { toSubmitter } from './collection';
import type { EventName } from './events';
import type { DemandRepository, DemandSubmitter, Draft, StorageAdapter } from './types';

export const DRAFT_KEY = 'zx.demand.draft';

/** 本地事件上限：只留最近这么多条，避免草稿无限长。 */
export const MAX_EVENTS = 200;

export function createMemoryStorage(initial: Record<string, string> = {}): StorageAdapter {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

export function createLocalRepository(
  storage: StorageAdapter,
  now: () => number = Date.now,
  /** 采集通道：给了就真的上报，没给就是展示模式（提交只落在本机） */
  channel: DemandSubmitter | null = null,
): DemandRepository {
  const submit = toSubmitter(channel, now);
  return {
    loadDraft(): Draft {
      const raw = storage.getItem(DRAFT_KEY);
      if (!raw) return createDraft();
      try {
        return migrateDraft(JSON.parse(raw));
      } catch {
        return createDraft();
      }
    },
    saveDraft(draft: Draft): void {
      try {
        storage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, events: draft.events.slice(-MAX_EVENTS) }));
      } catch {
        /* 存储不可用时忽略，不打断填写 */
      }
    },
    clearDraft(): void {
      storage.removeItem(DRAFT_KEY);
    },
    track(name: EventName, props?: Record<string, unknown>): void {
      const raw = storage.getItem(DRAFT_KEY);
      const draft = raw ? migrateDraft(JSON.parse(raw)) : createDraft();
      draft.events.push({ name, at: now(), props });
      draft.events = draft.events.slice(-MAX_EVENTS);
      storage.setItem(DRAFT_KEY, JSON.stringify(draft));
    },
    /*
     * 提交走采集通道（技术方案 5.3）：正文与摘要仍然由界面留在本机，事件由调用方记
     * （本层再记一次，同一个动作就会出两条来源不同的事件）。
     */
    submit(sheet, events) {
      return submit(sheet, events);
    },
  };
}
