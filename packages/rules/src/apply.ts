/** 写回动作：把一条发现落成表单字段的值，落不到字段的进大类「其他补充」。 */

import { INSTANCE_DEF, SECTION_OTHER, fieldKey, fieldOf, getValue, isEmptyValue, setValue } from '@zx/field-spec';
import type { FieldValue, FormModel } from '@zx/field-spec';
import type { Suggestion } from './types';

export interface WriteOutcome {
  model: FormModel;
  /** 实际写入的字段键 */
  key: string;
  /** 写入的内容 */
  text: string;
}

export function targetKey(s: Suggestion): string {
  return fieldKey(s.instKey, s.target);
}

/** 建议所属分区的「其他补充」字段，作为写不进去时的落点。 */
export function fallbackField(s: Suggestion): string | undefined {
  if (s.instKey) {
    const def = INSTANCE_DEF[s.section];
    if (def) return def.other;
  }
  return SECTION_OTHER[s.section];
}

/** 字段已有值时替换要二次确认。 */
export function needsConfirm(model: FormModel, s: Suggestion): boolean {
  const field = fieldOf(s.target);
  if (!field || !s.value) return false;
  const current = getValue(model, targetKey(s));
  if (field.type === '单选') return !isEmptyValue(current) && current !== s.value;
  if (field.type === '多选') return Array.isArray(current) && !current.includes(s.value);
  return false;
}

function appendText(current: FieldValue, text: string): FieldValue {
  const base = typeof current === 'string' ? current.trim() : '';
  return base ? `${base}\n${text}` : text;
}

export function applySuggestion(model: FormModel, s: Suggestion, customText?: string): WriteOutcome {
  const text = (customText ?? s.text).trim();
  const key = targetKey(s);
  const field = fieldOf(s.target);
  const current = getValue(model, key);

  if (field && s.value && field.type === '单选') {
    return { model: setValue(model, key, s.value), key, text: s.value };
  }
  if (field && s.value && field.type === '多选') {
    const list = Array.isArray(current) ? current.slice() : [];
    if (!list.includes(s.value)) list.push(s.value);
    return { model: setValue(model, key, list), key, text: s.value };
  }
  if (field && (field.type === '文本' || field.type === '长文本')) {
    return { model: setValue(model, key, appendText(current, text)), key, text };
  }

  const other = fallbackField(s);
  if (other) {
    const otherKey = fieldKey(s.instKey, other);
    return { model: setValue(model, otherKey, appendText(getValue(model, otherKey), text)), key: otherKey, text };
  }
  return { model, key, text };
}
