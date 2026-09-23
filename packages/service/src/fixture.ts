/**
 * 桩 provider：用种子数据里的固定输出当模型返回，测试与线上展示版都走它（技术方案 4.7 第 3 条）。
 *
 * 不在种子里的需求单返回空推导项——结构合法、没有越界字段，所以不算降级，
 * 清单会退化成 16 项通用核实清单。真实模型的效果实测不在这里。
 */

import type { LocalSeedSheet } from './local';
import type { ModelProvider, UnderstandRequest } from './model';

export function createFixtureProvider(sheets: LocalSeedSheet[], name = 'fake'): ModelProvider {
  const byId = new Map(sheets.map((s) => [s.id, s.understanding]));
  return {
    name,
    async understand(request: UnderstandRequest) {
      return byId.get(request.demandSheetId) ?? { profile: [], demands: [], conflicts: [], derivedItems: [] };
    },
  };
}
