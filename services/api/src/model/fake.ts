/**
 * 桩 provider：读 services/api/seed 里的固定输出，测试与本地开发用它跑通流程。
 *
 * 实现搬到了 @zx/service（展示版也要用同一份），这里只负责把种子文件接上。
 */

import { createFixtureProvider } from '@zx/service';
import sheets from '../../seed/demand-sheets.json';
import type { ModelProvider } from '@zx/service';

export function createFakeProvider(): ModelProvider {
  return createFixtureProvider(sheets as never, 'fake');
}
