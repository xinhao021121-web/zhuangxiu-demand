/**
 * 种子场景：89㎡ 旧房翻新，夫妻 + 女儿 + 猫，与两个 Demo 讲的是同一家人。
 *
 * 数据本身放在 services/api/seed/demand-sheets.json：API、单测与两个端读同一份，
 * 避免「两个 Demo 讲的故事对不上」这类问题在实现里重演。
 *
 * 刻意留空「是否有老人或行动不便成员」「计划入住时间」与客卫的泡澡需求，
 * 这三项加上「新风：不确定」，构成表格理解里的待确认项。
 */

import sheets from '../../../services/api/seed/demand-sheets.json';
import { buildOverview } from '@zx/summary';
import type { FormModel } from '@zx/field-spec';
import type { DerivedItem } from '@zx/checklist';

export interface SeedSheet {
  id: string;
  demandName: string;
  schemaVersion: string;
  submittedAt: string;
  source: string;
  aiMarks: string[];
  form: FormModel;
  understanding: { derivedItems: DerivedItem[] };
}

export const SEED_SHEETS = sheets as unknown as SeedSheet[];

const seedOf = (id: string): SeedSheet => {
  const sheet = SEED_SHEETS.find((s) => s.id === id);
  if (!sheet) throw new Error(`种子场景 ${id} 不存在`);
  return sheet;
};

export const SEED_SHEET = seedOf('d1');
export const SEED_NAME = SEED_SHEET.demandName;
export const SEED_SUBMITTED = SEED_SHEET.submittedAt;
export const SEED_MODEL = SEED_SHEET.form;
export const SEED_AI_MARKS = SEED_SHEET.aiMarks;
export const SEED_DERIVED = SEED_SHEET.understanding.derivedItems;
export const SEED_OVERVIEW = buildOverview(SEED_MODEL, []);
/** 生成时刻：泛化「计划入住时间」这类相对时间段以它为基准。 */
export const SEED_NOW = new Date('2026-09-23T10:00:00+08:00');
