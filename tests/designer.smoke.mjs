/**
 * 设计需求解读台 Demo 冒烟测试：跑通「需求单列表 → 原始表格 → 外发前确认 → 表格理解 → 量房清单（删减/撤销）→ 导出」。
 * 运行：node tests/designer.smoke.mjs
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { launchBrowser } from './browser.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PAGE = pathToFileURL(path.join(ROOT, 'designer', '设计需求解读台_Demo_V0.1.html')).href;
const SHOT = path.join(ROOT, 'designer', 'screenshots');

const fails = [];
const ok = (cond, msg) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + msg); if (!cond) fails.push(msg); };
const count = (page, sel) => page.locator(sel).count();
const text = (page, sel) => page.locator(sel).first().innerText();

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(PAGE);
await page.waitForTimeout(400);
fs.mkdirSync(SHOT, { recursive: true });

// 一、需求单列表
ok(await count(page, '.dcard') === 3, '左侧列出 3 份需求单');
ok((await text(page, '.dcard.on')).includes('张先生'), '默认选中主场景需求单');
ok((await text(page, '.dcard.on')).includes('已解读'), '主场景标记为已解读');
ok(await count(page, '.st.wait') === 2, '另外两份标记为待解读');
ok((await text(page, '.head')).includes('推荐项完成度'), '详情头部显示推荐项完成度');

// 二、房主填写的表格
ok(await count(page, '.sec') === 13, '原始表格渲染 13 个大类');
ok(await count(page, '.sec-b') >= 1, '第一个大类默认展开');
await page.locator('.sec-h[data-sec="厨房"]').click();
await page.locator('.sec-h[data-sec="主卧"]').click();
await page.locator('.sec-h[data-sec="阳台"]').click();
await page.waitForTimeout(200);
ok(await count(page, '.tag') >= 3, '字段上标出「助手建议」来源');
const openBefore = await count(page, '.sec-b');
await page.locator('.sec-h[data-sec="厨房"]').click();
await page.waitForTimeout(150);
ok(await count(page, '.sec-b') === openBefore - 1, '展开的分区可以再收起');
ok((await page.locator('[data-fld="base_other"]').innerText()).includes('13812345678'), '自由文本原文只在本机展示');
await page.screenshot({ path: path.join(SHOT, '01-原始表格.png') });

// 三、表格理解
await page.locator('.tab[data-tab="under"]').click();
await page.waitForTimeout(250);
ok(await count(page, '.card') === 4, '表格理解分四块');
ok((await text(page, '.card')).includes('家庭'), '第一块是客户画像');
ok((await page.locator('.card').last().innerText()).includes('待确认项'), '最后一块是待确认项');
ok(await count(page, '.card:last-child .sline') >= 3, '待确认项不少于 3 条');
await page.screenshot({ path: path.join(SHOT, '02-表格理解.png') });

// 四、量房沟通清单
await page.locator('.tab[data-tab="list"]').click();
await page.waitForTimeout(250);
const totalItems = await count(page, '.item');
ok(totalItems >= 15, '清单条目数 ' + totalItems + ' 条（不设条数上限）');
ok((await text(page, '.grp')).startsWith('全屋'), '「全屋」排在第一个分组');
ok((await text(page, '.card h3')).includes('必问'), '顶部给出必问计数');
ok((await page.locator('.badge.b-src-both').count()) >= 3, '推导项与通用项已合并（存在「需求推导 + 通用核实」标记）');
ok((await page.locator('.item').first().innerText()).includes('为什么问'), '每条含「为什么问」');
ok((await page.locator('.item').first().innerText()).includes('现场要核实'), '每条含「现场要核实」');
await page.screenshot({ path: path.join(SHOT, '03-量房清单.png') });

// 五、删减与撤销
const before = await count(page, '.item:not(.del)');
await page.locator('[data-act="del"]').first().click();
await page.waitForTimeout(200);
ok(await count(page, '.item:not(.del)') === before - 1, '删减后生效');
ok((await text(page, '.item.del [data-act="del"]')).includes('撤销'), '删减后可撤销');
await page.screenshot({ path: path.join(SHOT, '04-删减.png') });
await page.locator('.item.del [data-act="del"]').first().click();
await page.waitForTimeout(200);
ok(await count(page, '.item:not(.del)') === before, '撤销后恢复');

// 六、关联字段定位
await page.locator('[data-jump]').first().click();
await page.waitForTimeout(300);
ok(await count(page, '.fld.found') === 1, '点关联字段跳回表格并高亮');
ok(await count(page, '.tab.on') === 1 && (await text(page, '.tab.on')).includes('表格'), '自动切回原始表格');
await page.screenshot({ path: path.join(SHOT, '05-定位字段.png') });

// 七、待解读需求单 → 外发前确认
// 主场景：自由文本里含手机号与门牌地址，用它验证脱敏与默认勾选
await page.locator('#btn-replay').click();
await page.waitForTimeout(300);
ok(await page.locator('#modal').evaluate((el) => el.classList.contains('on')), '重新解读同样先弹外发确认');
const modal1 = await text(page, '#modal');
ok(modal1.includes('不外发'), '确认界面标出「不外发」分组');
ok(modal1.includes('泛化后外发'), '确认界面标出「泛化后外发」分组');
ok(modal1.includes('自由文本｜默认不勾选'), '确认界面标出自由文本分组');
ok(modal1.includes('已隐去：手机号'), '命中的手机号被隐去');
ok(modal1.includes('原文含：'), '标注原文里命中了哪类信息');
ok(!modal1.includes('13812345678'), '脱敏后的外发内容里不再出现手机号');
const checks = page.locator('input[data-send]');
const n = await checks.count();
let unchecked = 0;
for (let i = 0; i < n; i++) if (!(await checks.nth(i).isChecked())) unchecked++;
ok(n >= 3, '自由文本条目共 ' + n + ' 条');
ok(n > 0 && unchecked === n, '自由文本默认不勾选（' + unchecked + '/' + n + '）');
await page.screenshot({ path: path.join(SHOT, '06-外发前确认.png') });
await page.locator('#send-cancel').click();
await page.waitForTimeout(200);

// 待解读需求单：空状态 → 生成
await page.locator('.dcard').nth(1).click();
await page.waitForTimeout(250);
ok(await count(page, '.sec') === 13, '待解读需求单的原始表格同样可查看');
await page.locator('.tab[data-tab="under"]').click();
await page.waitForTimeout(250);
ok((await text(page, '#main')).includes('还没有解读'), '未解读时表格理解给出空状态');
await page.locator('#btn-gen2').click();
await page.waitForTimeout(300);
ok(await page.locator('#modal').evaluate((el) => el.classList.contains('on')), '点击开始解读先弹外发确认');
await page.locator('#send-ok').click();
await page.waitForTimeout(1400);
ok(await count(page, '.item') >= 1, '确认后生成清单并自动切换');
ok((await text(page, '.tab.on')).includes('量房沟通清单'), '生成后停在清单页');

// 八、导出
await page.locator('#btn-export').click();
await page.waitForTimeout(250);
const md = await text(page, 'pre.md');
ok(md.includes('# 量房沟通清单'), '导出的 Markdown 带标题');
ok(md.includes('为什么问：'), '导出的 Markdown 含逐条依据');
await page.screenshot({ path: path.join(SHOT, '07-导出清单.png') });
await page.locator('#exp-ok').click();
await page.waitForTimeout(200);

// 九、布局指标（替代目视检查）
await page.locator('.tab[data-tab="list"]').click();
await page.waitForTimeout(250);
const metrics = await page.evaluate(() => {
  const de = document.documentElement;
  const side = document.querySelector('.side').getBoundingClientRect();
  const main = document.querySelector('.main').getBoundingClientRect();
  const items = [...document.querySelectorAll('.item')].map((el) => el.getBoundingClientRect().height);
  return {
    overflowX: de.scrollWidth - de.clientWidth,
    sideW: Math.round(side.width),
    mainW: Math.round(main.width),
    minItemH: items.length ? Math.round(Math.min(...items)) : 0,
    items: items.length,
    navH: Math.round(document.querySelector('.top').getBoundingClientRect().height),
  };
});
ok(metrics.overflowX <= 0, '宽屏无横向溢出（' + metrics.overflowX + 'px）');
ok(metrics.sideW >= 260 && metrics.sideW <= 320, '左侧需求单栏宽度 ' + metrics.sideW + 'px');
ok(metrics.mainW >= 800, '主区宽度 ' + metrics.mainW + 'px');
ok(metrics.minItemH >= 70, '清单条目最小高度 ' + metrics.minItemH + 'px（无塌陷）');
ok(metrics.navH >= 50 && metrics.navH <= 70, '顶栏高度 ' + metrics.navH + 'px');

// 十、窄屏可用性
await page.setViewportSize({ width: 420, height: 900 });
await page.waitForTimeout(300);
const narrow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok(narrow <= 0, '窄屏无横向溢出（' + narrow + 'px）');
await page.screenshot({ path: path.join(SHOT, '08-窄屏.png') });
await page.setViewportSize({ width: 1440, height: 940 });
await page.waitForTimeout(200);
ok(await count(page, '.dcard') === 3, '重置按钮存在时列表仍正常');
ok(errors.length === 0, '控制台无错误' + (errors.length ? '：' + errors.join(' | ') : ''));

await browser.close();
console.log(fails.length ? '\n' + fails.length + ' 项未通过' : '\n全部通过');
process.exit(fails.length ? 1 : 0);