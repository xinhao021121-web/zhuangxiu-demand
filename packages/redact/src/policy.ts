/**
 * 默认策略集：随代码发布并带版本号；公司按合规口径调整时只改这里的策略数据（产品文档 7.7）。
 *
 * 不可配置的下限：外发必须经设计师逐条确认、每次外发必须留档、模型返回必须能溯源到字段。
 */

import type { RedactionPolicy } from './types';

export const DEFAULT_POLICY: RedactionPolicy = {
  name: '默认合规策略',
  version: 'v1',
  /** 不外发：整条留下，不进入任何请求 */
  noSend: ['base_community'],
  /** 泛化后外发：本地先转成粗粒度描述 */
  generalize: [
    { field: 'base_city', label: '所在城市', kind: 'city-tier' },
    { field: 'live_ages', label: '成员年龄', kind: 'age-band' },
    { field: 'ch_gender_age', label: '孩子性别与年龄', kind: 'age-band' },
    { field: 'date_start', label: '计划动工时间', kind: 'date-relative' },
    { field: 'date_finish', label: '计划完工时间', kind: 'date-relative' },
    { field: 'date_movein', label: '计划入住时间', kind: 'date-relative' },
  ],
  /** 自由文本是唯一可能夹带人名的类别，默认不勾选 */
  freeTextDefault: 'unchecked',
  modelEndpoint: 'official',
};
