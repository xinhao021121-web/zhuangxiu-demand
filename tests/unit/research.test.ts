/**
 * 访谈材料的两道卡口（《用户研究方案》6.2 带的材料由 `pnpm run build:research` 生成）。
 *
 * 一、**不能泄漏档位**：分档卡片的全部意义在于「受访者看不到系统怎么分的」，卡片上印了
 *     序号或档位，这个任务就退化成核对答案（方案 7.2）。
 * 二、**不能与代码脱节**：卡片文字来自 `survey-checklist.json`、判定材料来自规则引擎，
 *     资产或规则一改，材料就必须重新生成——否则访谈收集到的判断没法与代码比对。
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SURVEY_CHECKLIST } from '@zx/field-spec';
import { suggestionsOf } from '@zx/rules';
import seedSheets from '../../services/api/seed/demand-sheets.json';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const CARDS = 'research/materials/分档卡片.html';
const DISCOVERY = 'research/materials/发现卡片判定材料.md';
const SHEETS = seedSheets as unknown as { id: string; form: never }[];

describe('访谈材料：分档卡片', () => {
  it('16 张卡片就是资产的 16 条，一字不改', () => {
    const html = read(CARDS);
    SURVEY_CHECKLIST.forEach((s) => {
      expect(html, `卡片里少了「${s.item}」`).toContain(s.item);
    });
    expect(html.match(/class="card"/g)).toHaveLength(SURVEY_CHECKLIST.length);
  });

  it('卡片上不能出现档位、序号或来源：印上去这个任务就变成核对答案', () => {
    const html = read(CARDS);
    ['必问', '建议问', 'must', 'suggest', 'tier', '资产', '通用项'].forEach((leak) =>
      expect(html, `卡片里漏了「${leak}」`).not.toContain(leak),
    );
    // 卡片正文里不该带序号（1. 2. 这类）；段落里的中文数字不影响
    expect(html).not.toMatch(/<span>\s*\d+[.、]/);
  });
});

describe('访谈材料：发现卡片判定材料', () => {
  it('每个场景的条数与规则引擎当时跑出来的一致', () => {
    const doc = read(DISCOVERY);
    SHEETS.forEach((sheet) => {
      const count = suggestionsOf(sheet.form).length;
      expect(doc, `${sheet.id} 的条数对不上：跑一遍 pnpm run build:research`).toContain(`共 ${count} 条`);
    });
  });

  it('抽出来的那一组确实是等距抽样，不是按优先级取前几条', () => {
    const doc = read(DISCOVERY);
    // d1 是三个场景里最满的一个：32 条里抽 8 张，采样间隔写进材料里
    const d1 = suggestionsOf(SHEETS[0].form);
    const step = Math.ceil(d1.length / 8);
    expect(doc).toContain(`每隔 ${step} 条取一条`);
    // 抽出来的第一条应该是第 0 条本身，最后一条落在被抽的位置上
    expect(doc).toContain(d1[0].title);
    expect(doc).toContain(d1[step * 7].title);
  });

  it('材料里写清它是脚本生成的，改了规则要重新生成', () => {
    const doc = read(DISCOVERY);
    expect(doc).toContain('pnpm run build:research');
    expect(doc).toContain('规则引擎');
  });
});
