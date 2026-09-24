/**
 * 埋点事件清单（产品文档第十章、技术方案 6.11）。
 *
 * 这里是**单一来源**：采集端按它记录，服务端按同一份清单校验上报体，指标按事件名取数。
 * 名字写错就是一份口径不明的数据，所以清单外的名字一律不记录（`createLocalRepository`）。
 *
 * 只登记「没有别的表能承载」的事件。清单删减（`checklist_items.removed`）与现场记录
 * （`site_records`）各自有表，指标直接读表，不为埋点重复落库——一处事实只有一个来源。
 *
 * 客户端事件（房主端，props 是报表取数用得到的字段）：
 * | 事件 | 什么时候记 | props |
 * | --- | --- | --- |
 * | `session` | 打开填写页，一次会话一条 | `env`（h5 / weapp）、`narrow`（窄屏）|
 * | `shown` | 助手发布了一条新的发现（会话内同一条只记一次）| `rule`、`target`、`kind` |
 * | `adopt` | 采纳 | `rule`、`target` |
 * | `ignore` | 不感兴趣 | `rule`、`id` |
 * | `keep` | 保留房主原需求 | `rule`、`id` |
 * | `quiet_on` | 进入静默 | `trigger`（manual / auto）|
 * | `install` | 手机版被加到主屏幕 | 无 |
 * | `submit` | 提交 | `length`（摘要字数）|
 *
 * 服务端事件（没有别的表能承载的瞬时动作）：
 * | 事件 | 什么时候记 | props |
 * | --- | --- | --- |
 * | `checklist_generate` | 生成一份清单 | `durationMs`、`degraded`、`model`、`items`、`must`、`suggest` |
 * | `checklist_export` | 导出清单 | `items` |
 * | `omission_log` | 遗漏补录（待 R2 的补录入口）| `space`、`criterion` |
 */

export const EVENT_NAMES = [
  // 采集端（房主手机）
  'session',
  'shown',
  'adopt',
  'ignore',
  'keep',
  'quiet_on',
  'install',
  'submit',
  // 服务端
  'checklist_generate',
  'checklist_export',
  'omission_log',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];
