/**
 * 字段级三级策略 → 外发 payload 与审计记录（技术方案 4.5）。
 *
 * 顺序不能颠倒：先做数据最小化，再谈脱敏。不外发字段不进任何请求；
 * 可泛化字段本地降级；自由文本先替换；外发记录与当次生效的策略版本一起落库。
 */

import { fieldKey, fieldOf, instanceName, isEmptyValue, labelOf } from '@zx/field-spec';
import type { FieldSpec, FieldValue, FormModel } from '@zx/field-spec';
import { generalizeValue } from './generalize';
import { redactText } from './text';
import type {
  OutboundField,
  OutboundPayload,
  OutboundRecord,
  PreviewGroup,
  PreviewRow,
  RedactionPolicy,
} from './types';

/** 界面上分的四类：不外发 / 泛化后外发 / 自由文本 / 原样外发。 */
export type FieldCategory = 'no-send' | 'generalize' | 'free-text' | 'raw';

export interface FieldRef {
  /** 字段键：固定字段是 id，实例字段是「实例键.id」 */
  fieldKey: string;
  id: string;
  label: string;
  value: string;
}

export function show(v: FieldValue): string {
  if (Array.isArray(v)) return v.join('、');
  if (v === undefined || v === null || v === '') return '';
  return String(v);
}

export function isFreeText(f: FieldSpec | undefined): boolean {
  return !!f && (f.type === '文本' || f.type === '长文本');
}

/** 这份需求单里所有填了值的字段，含实例字段。 */
export function iterFields(model: FormModel): FieldRef[] {
  const out: FieldRef[] = [];
  Object.entries(model.values).forEach(([id, v]) => {
    if (isEmptyValue(v)) return;
    out.push({ fieldKey: id, id, label: labelOf(id), value: show(v) });
  });
  Object.entries(model.instances).forEach(([, list]) => {
    list.forEach((inst) => {
      Object.entries(inst.values).forEach(([id, v]) => {
        if (isEmptyValue(v)) return;
        const f = fieldOf(id);
        out.push({
          fieldKey: fieldKey(inst.key, id),
          id,
          label: f ? `${f.label}（${instanceName(model, inst)}）` : id,
          value: show(v),
        });
      });
    });
  });
  return out;
}

/**
 * 字段级三级策略。字段清单里没有的字段默认不外发——能不外发的就不外发，
 * 这也是字段清单升级后旧需求单仍然可读的前提（技术方案 4.6）。
 */
export function categoryOf(id: string, policy: RedactionPolicy): FieldCategory {
  const f = fieldOf(id);
  if (!f) return 'no-send';
  if (policy.noSend.includes(id)) return 'no-send';
  if (policy.generalize.some((g) => g.field === id)) return 'generalize';
  if (isFreeText(f)) return 'free-text';
  return 'raw';
}

/** 默认勾选：选项类字段默认勾选；自由文本按策略默认（默认不勾选）。 */
export function defaultSelection(model: FormModel, policy: RedactionPolicy): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  iterFields(model).forEach((ref) => {
    const category = categoryOf(ref.id, policy);
    if (category === 'no-send') out[ref.fieldKey] = false;
    else if (category === 'free-text') out[ref.fieldKey] = policy.freeTextDefault === 'checked';
    else out[ref.fieldKey] = true;
  });
  return out;
}

const GROUP_META: { tier: PreviewGroup['tier']; title: string; hint: string }[] = [
  { tier: 'no-send', title: '不外发｜留在本机', hint: '这些内容不进入任何请求' },
  { tier: 'generalize', title: '泛化后外发', hint: '本地先转成粗粒度描述' },
  { tier: 'free-text', title: '自由文本｜默认不勾选', hint: '唯一可能夹带姓名的类别，需要你主动判断' },
  { tier: 'raw', title: '原样外发｜选项类字段', hint: '本身就是粗粒度选项，不含可识别信息' },
];

/**
 * 外发前逐条确认用的数据（F3）。
 *
 * 确认对象是脱敏之后、真正要外发的内容：命中脱敏的位置标注出来，
 * 让设计师知道发生了什么；不外发分组里的原文只在本机展示。
 */
export function previewOutbound(
  model: FormModel,
  policy: RedactionPolicy,
  selected?: Record<string, boolean>,
  now: Date = new Date(),
): PreviewGroup[] {
  const chosen = selected ?? defaultSelection(model, policy);
  const buckets: Record<FieldCategory, PreviewRow[]> = {
    'no-send': [],
    generalize: [],
    'free-text': [],
    raw: [],
  };
  iterFields(model).forEach((ref) => {
    const category = categoryOf(ref.id, policy);
    const selectable = category !== 'no-send';
    const row: PreviewRow = {
      fieldKey: ref.fieldKey,
      label: ref.label,
      value: ref.value,
      hits: [],
      selectable,
      selected: selectable ? !!chosen[ref.fieldKey] : false,
    };
    if (category === 'generalize') {
      const rule = policy.generalize.find((g) => g.field === ref.id)!;
      row.label = rule.label;
      row.value = `${ref.value} → ${generalizeValue(rule.kind, ref.value, now)}`;
    } else if (category === 'free-text') {
      const r = redactText(ref.value);
      row.value = r.text;
      row.hits = r.hits;
    }
    buckets[category].push(row);
  });
  return GROUP_META.map((meta) => ({ ...meta, rows: buckets[meta.tier] }));
}

export interface OutboundInput {
  model: FormModel;
  policy: RedactionPolicy;
  operator: string;
  at: string;
  /** 设计师逐条确认的结果；缺省用默认勾选 */
  selected?: Record<string, boolean>;
  now?: Date;
}

/** 一次外发：payload 给模型，record 落库留档，两者来自同一次计算。 */
export function buildOutbound(input: OutboundInput): { payload: OutboundPayload; record: OutboundRecord } {
  const { model, policy } = input;
  const chosen = input.selected ?? defaultSelection(model, policy);
  const now = input.now ?? new Date();
  const fields: OutboundField[] = [];
  const withheld: OutboundPayload['withheld'] = [];
  const kept: OutboundRecord['redactions'] = [];
  let unselectedFreeText = 0;

  iterFields(model).forEach((ref) => {
    const category = categoryOf(ref.id, policy);
    if (category === 'no-send') {
      withheld.push({ fieldKey: ref.fieldKey, label: ref.label });
      return;
    }
    if (!chosen[ref.fieldKey]) {
      if (category === 'free-text') unselectedFreeText += 1;
      return;
    }
    if (category === 'generalize') {
      const rule = policy.generalize.find((g) => g.field === ref.id)!;
      fields.push({
        fieldKey: ref.fieldKey,
        label: rule.label,
        value: generalizeValue(rule.kind, ref.value, now),
        tier: 'generalize',
        hits: [],
      });
      return;
    }
    if (category === 'free-text') {
      const r = redactText(ref.value);
      fields.push({ fieldKey: ref.fieldKey, label: ref.label, value: r.text, tier: 'raw', hits: r.hits });
      if (r.hits.length) {
        kept.push({
          fieldKey: ref.fieldKey,
          label: ref.label,
          kinds: [...new Set(r.hits.map((h) => h.kind))],
          count: r.hits.length,
        });
      }
      return;
    }
    fields.push({ fieldKey: ref.fieldKey, label: ref.label, value: ref.value, tier: 'raw', hits: [] });
  });

  return {
    payload: {
      policyName: policy.name,
      policyVersion: policy.version,
      fields,
      withheld,
      unselectedFreeText,
    },
    record: {
      policyName: policy.name,
      policyVersion: policy.version,
      fieldKeys: fields.map((f) => f.fieldKey),
      redactions: kept,
      unselectedFreeText,
      at: input.at,
      operator: input.operator,
    },
  };
}
