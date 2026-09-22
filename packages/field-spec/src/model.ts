/** 表单模型：值的读写、空间实例、按房型决定可见字段、进度统计。纯函数。 */

import { INSTANCE_DEF, RECOMMENDED_FIELDS, SECTIONS, fieldOf, labelOf } from './spec';
import type { FieldSpec, FieldValue, FormModel, InstanceState, SectionSpec } from './types';

export function isEmptyValue(v: FieldValue): boolean {
  if (v === undefined || v === null || v === '') return true;
  return Array.isArray(v) && v.length === 0;
}

/** 字段键：固定字段是 id，实例字段是「实例键.id」。 */
export function fieldKey(instanceKey: string | undefined, id: string): string {
  return instanceKey ? `${instanceKey}.${id}` : id;
}

export function splitKey(key: string): [string | undefined, string] {
  const i = key.indexOf('.');
  return i < 0 ? [undefined, key] : [key.slice(0, i), key.slice(i + 1)];
}

export function createModel(): FormModel {
  return ensureInstances({ values: {}, instances: {} });
}

function maxInstanceSeq(instances: Record<string, InstanceState[]>): number {
  return Object.values(instances)
    .flat()
    .reduce((max, inst) => {
      const n = Number(inst.key.replace(/^i/, ''));
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
}

/** 空间实例分区补齐默认实例：卫生间默认主卫与客卫。 */
export function ensureInstances(model: FormModel): FormModel {
  const instances = { ...model.instances };
  let changed = false;
  let seq = maxInstanceSeq(instances);
  Object.entries(INSTANCE_DEF).forEach(([section, def]) => {
    if (instances[section]) return;
    instances[section] = def.defaults.map((typeValue) => {
      seq += 1;
      return {
        key: `i${seq}`,
        section,
        values: def.typeField && typeValue ? { [def.typeField]: typeValue } : {},
      };
    });
    changed = true;
  });
  return changed ? { ...model, instances } : model;
}

export function addInstance(model: FormModel, section: string, typeValue?: string): FormModel {
  const def = INSTANCE_DEF[section];
  const list = model.instances[section] ?? [];
  if (!def || list.length >= def.max) return model;
  const values: Record<string, FieldValue> = {};
  if (def.typeField && typeValue) values[def.typeField] = typeValue;
  const inst: InstanceState = { key: `i${maxInstanceSeq(model.instances) + 1}`, section, values };
  return { ...model, instances: { ...model.instances, [section]: [...list, inst] } };
}

export function removeInstance(model: FormModel, section: string, key: string): FormModel {
  const list = model.instances[section] ?? [];
  if (list.length <= 1) return model;
  return { ...model, instances: { ...model.instances, [section]: list.filter((i) => i.key !== key) } };
}

export function findInstance(model: FormModel, key: string): InstanceState | undefined {
  return Object.values(model.instances)
    .flat()
    .find((i) => i.key === key);
}

export function getValue(model: FormModel, key: string): FieldValue {
  const [instKey, id] = splitKey(key);
  if (!instKey) return model.values[id];
  return findInstance(model, instKey)?.values[id];
}

export function setValue(model: FormModel, key: string, value: FieldValue): FormModel {
  const [instKey, id] = splitKey(key);
  if (!instKey) return { ...model, values: { ...model.values, [id]: value } };
  const instances = { ...model.instances };
  Object.entries(instances).forEach(([section, list]) => {
    const idx = list.findIndex((i) => i.key === instKey);
    if (idx < 0) return;
    const next = list.slice();
    next[idx] = { ...list[idx], values: { ...list[idx].values, [id]: value } };
    instances[section] = next;
  });
  return { ...model, instances };
}

/** 实例的房型取值，决定显示哪些字段。 */
export function instanceType(inst: InstanceState): string {
  const def = INSTANCE_DEF[inst.section];
  const v = def?.typeField ? inst.values[def.typeField] : '';
  return typeof v === 'string' ? v : '';
}

/** 房型决定字段显隐：一间次卧选了「儿童房」就不问长辈房的问题。 */
export function visibleFields(section: string, inst?: InstanceState): FieldSpec[] {
  const spec = SECTIONS.find((s) => s.name === section);
  if (!spec) return [];
  if (spec.scope === '固定' || !inst) return spec.fields;
  const type = instanceType(inst);
  return spec.fields.filter((f) => f.applies === '全部' || f.applies === type);
}

export function sectionSpec(section: string): SectionSpec | undefined {
  return SECTIONS.find((s) => s.name === section);
}

/** 实例名：主卫 / 次卧1 · 儿童房 / 书房2。 */
export function instanceName(model: FormModel, inst: InstanceState): string {
  const def = INSTANCE_DEF[inst.section];
  if (!def) return inst.section;
  const list = model.instances[inst.section] ?? [];
  const base = def.namePrefix + (list.findIndex((i) => i.key === inst.key) + 1);
  const type = instanceType(inst);
  if (inst.section === '卫生间') return type || base;
  if (inst.section === '书房与电竞房') return base;
  return base + (type ? ` · ${type}` : '');
}

/** 需求清晰度：推荐填写项完成度（含实例内的推荐项），没有任何必填项。 */
export function recommendStats(model: FormModel): { total: number; done: number; percent: number } {
  let total = 0;
  let done = 0;
  RECOMMENDED_FIELDS.forEach((f) => {
    if (f.scope === '固定') {
      total += 1;
      if (!isEmptyValue(model.values[f.id])) done += 1;
      return;
    }
    (model.instances[f.section] ?? []).forEach((inst) => {
      total += 1;
      if (!isEmptyValue(inst.values[f.id])) done += 1;
    });
  });
  return { total, done, percent: total ? Math.round((done / total) * 100) : 0 };
}

/** 分区完成度：用于分区导航的进度点。 */
export function sectionStats(model: FormModel, section: string): { total: number; filled: number; count: number } {
  const spec = sectionSpec(section);
  if (!spec) return { total: 0, filled: 0, count: 0 };
  if (spec.scope === '固定') {
    return {
      total: spec.fields.length,
      filled: spec.fields.filter((f) => !isEmptyValue(model.values[f.id])).length,
      count: 0,
    };
  }
  const list = model.instances[section] ?? [];
  let total = 0;
  let filled = 0;
  list.forEach((inst) => {
    const fields = visibleFields(section, inst);
    total += fields.length;
    filled += fields.filter((f) => !isEmptyValue(inst.values[f.id])).length;
  });
  return { total, filled, count: list.length };
}

export function recLabel(id: string): string {
  if (!fieldOf(id)) return id;
  return labelOf(id);
}