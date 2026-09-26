/**
 * 浏览器内共享演示存储（作品集演示）。
 *
 * 这份测试守三件事：刷新不丢（再打开一次读到的是同一份）、三个入口共用一份
 * （采集端写进收件箱 → 解读端收编 → 现场端的记录回到报表），以及一份坏数据
 * 或者干脆没有存储时，演示照样打得开。
 *
 * 「再打开一个端」在这里就是：拿同一份 storage 再 `createLocalService` 一次。
 */

import { describe, expect, it } from 'vitest';
import { createMemoryStorage, createDemoInboxSubmitter, readDemoInbox } from '@zx/data';
import type { DemandSubmitter, StorageAdapter } from '@zx/data';
import { createDemoPersistence, createLocalService } from '@zx/service';
import sheetsSeed from '../../services/api/seed/demand-sheets.json';
import usersSeed from '../../services/api/seed/users.json';

const seed = () => ({ sheets: sheetsSeed as never, users: usersSeed as never });

/** 打开一个端：同一份 storage 就是同一个浏览器。 */
const open = (storage: StorageAdapter | null) =>
  createLocalService(seed(), { persistence: createDemoPersistence(storage) });

const submission = (submissionId: string) => ({
  submissionId,
  schemaVersion: '1.0',
  submittedAt: '2026-09-26T01:00:00.000Z',
  source: 'miniapp' as const,
  form: { values: { base_area: 76, base_house_state: '毛坯' }, instances: {} } as never,
  aiMarks: [],
});

describe('共享演示存储', () => {
  it('刷新不丢：第二次打开读到的是同一份', async () => {
    const storage = createMemoryStorage();
    const first = open(storage);
    expect(await first.listSheets()).toHaveLength(3);

    const view = await first.generate('d1');
    await first.renameSheet('d1', '张先生（改过名）');

    // 第二个端 / 刷新之后
    const again = open(storage);
    const list = await again.listSheets();
    expect(list).toHaveLength(3);
    expect(list.find((s) => s.id === 'd1')?.demandName).toBe('张先生（改过名）');
    expect((await again.checklist(view.id)).items.length).toBe(view.items.length);
  });

  it('三个入口共用一份：删减、现场记录都回到解读端的报表里', async () => {
    const storage = createMemoryStorage();
    const studio = open(storage);
    const view = await studio.generate('d1');
    const [removedItem, askedItem] = view.items;

    await studio.setItemRemoved(view.id, removedItem.key, true);
    // 现场端：一条「没问上」的记录，同步回共享存储
    await studio.pushRecords(view.id, [
      {
        id: 'r-1',
        itemKey: askedItem.key,
        status: 'skip',
        note: '房主不在现场',
        at: '2026-09-26T02:00:00.000Z',
        operator: '演示账号',
      },
    ]);

    const onsite = open(storage);
    expect((await onsite.checklist(view.id)).removedKeys).toContain(removedItem.key);
    const reports = await onsite.reports();
    expect(reports.criteria.some((row) => row.removed > 0)).toBe(true);
    expect(reports.fields.some((row) => row.skipped > 0)).toBe(true);
  });

  it('采集端提交收进收件箱，解读端一打开就收编（名字与来源同口径）', async () => {
    const storage = createMemoryStorage();
    const submitter: DemandSubmitter = createDemoInboxSubmitter(storage);
    const receipt = await submitter.submit(submission('a-test-1') as never, []);
    expect(receipt.id).toBe('a-test-1');

    const studio = open(storage);
    expect(await studio.listSheets()).toHaveLength(3); // 还没收编
    expect(await studio.receiveSubmissions()).toBe(1);

    const list = await studio.listSheets();
    expect(list).toHaveLength(4);
    const added = list.find((s) => s.id === 'a-test-1');
    expect(added?.demandName).toBe('未命名需求单');
    expect(added?.source).toBe('miniapp');
    expect(added?.hasChecklist).toBe(false);
  });

  it('同一份需求单重复提交不落第二份（与采集通道同口径的幂等）', async () => {
    const storage = createMemoryStorage();
    const submitter = createDemoInboxSubmitter(storage);
    await submitter.submit(submission('a-test-2') as never, []);
    const replay = await submitter.submit(submission('a-test-2') as never, []);
    expect(replay.replay).toBe(true);

    const studio = open(storage);
    await studio.receiveSubmissions();
    expect((await studio.listSheets()).filter((s) => s.id === 'a-test-2')).toHaveLength(1);
    expect(await studio.receiveSubmissions()).toBe(0);
  });

  it('随提交带出的埋点落成客户端事件：规则健康度看得到房主那边的拒绝', async () => {
    const storage = createMemoryStorage();
    const submitter = createDemoInboxSubmitter(storage);
    await submitter.submit(submission('a-test-3') as never, [
      { name: 'shown', at: Date.parse('2026-09-26T00:59:00.000Z'), props: { rule: 'budget-communication' } },
      { name: 'ignore', at: Date.parse('2026-09-26T00:59:30.000Z'), props: { rule: 'budget-communication' } },
    ] as never);

    const studio = open(storage);
    await studio.receiveSubmissions();
    const rule = (await studio.reports()).rules.find((row) => row.ruleId === 'budget-communication');
    expect(rule?.shown).toBe(1);
    expect(rule?.rejected).toBe(1);
  });

  it('版本对不上或内容坏了：回到种子，不把演示打不开', async () => {
    for (const raw of ['{"version":2,"sheets":[]}', '{oops']) {
      const storage = createMemoryStorage({ 'zx.demo.state.v1': raw });
      expect(await open(storage).listSheets()).toHaveLength(3);
    }
  });

  it('没有存储（隐私模式）也能跑：不落盘，也不报错', async () => {
    const service = open(null);
    expect(await service.listSheets()).toHaveLength(3);
    await service.generate('d1');
    expect(await service.receiveSubmissions()).toBe(0);
    await service.resetDemo();
    expect(await service.listSheets()).toHaveLength(3);
  });

  it('重置演示数据：回到种子，采集端收件箱也清空', async () => {
    const storage = createMemoryStorage();
    await createDemoInboxSubmitter(storage).submit(submission('a-test-4') as never, []);
    const studio = open(storage);
    await studio.receiveSubmissions();
    await studio.generate('d1');
    expect(await studio.listSheets()).toHaveLength(4);

    await studio.resetDemo();

    expect(readDemoInbox(storage)).toHaveLength(0);
    const fresh = await open(storage).listSheets();
    expect(fresh).toHaveLength(3);
    expect(fresh.every((s) => !s.hasChecklist)).toBe(true);
  });
});
