/**
 * 命名与文档一致性：对外表述必须与实现一致。
 * 发现引擎是确定性规则、不调用模型（见产品文档 4.2），
 * 因此面向用户的字段标记统一写「助手建议」，不写「AI 建议」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 会打包给用户看到的产物：正式实现、两套 Demo 与它们的模板。 */
const UI_ARTIFACTS = [
  'app/src/components/Form.tsx',
  'tools/_demo_template.html',
  'tools/_mobile_template.html',
  'demo/装修需求发现助手_Demo_V0.2.html',
  'mobile/装修需求发现助手_小程序端Demo_V0.1.html',
];

const DOCS = [
  'README.md',
  'demo/README.md',
  'docs/装修需求发现助手_产品设计文档_V1.md',
  'docs/装修需求发现助手_技术方案_V1.md',
  'docs/设计需求解读台_产品设计文档_V1.md',
];

describe('面向用户的表述', () => {
  it('产物里不再出现「AI 建议」', () => {
    UI_ARTIFACTS.forEach((rel) => expect(read(rel), rel).not.toContain('AI 建议'));
  });

  it('字段标记统一写「助手建议 · 撤销」', () => {
    const withBadge = [
      'app/src/components/Form.tsx',
      'tools/_demo_template.html',
      'demo/装修需求发现助手_Demo_V0.2.html',
    ];
    withBadge.forEach((rel) => expect(read(rel), rel).toContain('助手建议 · 撤销'));
  });

  it('文档里不再出现「AI 建议」', () => {
    DOCS.forEach((rel) => expect(read(rel), rel).not.toContain('AI 建议'));
  });
});

describe('文档一致性', () => {
  it('README 列出的文档都存在', () => {
    const links = [...read('README.md').matchAll(/`(docs\/[^`]+\.md)`/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    links.forEach((rel) => expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true));
  });

  it('产品文档写明了「规则刻意不交给模型」这条判断', () => {
    const doc = read('docs/装修需求发现助手_产品设计文档_V1.md');
    expect(doc).toContain('刻意不交给模型');
    expect(doc).toContain('不做模型调用');
  });

  it('设计需求解读台文档把模型的产出限定为「要问的问题」', () => {
    const doc = read('docs/设计需求解读台_产品设计文档_V1.md');
    expect(doc).toContain('量房沟通清单');
    expect(doc).toContain('每条清单项必须能指到字段');
  });

  it('设计需求解读台文档承接采集端，不引入外部项目的说法', () => {
    const doc = read('docs/设计需求解读台_产品设计文档_V1.md');
    // 接采集端的数据与资产
    expect(doc).toContain('aiMarks');
    expect(doc).toContain('量房确认清单');
    expect(doc).toContain('推荐填写');
    // 不引入不属于本项目的机制
    expect(doc).not.toContain('免责等级');
    expect(doc).not.toContain('输出契约');
    expect(doc).not.toContain('设备与智能');
  });

  it('设计需求解读台文档写明了脱敏与数据边界', () => {
    const doc = read('docs/设计需求解读台_产品设计文档_V1.md');
    expect(doc).toContain('脱敏');
    expect(doc).toContain('不外发');
    expect(doc).toContain('小区 / 楼盘名称');
  });

  it('设计需求解读台文档按判据筛清单，不设条数上限', () => {
    const doc = read('docs/设计需求解读台_产品设计文档_V1.md');
    expect(doc).toContain('不设条数上限');
    expect(doc).toContain('影响可行性');
    expect(doc).not.toContain('不超过 15 条');
  });

  it('设计需求解读台文档落实了外发确认与清单删减', () => {
    const doc = read('docs/设计需求解读台_产品设计文档_V1.md');
    expect(doc).toContain('外发前逐条确认');
    expect(doc).toContain('自由文本默认不勾选');
    expect(doc).toContain('删减');
    expect(doc).not.toContain('误伤与漏检如何取舍');
  });

  it('设计需求解读台文档写明了通用清单与推导问题的合并排序规则', () => {
    const doc = read('docs/设计需求解读台_产品设计文档_V1.md');
    expect(doc).toContain('归属空间 + 核实对象');
    expect(doc).toContain('related_fields');
    expect(doc).toContain('全屋');
    expect(doc).not.toContain('16 项通用量房清单与推导出的问题如何合并去重');
  });
});