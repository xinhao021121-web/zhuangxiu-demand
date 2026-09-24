/**
 * 命名与文档一致性：对外表述必须与实现一致。
 *
 * 两条约定写在这里：
 * 1. 发现引擎是确定性规则、不调用模型（见产品文档 4.7），因此面向用户的字段标记统一写
 *    「助手建议」，不写「AI 建议」。
 * 2. 产品名统一为「问需」，三个端是 问需 · 采集 / 问需 · 解读 / 问需 · 现场；对外文档只有
 *    一份产品设计文档 + 一份技术方案（两份合并前的旧文档已经不存在了）。
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

const PRODUCT_DOC = 'docs/问需_产品设计文档_V1.md';
const TECH_DOC = 'docs/问需_技术方案_V1.md';

const DOCS = ['README.md', 'demo/README.md', PRODUCT_DOC, TECH_DOC];

/** 会展示产品名的界面入口。 */
const TITLES = [
  ['landing/index.html', '<h1>问需</h1>'],
  ['landing/index.html', '<title>问需 · 作品集</title>'],
  ['app/src/app.config.ts', "'问需 · 采集'"],
  ['app/src/pages/index/index.config.ts', "'问需 · 采集'"],
  ['app/src/index.html', '<title>问需 · 采集 · 房主端</title>'],
  ['studio/src/app/layout.tsx', "title: '问需 · 解读'"],
  ['onsite/index.html', '<title>问需 · 现场</title>'],
  ['onsite/src/App.tsx', '<h1>问需 · 现场</h1>'],
  ['demo/装修需求发现助手_Demo_V0.2.html', '<title>筑云 · 问需 · 采集 Demo V0.2</title>'],
  ['mobile/装修需求发现助手_小程序端Demo_V0.1.html', '<span class="nav-title">问需 · 采集</span>'],
  ['designer/设计需求解读台_Demo_V0.1.html', '<h1>问需 · 解读</h1>'],
  ['designer/现场量房_Demo_V0.1.html', '<b>问需 · 现场</b>'],
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

describe('产品命名', () => {
  it('三个端的对外标题统一到问需体系', () => {
    TITLES.forEach(([rel, expected]) => expect(read(rel), rel).toContain(expected));
  });

  it('旧的产品名不再作为产品名出现在界面上', () => {
    TITLES.map(([rel]) => rel).forEach((rel) => {
      const text = read(rel);
      expect(text, rel).not.toContain('<h1>设计需求解读台</h1>');
      expect(text, rel).not.toContain('<title>设计需求解读台');
      expect(text, rel).not.toContain('title: \'设计需求解读台\'');
    });
  });

  it('对外文档只有两份：产品设计文档与技术方案', () => {
    const files = fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).sort();
    expect(files).toEqual(['问需_产品设计文档_V1.md', '问需_技术方案_V1.md']);
  });
});

describe('文档一致性', () => {
  it('README 列出的文档都存在', () => {
    const links = [...read('README.md').matchAll(/`(docs\/[^`]+\.md)`/g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    links.forEach((rel) => expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true));
  });

  it('采集端的发现引擎写明「刻意不交给模型」', () => {
    const doc = read(PRODUCT_DOC);
    expect(doc).toContain('刻意不交给模型');
    expect(doc).toContain('不做模型调用');
  });

  it('解读端把模型的产出限定为「要问的问题」', () => {
    const doc = read(PRODUCT_DOC);
    expect(doc).toContain('量房沟通清单');
    expect(doc).toContain('每条清单项必须能指到字段');
  });

  it('解读端承接采集端，不引入外部项目的说法', () => {
    const doc = read(PRODUCT_DOC);
    // 接采集端的数据与资产
    expect(doc).toContain('aiMarks');
    expect(doc).toContain('量房确认清单');
    expect(doc).toContain('推荐填写');
    // 不引入不属于本项目的机制
    expect(doc).not.toContain('免责等级');
    expect(doc).not.toContain('输出契约');
    expect(doc).not.toContain('设备与智能');
  });

  it('写明了脱敏与数据边界', () => {
    const doc = read(PRODUCT_DOC);
    expect(doc).toContain('脱敏');
    expect(doc).toContain('不外发');
    expect(doc).toContain('小区 / 楼盘名称');
  });

  it('按判据筛清单，不设条数上限', () => {
    const doc = read(PRODUCT_DOC);
    expect(doc).toContain('不设条数上限');
    expect(doc).toContain('影响可行性');
    expect(doc).not.toContain('不超过 15 条');
  });

  it('落实了外发确认与清单删减', () => {
    const doc = read(PRODUCT_DOC);
    expect(doc).toContain('外发前逐条确认');
    expect(doc).toContain('自由文本默认不勾选');
    expect(doc).toContain('删减');
    expect(doc).not.toContain('误伤与漏检如何取舍');
  });

  it('写明了通用清单与推导问题的合并排序规则', () => {
    const doc = read(PRODUCT_DOC);
    expect(doc).toContain('归属空间 + 核实对象');
    expect(doc).toContain('related_fields');
    expect(doc).toContain('全屋');
    expect(doc).not.toContain('16 项通用量房清单与推导出的问题如何合并去重');
  });

  it('给出了把三个端焊在一起的回流闭环', () => {
    const doc = read(PRODUCT_DOC);
    expect(doc).toContain('回流闭环');
    expect(doc).toContain('遗漏率');
    expect(doc).toContain('系统只汇总与排序，不自动改规则');
  });

  it('合并后不再保留「采集端不接设计师端」这类过时边界', () => {
    expect(read(PRODUCT_DOC)).not.toContain('不接下游设计师端');
    expect(read(TECH_DOC)).not.toContain('不做：后端服务、模型调用');
  });

  it('技术方案写明了采集通道与内部通道的分离', () => {
    const doc = read(TECH_DOC);
    expect(doc).toContain('采集通道与内部通道分离');
    expect(doc).toContain('DemandSheetImport');
  });

  it('文档版本号在表头、引用与入口页之间一致', () => {
    expect(read(PRODUCT_DOC)).toContain('问需 · 产品设计文档 V1.3');
    expect(read(TECH_DOC)).toContain('问需 · 技术方案 V1.3');
    expect(read(TECH_DOC)).toContain('《问需 · 产品设计文档》V1.3');
    expect(read('landing/index.html')).toContain('问需 · 产品设计文档 V1.3');
    expect(read('landing/index.html')).toContain('问需 · 技术方案 V1.3');
  });

  it('两份文档都带变更记录', () => {
    expect(read(PRODUCT_DOC)).toContain('附录 B：变更记录');
    expect(read(TECH_DOC)).toContain('十三、变更记录');
  });
});

describe('手机版（PWA）', () => {
  it('采集端带 manifest 与 service worker，并用问需的产品名', () => {
    const manifest = JSON.parse(read('app/pwa/manifest.webmanifest'));
    expect(manifest.name).toContain('问需');
    expect(manifest.short_name).toBe('问需采集');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    manifest.icons.forEach((icon: { src: string }) =>
      expect(fs.existsSync(path.join(ROOT, 'app', 'pwa', icon.src.replace('./', ''))), icon.src).toBe(true),
    );
    expect(read('app/pwa/sw.js')).toContain('zx-intake');
    expect(read('app/src/index.html')).toContain('rel="manifest"');
  });

  it('现场端的 manifest 也统一到问需体系', () => {
    const manifest = JSON.parse(read('onsite/public/manifest.webmanifest'));
    expect(manifest.name).toContain('问需');
    expect(manifest.short_name).toBe('问需现场');
  });

  it('小程序的工程名与描述用问需体系', () => {
    const project = JSON.parse(read('app/project.config.json'));
    expect(project.projectname).toContain('问需');
    expect(project.description).toContain('问需');
  });
});
