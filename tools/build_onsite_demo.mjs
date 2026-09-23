/**
 * 生成《现场量房》手机端 Demo：把真实字段规格、16 项通用清单、模拟需求单与现场记录注入模板。
 * 用法：node tools/build_onsite_demo.mjs
 * 模板：tools/_onsite_template.html（勿直接打开，数据是空的）
 * 产物：designer/现场量房_Demo_V0.1.html
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildDemoData } from './demo-demands.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const SPEC = read('packages/field-spec/src/field-spec.json');
const SURVEY = read('packages/field-spec/src/survey-checklist.json');

const { demands, onsite, unknown } = buildDemoData(SPEC);
if (unknown.length) {
  console.error('以下字段 ID 不存在于字段规格：', [...new Set(unknown)].join(', '));
  process.exit(1);
}

/* 现场记录的 key 是「核实对象」，与分组无关；能不能对上清单条目由冒烟测试兜住 */
const badRows = onsite.filter((r) => !r.demand || !r.key);
const dupRows = onsite.filter((r, i) => onsite.findIndex((x) => x.demand === r.demand && x.key === r.key) !== i);
if (badRows.length || dupRows.length) {
  console.error('现场记录缺 demand/key 或重复：', [...badRows, ...dupRows].map((r) => r.demand + ':' + r.key).join(', '));
  process.exit(1);
}
const tplPath = path.join(ROOT, 'tools', '_onsite_template.html');
const outPath = path.join(ROOT, 'designer', '现场量房_Demo_V0.1.html');
let html = fs.readFileSync(tplPath, 'utf8');
const inject = (token, data) => {
  if (!html.includes(token)) { console.error('模板缺少占位符：' + token); process.exit(1); }
  html = html.replace(token, JSON.stringify(data));
};
inject('/*__FIELD_SPEC__*/[]', SPEC);
inject('/*__SURVEY__*/[]', SURVEY);
inject('/*__DEMANDS__*/[]', demands);
inject('/*__ONSITE__*/[]', onsite);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log('生成 ' + path.basename(outPath) + '：' + SPEC.length + ' 个字段、' + SURVEY.length +
  ' 项通用清单、' + demands.length + ' 份需求单、' + onsite.length + ' 条现场记录，' +
  fs.statSync(outPath).size + ' 字节');
