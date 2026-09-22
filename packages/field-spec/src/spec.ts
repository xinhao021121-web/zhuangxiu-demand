/** 字段规格的单一来源：由 tools/build_field_spec.py 从字段清单 Excel 导出，禁止手工编辑。 */

import fieldSpecJson from './field-spec.json';
import surveyJson from './survey-checklist.json';
import type { FieldSpec, InstanceDef, SectionSpec, SurveyItem } from './types';

export const FIELD_SPEC = fieldSpecJson as unknown as FieldSpec[];

/** 量房确认清单：不进表单，量房时交给设计师逐条确认。 */
export const SURVEY_CHECKLIST = surveyJson as unknown as SurveyItem[];

export const FIELD_BY_ID: Map<string, FieldSpec> = new Map(FIELD_SPEC.map((f) => [f.id, f]));

/** 空间实例定义：上限、默认实例、决定字段显隐的房型字段。 */
export const INSTANCE_DEF: Record<string, InstanceDef> = {
  卫生间: { max: 3, defaults: ['主卫', '客卫'], typeField: 'wc_type', namePrefix: '卫生间', other: 'wc_other' },
  其他卧室: { max: 4, defaults: [], typeField: 'room_type', namePrefix: '次卧', other: 'room_other' },
  书房与电竞房: { max: 2, defaults: [], typeField: null, namePrefix: '书房', other: 'st_other' },
};

/** 每个固定分区的「其他补充」字段：落不到具体字段的建议写到这里。 */
const SECTION_OTHER_DERIVED: Record<string, string> = Object.fromEntries(
  FIELD_SPEC.filter((f) => f.group === '其他' && f.type !== '单选' && f.type !== '多选').map((f) => [f.section, f.id]),
);

/** 补充说明分区没有「其他」组，落点固定为自由填写字段。 */
export const SECTION_OTHER: Record<string, string> = { ...SECTION_OTHER_DERIVED, 补充说明: 'note_free' };

export const SECTIONS: SectionSpec[] = (() => {
  const map = new Map<string, { name: string; scope: '固定' | '实例'; groups: Map<string, FieldSpec[]> }>();
  FIELD_SPEC.forEach((f) => {
    if (!map.has(f.section)) {
      map.set(f.section, { name: f.section, scope: INSTANCE_DEF[f.section] ? '实例' : '固定', groups: new Map() });
    }
    const sec = map.get(f.section)!;
    if (!sec.groups.has(f.group)) sec.groups.set(f.group, []);
    sec.groups.get(f.group)!.push(f);
  });
  return [...map.values()].map((s) => {
    const groups = [...s.groups.entries()].map(([name, fields]) => ({ name, fields }));
    return { name: s.name, scope: s.scope, groups, fields: groups.flatMap((g) => g.fields) };
  });
})();

export const SECTION_NAMES = SECTIONS.map((s) => s.name);

/** 推荐填写项是需求清晰度的分母，包含空间实例内的推荐项。 */
export const RECOMMENDED_FIELDS = FIELD_SPEC.filter((f) => f.suggest === '推荐填写');

export function fieldOf(id: string): FieldSpec | undefined {
  return FIELD_BY_ID.get(id);
}

export function labelOf(id: string): string {
  return FIELD_BY_ID.get(id)?.label ?? id;
}

export function optionsOf(id: string): string[] {
  return FIELD_BY_ID.get(id)?.options ?? [];
}

export function sectionOf(id: string): string | undefined {
  return FIELD_BY_ID.get(id)?.section;
}
