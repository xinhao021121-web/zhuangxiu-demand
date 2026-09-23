/**
 * 生成《问需 · 解读》Demo：把真实字段规格、16 项通用清单与模拟需求单注入模板。
 * 用法：node tools/build_designer_demo.mjs
 * 模板：tools/_designer_template.html（勿直接打开，字段数据是空的）
 * 产物：designer/设计需求解读台_Demo_V0.1.html
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildDemoData } from './demo-demands.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const SPEC = read('packages/field-spec/src/field-spec.json');
const SURVEY = read('packages/field-spec/src/survey-checklist.json');
const { demands: DEMANDS, unknown } = buildDemoData(SPEC);

if (unknown.length) {
  console.error('以下字段 ID 不存在于字段规格：', [...new Set(unknown)].join(', '));
  process.exit(1);
}

const tplPath = path.join(ROOT, 'tools', '_designer_template.html');
const outPath = path.join(ROOT, 'designer', '设计需求解读台_Demo_V0.1.html');
let html = fs.readFileSync(tplPath, 'utf8');
const inject = (token, data) => {
  if (!html.includes(token)) { console.error('模板缺少占位符：' + token); process.exit(1); }
  html = html.replace(token, JSON.stringify(data));
};
inject('/*__FIELD_SPEC__*/[]', SPEC);
inject('/*__SURVEY__*/[]', SURVEY);
inject('/*__DEMANDS__*/[]', DEMANDS);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log('生成 ' + path.basename(outPath) + '：' + SPEC.length + ' 个字段、' + SURVEY.length + ' 项通用清单、' + DEMANDS.length + ' 份需求单，' + fs.statSync(outPath).size + ' 字节');