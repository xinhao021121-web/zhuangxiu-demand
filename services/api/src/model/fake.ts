/**
 * 桩 provider：三个种子场景的固定输出，测试与本地开发用它跑通流程（技术方案 4.7 第 3 条）。
 *
 * 不在种子里的需求单返回空推导项——结构合法、没有越界字段，所以不算降级，
 * 清单会退化成 16 项通用核实清单。真实模型的效果实测不在这里。
 */

import sheets from '../../seed/demand-sheets.json';
import type { ModelProvider, UnderstandRequest } from './provider';

interface SeedUnderstanding {
  id: string;
  understanding: unknown;
}

const BY_ID = new Map((sheets as unknown as SeedUnderstanding[]).map((s) => [s.id, s.understanding]));

export function createFakeProvider(): ModelProvider {
  return {
    name: 'fake',
    async understand(request: UnderstandRequest) {
      return BY_ID.get(request.demandSheetId) ?? { profile: [], demands: [], conflicts: [], derivedItems: [] };
    },
  };
}
