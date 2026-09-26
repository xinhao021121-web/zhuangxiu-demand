/**
 * 演示模式专用：种子数据 + 浏览器内共享存储。
 *
 * 用动态导入引它：真实产物里不会带上演示数据与这段代码，演示产物里也不会多出第二套逻辑
 * ——它调的还是 packages/* 里那份判据、脱敏与流水线。
 *
 * 数据落在 localStorage（三个入口同源，共用一份）：桌面端改过的清单，这里选单时看得到；
 * 这里记的现场记录，桌面端的回流报表也读得到。换一个浏览器就是换一份沙箱。
 */

import { createLocalService } from '@zx/service';
import type { LocalService } from '@zx/service';
import { createDemoPersistence } from '@zx/service';
import sheets from '../../../services/api/seed/demand-sheets.json';
import users from '../../../services/api/seed/users.json';

const persistence = createDemoPersistence();

export async function createDemoService(): Promise<LocalService> {
  const service = createLocalService({ sheets, users } as never, { persistence });
  // 采集端在演示模式下提交的需求单：同源共享的收件箱，现场端选单时也看得到
  await service.receiveSubmissions();
  // 演示时希望一进来就是「已经解读过」的状态，和两个 Demo 讲的故事一致
  await service.warmup(['d1']);
  return service;
}
