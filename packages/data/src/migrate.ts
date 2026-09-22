/** 草稿迁移：字段清单升级（增删字段、改选项）后旧草稿仍可读。 */

import { FIELD_BY_ID, createModel, isEmptyValue, visibleFields } from '@zx/field-spec';
import type { FormModel, InstanceState } from '@zx/field-spec';
import { createAssistantState } from '@zx/rules';
import { SCHEMA_VERSION } from './types';
import type { Draft, TrackEvent } from './types';

type Raw = Record<string, unknown>;

const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

export function createDraft(): Draft {
  return {
    schemaVersion: SCHEMA_VERSION,
    model: createModel(),
    aiMarks: {},
    assistant: createAssistantState(),
    noNeed: {},
    events: [],
  };
}

/** 丢掉字段清单里已经不存在的字段，保留用户填过的其他内容。 */
export function pruneModel(model: FormModel): FormModel {
  const values = Object.fromEntries(
    Object.entries(model.values).filter(([id, v]) => FIELD_BY_ID.has(id) && !isEmptyValue(v)),
  );
  const instances: Record<string, InstanceState[]> = {};
  Object.entries(model.instances ?? {}).forEach(([section, list]) => {
    instances[section] = (Array.isArray(list) ? list : []).map((inst) => {
      const allowed = new Set(visibleFields(section, inst).map((f) => f.id));
      const kept = Object.fromEntries(
        Object.entries(inst.values ?? {}).filter(([id, v]) => allowed.has(id) && !isEmptyValue(v)),
      );
      return { key: inst.key, section: inst.section ?? section, values: kept };
    });
  });
  return { values, instances };
}

/**
 * 读回草稿：
 * - 缺版本号或版本号小于当前版本时按旧结构补齐；
 * - 静默状态只属于本次会话，读回后重置（见产品文档 4.7）。
 */
export function migrateDraft(raw: unknown): Draft {
  const base = createDraft();
  if (!isRecord(raw)) return base;

  const model = pruneModel(
    isRecord(raw.model)
      ? (raw.model as unknown as FormModel)
      : // 更早的结构：草稿里只有固定字段值
        { values: isRecord(raw.values) ? (raw.values as FormModel['values']) : {}, instances: {} },
  );
  const assistant = isRecord(raw.assistant)
    ? {
        handled: isRecord(raw.assistant.handled) ? (raw.assistant.handled as Draft['assistant']['handled']) : {},
        dismissStreak: Number(raw.assistant.dismissStreak) || 0,
        quiet: false,
      }
    : createAssistantState();

  return {
    schemaVersion: SCHEMA_VERSION,
    model: { ...model, instances: { ...base.model.instances, ...model.instances } },
    aiMarks: isRecord(raw.aiMarks) ? (raw.aiMarks as Draft['aiMarks']) : {},
    assistant,
    noNeed: isRecord(raw.noNeed) ? (raw.noNeed as Draft['noNeed']) : {},
    events: Array.isArray(raw.events) ? (raw.events as TrackEvent[]).slice(-200) : [],
  };
}
