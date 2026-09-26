/**
 * 演示模式专用：种子数据 + 浏览器内共享存储。
 *
 * 用动态导入引它：真实产物里不会带上演示数据与这段代码，演示产物里也不会多出第二套逻辑
 * ——它调的还是 packages/* 里那份判据、脱敏与流水线。
 *
 * 数据落在 localStorage（三个入口同源，共用一份）：刷新不丢，采集端提交的需求单打开工作台
 * 就收编，现场端记的记录也会回到这里的回流报表。换一个浏览器就是换一份沙箱，评审之间互不打扰。
 */

import { createLocalService } from '@zx/service';
import type { LocalService } from '@zx/service';
import { createDemoPersistence } from '@zx/service';
import sheets from '../../../services/api/seed/demand-sheets.json';
import users from '../../../services/api/seed/users.json';

const persistence = createDemoPersistence();

export async function createDemoService(): Promise<LocalService> {
  const service = createLocalService({ sheets, users } as never, { persistence });
  // 采集端在演示模式下提交的需求单：同源共享的收件箱，打开工作台就收进来
  await service.receiveSubmissions();
  // 演示时希望一进来就是「已经解读过」的状态，和两个 Demo 讲的故事一致
  await service.warmup(['d1']);
  return service;
}

/** 重置演示数据：清掉本机这一份（含采集端收件箱），调用方随后重新加载页面。 */
export function resetDemoData(): void {
  persistence.reset();
}
