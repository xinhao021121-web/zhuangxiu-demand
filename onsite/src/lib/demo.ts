/**
 * 演示模式专用：种子数据 + 内存实现。
 *
 * 用动态导入引它：真实产物里不会带上演示数据与这段代码，演示产物里也不会多出第二套逻辑
 * ——它调的还是 packages/* 里那份判据、脱敏与流水线。
 */

import { createLocalService } from '@zx/service';
import type { LocalService } from '@zx/service';
import sheets from '../../../services/api/seed/demand-sheets.json';
import users from '../../../services/api/seed/users.json';

export async function createDemoService(): Promise<LocalService> {
  const service = createLocalService({ sheets, users } as never);
  // 演示时希望一进来就是「已经解读过」的状态，和两个 Demo 讲的故事一致
  await service.warmup(['d1']);
  return service;
}
