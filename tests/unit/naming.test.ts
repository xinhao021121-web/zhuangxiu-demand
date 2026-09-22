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
  'docs/装修需求理解Agent_产品设计文档_V1.md',
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
});