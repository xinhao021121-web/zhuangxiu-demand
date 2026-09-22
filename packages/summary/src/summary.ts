/**
 * 需求摘要：把已填字段与已确认的发现拼成一段人话，MVP 不调用模型。
 *
 * 分为两份：给业主核对的完整摘要（按空间展开），以及 150 字以内的核心摘要。
 */

import { SECTIONS, SURVEY_CHECKLIST, isEmptyValue, instanceName, visibleFields } from '@zx/field-spec';
import type { FieldValue, FormModel } from '@zx/field-spec';

/** 核心摘要的字数上限。 */
export const OVERVIEW_LIMIT = 150;

function show(v: FieldValue): string {
  if (Array.isArray(v)) return v.join('、');
  if (v === undefined || v === null || v === '') return '';
  return String(v);
}

/** 150 字以内的核心摘要，用于列表与分享。 */
export function buildOverview(model: FormModel, adopted: string[]): string {
  const v = model.values;
  const parts = [
    `${show(v.base_area) || '面积待确认'}㎡`,
    show(v.base_house_state) || '房屋现状待确认',
    `预算 ${show(v.budget_total) || '待确认'}`,
    `家庭成员 ${show(v.live_members) || '待确认'}`,
  ];
  const mind = show(v.live_pet) ? `，养${show(v.live_pet)}` : '';
  const rooms = (model.instances['卫生间'] ?? []).length;
  const tail = adopted.length ? `，已确认 ${adopted.length} 条助手发现。` : '。';
  const text = `${parts.join(' · ')}${mind}${rooms ? `，${rooms} 个卫生间` : ''}${tail}`;
  return text.length <= OVERVIEW_LIMIT ? text : `${text.slice(0, OVERVIEW_LIMIT - 1)}…`;
}

/** 完整需求摘要：按空间展开已填内容，并列出助手发现并确认的需求。 */
export function buildSummary(model: FormModel, adopted: string[]): string {
  const lines: string[] = [];
  const v = model.values;
  lines.push(
    `【需求摘要】${show(v.base_area) || '-'}㎡ · ${show(v.base_house_state) || '-'} · ${
      show(v.style_pref) || '-'
    } · 预算 ${show(v.budget_total) || '-'}`,
  );

  let firstSection = true;
  SECTIONS.filter((s) => s.scope === '固定').forEach((s) => {
    const items = s.fields
      .filter((f) => !isEmptyValue(model.values[f.id]))
      .map((f) => `${f.label}：${show(model.values[f.id])}`);
    if (!items.length) return;
    lines.push('');
    lines.push(firstSection ? `一、${s.name}` : `· ${s.name}`);
    firstSection = false;
    lines.push(`  ${items.join('；')}`);
  });

  SECTIONS.filter((s) => s.scope === '实例').forEach((s) => {
    const list = model.instances[s.name] ?? [];
    if (!list.length) return;
    lines.push('');
    lines.push(`· ${s.name}（${list.length} 个）`);
    list.forEach((inst) => {
      const items = visibleFields(s.name, inst)
        .filter((f) => !isEmptyValue(inst.values[f.id]))
        .map((f) => `${f.label}：${show(inst.values[f.id])}`);
      lines.push(`  ${instanceName(model, inst)}：${items.join('；') || '（未填写）'}`);
    });
  });

  if (adopted.length) {
    lines.push('');
    lines.push('二、助手发现并确认的需求');
    adopted.forEach((t) => lines.push(`  · ${t}`));
  }
  return lines.join('\n');
}

/** 量房确认清单：16 项不进表单的内容，量房时交给设计师逐条确认。 */
export function buildSurveyChecklist(): string {
  const lines = [`【量房确认清单】共 ${SURVEY_CHECKLIST.length} 项，量房时由设计师现场逐条确认`];
  SURVEY_CHECKLIST.forEach((item) => {
    lines.push(`${item.no}. ${item.item}（${item.goal}）`);
  });
  return lines.join('\n');
}
