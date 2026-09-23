/**
 * 分区归属与分组顺序（产品文档 4.5.1）。
 *
 * 分组不另起一套，直接用采集端需求清单的分区：「基本信息」在最前，其余沿用 13 个大类；
 * 带实例的分区（其他卧室 / 书房与电竞房 / 卫生间）先一排公共条件组，再按实例逐个排。
 */

import { SECTIONS, findInstance, instanceName, sectionOf, splitKey } from '@zx/field-spec';
import type { FormModel } from '@zx/field-spec';

/** 「认识你家」在解读台叫「基本信息」：装的是房屋条件、家庭情况、预算与风格偏好。 */
export const BASE_SPACE = '基本信息';

const SECTION_ALIAS: Record<string, string> = { 认识你家: BASE_SPACE };

export function baseSpaceOf(section: string | undefined): string {
  if (!section) return BASE_SPACE;
  return SECTION_ALIAS[section] ?? section;
}

/** 需求单里实际存在的分组顺序：条目的分区一定落在这里面。 */
export function spaceOrder(model: FormModel): string[] {
  const out: string[] = [];
  SECTIONS.forEach((s) => {
    out.push(baseSpaceOf(s.name));
    (model.instances[s.name] ?? []).forEach((inst) => out.push(instanceName(model, inst)));
  });
  return out;
}

/** 实例名 → 它所属分区名：落不到具体实例的项退回公共条件组。 */
export function instanceSpaceMap(model: FormModel): Map<string, string> {
  const map = new Map<string, string>();
  SECTIONS.forEach((s) => {
    (model.instances[s.name] ?? []).forEach((inst) => map.set(instanceName(model, inst), baseSpaceOf(s.name)));
  });
  return map;
}

/** 字段键所在的分区：实例字段归到具体实例，固定字段归到它所属分区。 */
export function spaceOfFieldKey(model: FormModel, fieldKey: string): string {
  const [instKey, id] = splitKey(fieldKey);
  if (instKey) {
    const inst = findInstance(model, instKey);
    if (inst) return instanceName(model, inst);
  }
  return baseSpaceOf(sectionOf(id));
}

/**
 * 定一个条目的分区：先用条目自己声明的，落不到实际分组时退回它所属分区的公共条件组，
 * 再不行才归「基本信息」。这样「只显示有条目的分区」不会出现空壳。
 */
export function resolveSpace(
  model: FormModel,
  wanted: string | undefined,
  fallbackSection: string | undefined,
): string {
  const order = spaceOrder(model);
  if (wanted && order.includes(wanted)) return wanted;
  const map = instanceSpaceMap(model);
  if (wanted && map.has(wanted)) return map.get(wanted)!;
  const fallback = baseSpaceOf(fallbackSection);
  if (order.includes(fallback)) return fallback;
  return BASE_SPACE;
}
