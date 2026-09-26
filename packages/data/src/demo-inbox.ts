/**
 * 演示模式的采集落点（作品集演示用）。
 *
 * 线上那份产物没有服务端，但三个入口挂在同一个域名下（`/app/`、`/studio/`、`/onsite/`），
 * 所以「房主提交的需求单」可以先放进同源的一份收件箱里，解读端一打开就把它收编——
 * 等价于采集通道接上服务端之后那条路，只是收件箱在浏览器里。
 *
 * 它只服务演示：接了采集通道（`createCollectionClient`）就不走这里；小程序端没有「同源」
 * 这回事，也不走这里（仍然是「只留本机 + 存交接文件」）。
 */

import type { DemandSheetSubmission, DemandSubmitter, StorageAdapter, TrackEvent } from './types';

/** 收件箱的存储键：解读端按同一个键读，改动它等于换一份数据。 */
export const DEMO_INBOX_KEY = 'zx.demo.inbox.v1';

/** 采集端不收集姓名，落库时统一叫这个，由设计师在桌面端改成人认得出的叫法。 */
export const DEMO_SHEET_NAME = '未命名需求单';

/**
 * 收件箱里的一条：与提交给采集通道的是同一份结构，另加两件服务端本来会补的事——
 * 需求单的叫法，以及随提交带出的埋点（技术方案 6.11 的整批上报）。
 */
export interface DemoInboxEntry extends DemandSheetSubmission {
  demandName: string;
  telemetry?: { batchId: string; events: TrackEvent[] };
}

/** 读收件箱：坏数据一律当空，演示不该因为一条脏记录打不开。 */
export function readDemoInbox(storage: StorageAdapter): DemoInboxEntry[] {
  try {
    const raw = storage.getItem(DEMO_INBOX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DemoInboxEntry[]) : [];
  } catch {
    return [];
  }
}

export function clearDemoInbox(storage: StorageAdapter): void {
  try {
    storage.removeItem(DEMO_INBOX_KEY);
  } catch {
    /* 存储不可用：没有收件箱可以清 */
  }
}

/**
 * 收件箱提交器：写进去就算送达。
 *
 * 幂等与采集通道同口径——同一个 `submissionId` 只留一条，所以「点一次、页面抖了一下」
 * 不会变成两份需求单。写不进去就抛错，由 `toSubmitter` 翻译成房主看得懂的一句话，
 * 不能让界面说「提交成功」而实际什么都没留下。
 */
export function createDemoInboxSubmitter(storage: StorageAdapter): DemandSubmitter {
  return {
    async submit(sheet, events) {
      const inbox = readDemoInbox(storage);
      const known = inbox.some((entry) => entry.submissionId === sheet.submissionId);
      if (!known) {
        inbox.push({
          ...sheet,
          demandName: DEMO_SHEET_NAME,
          telemetry: events.length ? { batchId: sheet.submissionId, events } : undefined,
        });
        storage.setItem(DEMO_INBOX_KEY, JSON.stringify(inbox));
      }
      return { id: sheet.submissionId, replay: known, acceptedEvents: known ? 0 : events.length };
    },
  };
}
