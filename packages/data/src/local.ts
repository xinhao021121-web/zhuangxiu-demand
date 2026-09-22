/** 本地实现的仓储：草稿、埋点、提交都只落在本机存储，接云端时只换实现。 */

import { createDraft, migrateDraft } from './migrate';
import type { DemandRepository, Draft, StorageAdapter } from './types';

export const DRAFT_KEY = 'zx.demand.draft';

const MAX_EVENTS = 200;

export function createMemoryStorage(initial: Record<string, string> = {}): StorageAdapter {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

export function createLocalRepository(storage: StorageAdapter, now: () => number = Date.now): DemandRepository {
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
    track(name: string, props?: Record<string, unknown>): void {
      const raw = storage.getItem(DRAFT_KEY);
      const draft = raw ? migrateDraft(JSON.parse(raw)) : createDraft();
      draft.events.push({ name, at: now(), props });
      draft.events = draft.events.slice(-MAX_EVENTS);
      storage.setItem(DRAFT_KEY, JSON.stringify(draft));
    },
    submit({ summary }): { ok: boolean; at: number } {
      const at = now();
      this.track('submit', { length: summary.length });
      return { ok: true, at };
    },
  };
}
