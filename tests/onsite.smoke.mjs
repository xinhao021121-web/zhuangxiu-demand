/**
 * 现场量房（手机端）Demo 冒烟测试：跑通「现场选单 → 出门前 → 逐空间问 → 记一笔 → 断网同步 → 量房记录」。
 * 运行：node tests/onsite.smoke.mjs
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { launchBrowser } from './browser.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const link = (p) => pathToFileURL(path.join(ROOT, p)).href;
const PAGE = link('designer/现场量房_Demo_V0.1.html');
const TPL = link('tools/_onsite_template.html');
const SHOT = path.join(ROOT, 'designer', 'screenshots');

const fails = [];
const ok = (cond, msg) => { console.log((cond ? 'PASS  ' : 'FAIL  ') + msg); if (!cond) fails.push(msg); };
const count = (page, sel) => page.locator(sel).count();
const text = (page, sel) => page.locator(sel).first().innerText();
const task = (page, hasText) => page.locator('.task', { hasText });

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(PAGE);
await page.waitForTimeout(400);
fs.mkdirSync(SHOT, { recursive: true });

// 一、现场选单
ok(await count(page, '.dc') === 3, '列出 3 份需求单');
ok((await text(page, '.dc.on')).includes('已问 5 / 共 18'), '主场景显示现场进度 5 / 18');
ok(await count(page, '.st.wait') === 2, '另外两份标记为待解读');
await page.screenshot({ path: path.join(SHOT, 'm01-现场选单.png') });

await page.locator('.dc').nth(1).click();
await page.waitForTimeout(250);
ok((await text(page, '#toast')).includes('先解读再来现场'), '未生成清单的需求单拦住并给出提示');
ok(await count(page, '.dc') === 3, '仍停留在现场选单');

// 二、出门前
await page.locator('.dc').first().click();
await page.waitForTimeout(250);
ok(await count(page, '.stats .stat') === 3, '出门前给出必问 / 建议问 / 共三个数');
ok((await text(page, '.stats .stat')).includes('9'), '必问 9 条');
ok((await text(page, '.card h3')).includes('现场进度'), '给出当前现场进度');
ok(await count(page, '.card:last-child .srow') >= 2, '列出还没问到的必问项');
await page.screenshot({ path: path.join(SHOT, 'm02-出门前.png') });

// 三、现场逐条走
await page.locator('#go').click();
await page.waitForTimeout(250);
ok(await count(page, '.sp') === 0, '不用横向滑动的空间胶囊（改由底部按钮与抽屉切换）');
ok((await text(page, '.pname')).includes('基本信息'), '默认从「基本信息」开始');
ok((await text(page, '.pidx')).includes('1 / 8'), '共 8 个空间');
ok((await text(page, '.pmust')).includes('必问 已问 5 / 9'), '顶部显示必问进度');
ok(await count(page, '.task') === 6, '基本信息 6 条');
ok((await text(page, '.task')).includes('必问'), '条目带必问档位徽标');
ok((await text(page, '.task')).includes('需求推导 + 通用核实'), '条目带来源徽标（推导与通用已合并）');
await page.screenshot({ path: path.join(SHOT, 'm03-逐条走.png') });

// 左右滑动换空间
await page.evaluate(() => {
  const el = document.querySelector('.body');
  const t = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
  el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t(320, 420)], changedTouches: [t(320, 420)] }));
  el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [t(120, 424)] }));
});
await page.waitForTimeout(250);
ok((await text(page, '.pname')).includes('设备与系统'), '左滑切到下一个空间');
await page.evaluate(() => {
  const el = document.querySelector('.body');
  const t = (x, y) => new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
  el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t(120, 420)], changedTouches: [t(120, 420)] }));
  el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [t(320, 424)] }));
});
await page.waitForTimeout(250);
ok((await text(page, '.pname')).includes('基本信息'), '右滑切回上一个空间');

// 展开依据：整块卡片可点
ok(await count(page, '.det') === 0, '依据默认收起（现场先看问题）');
await task(page, '层高能不能同时满足无主灯吊顶与中央空调').click();
await page.waitForTimeout(200);
ok(await count(page, '.det') === 1, '点一下卡片展开依据');
const det = await text(page, '.det');
ok(det.includes('为什么问') && det.includes('现场要核实') && det.includes('房主填的'), '依据含为什么问 / 现场要核实 / 房主填的');
await task(page, '层高能不能同时满足无主灯吊顶与中央空调').click();
await page.waitForTimeout(150);
ok(await count(page, '.det') === 0, '再点一下收起');

// 已问
await task(page, '墙体材质与可开槽条件').locator('[data-a="asked"]').click();
await page.waitForTimeout(250);
ok((await task(page, '墙体材质与可开槽条件').innerText()).includes('已问'), '点「已问」后条目标记为已问');
ok((await text(page, '.pmust')).includes('必问 已问 6 / 9'), '必问进度随之更新到 6 / 9');

// 记一笔
await task(page, '入户门与窗户是否更换及尺寸').locator('[data-a="note"]').click();
await page.waitForTimeout(250);
ok(await page.locator('#sheet').isVisible(), '「记一笔」从底部弹出抽屉');
ok(await count(page, '.chip') === 5, '抽屉里给出快捷短语');
await page.locator('.chip', { hasText: '现场条件不允许' }).click();
await page.waitForTimeout(150);
ok((await page.locator('textarea[data-draft]').inputValue()).includes('现场条件不允许'), '点快捷短语直接写入输入框');
await page.locator('textarea[data-draft]').fill('门要换，窗户保留；改窗要等物业批');
await page.locator('#sh-save').click();
await page.waitForTimeout(250);
ok((await task(page, '入户门与窗户是否更换及尺寸').innerText()).includes('改窗要等物业批'), '保存后结论留在条目上');
ok((await task(page, '入户门与窗户是否更换及尺寸').innerText()).includes('已问'), '保存后自动标成已问');
await page.screenshot({ path: path.join(SHOT, 'm04-记一笔.png') });

// 换空间抽屉
await page.locator('#spaces').click();
await page.waitForTimeout(200);
ok(await count(page, '.rowbtn') === 8, '换空间抽屉列出 8 个空间');
const rows = await page.locator('.rowbtn').allInnerTexts();
ok(rows.findIndex((t) => t.startsWith('卫生间')) < rows.findIndex((t) => t.startsWith('主卫')), '卫生间的公共条件组排在「主卫」之前');
ok((await text(page, '.rowbtn.on')).includes('基本信息'), '标注当前所在空间');
await page.screenshot({ path: path.join(SHOT, 'm05-换空间.png') });
await page.locator('.rowbtn', { hasText: '厨房' }).click();
await page.waitForTimeout(250);
ok((await text(page, '.pname')).includes('厨房'), '从抽屉直接跳到厨房');
ok(await count(page, '.task') === 2, '厨房 2 条');

// 已有结论的条目可以改
await task(page, '厨房是否接受开放式').locator('[data-a="note"]').click();
await page.waitForTimeout(200);
ok((await text(page, '.ctx')).includes('房主填的'), '改结论时能对照房主原来填的');
ok((await text(page, '.ctx')).includes('开放式'), '对照里带出具体选项值');
ok((await page.locator('textarea[data-draft]').inputValue()).includes('烟道在窗侧'), '原有结论回填到输入框');
await page.locator('#sh-cancel').click();
await page.waitForTimeout(200);

// 底部按钮换空间
await page.locator('#next').click();
await page.waitForTimeout(220);
ok((await text(page, '.pname')).includes('阳台'), '底部「下一个空间」可用');
await page.locator('#prev').click();
await page.waitForTimeout(220);
ok((await text(page, '.pname')).includes('厨房'), '底部「上一个」可用');

// 四、离线记录与同步
await page.locator('#net').click();
await page.waitForTimeout(220);
ok((await text(page, '#toast')).includes('已切到离线'), '可以切到离线（现场没信号）');
ok((await text(page, '.net')).includes('离线'), '顶栏标出离线状态');
await task(page, '内嵌冰箱与洗碗机的尺寸').locator('[data-a="asked"]').click();
await page.waitForTimeout(250);
ok((await task(page, '内嵌冰箱与洗碗机的尺寸').innerText()).includes('待同步'), '离线时的记录标为待同步');
ok((await text(page, '.syncbar')).includes('还没同步'), '顶部提示还有记录没同步');
await page.screenshot({ path: path.join(SHOT, 'm06-离线待同步.png') });
await page.locator('#net').click();
await page.waitForTimeout(250);
ok((await text(page, '#toast')).includes('已同步 1 条'), '联网后自动同步并提示');
ok(!(await task(page, '内嵌冰箱与洗碗机的尺寸').innerText()).includes('待同步'), '同步后待同步标记消失');

// 没问上
await page.locator('#spaces').click();
await page.waitForTimeout(180);
await page.locator('.rowbtn', { hasText: '主卧' }).click();
await page.waitForTimeout(220);
await task(page, '主卧的朝向、噪音与采光实际情况').locator('[data-a="skip"]').click();
await page.waitForTimeout(250);
ok(await page.locator('#sheet').isVisible(), '「没问上」同样开一次抽屉');
ok((await text(page, '#sheet')).includes('记一句原因'), '抽屉换成为「没问上」记原因');
await page.locator('.chip', { hasText: '房主不在现场' }).click();
await page.locator('#sh-save').click();
await page.waitForTimeout(250);
ok((await task(page, '主卧的朝向、噪音与采光实际情况').innerText()).includes('没问上'), '保存后标成没问上');
ok((await task(page, '主卧的朝向、噪音与采光实际情况').innerText()).includes('房主不在现场'), '原因留在条目上');

// 五、结束量房前拦住未落的必问
await page.locator('#end').click();
await page.waitForTimeout(250);
ok(await page.locator('#sheet').isVisible(), '结束量房先弹确认');
ok((await text(page, '#sheet')).includes('必问里还有'), '确认里提示还有必问没落');
await page.screenshot({ path: path.join(SHOT, 'm07-结束前拦截.png') });
await page.locator('#sh-cancel').click();
await page.waitForTimeout(200);
ok(await page.locator('#sheet').count() === 0, '可以继续问，不强行结束');

// 六、量房记录
await page.locator('#end').click();
await page.waitForTimeout(200);
await page.locator('#sh-end').click();
await page.waitForTimeout(300);
ok(await count(page, '.stats .stat') === 3, '量房记录给出已问 / 没问上 / 还没问到');
ok((await text(page, '.stats .stat')).includes('8'), '已问 8 条');
ok((await text(page, '.card')).includes('必问里还有 3 条没落'), '列出还没落的必问');
const body = await text(page, '.body');
ok(body.includes('承重墙在客厅东侧'), '带出每条结论');
ok(body.includes('# 量房记录 · 张先生'), '生成可复制的速记');
await page.screenshot({ path: path.join(SHOT, 'm08-量房记录.png') });

// 七、布局指标（替代目视检查）
await page.locator('[data-nav="list"]').last().click();
await page.waitForTimeout(250);
ok(await count(page, '.dc') === 3, '可以回到现场选单');
await page.locator('.dc').first().click();
await page.waitForTimeout(200);
await page.locator('#go').click();
await page.waitForTimeout(250);
const m = await page.evaluate(() => {
  const de = document.documentElement;
  const h = (sel) => [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect().height);
  const acts = h('.act'); const foot = h('.foot .btn');
  const q = document.querySelector('.q');
  const b = document.querySelector('.body');
  return {
    overflowX: de.scrollWidth - de.clientWidth,
    pageScroll: de.scrollHeight - de.clientHeight,
    minAct: acts.length ? Math.round(Math.min(...acts)) : 0,
    minFoot: foot.length ? Math.round(Math.min(...foot)) : 0,
    qSize: q ? parseFloat(getComputedStyle(q).fontSize) : 0,
    phoneW: Math.round(document.querySelector('.phone').getBoundingClientRect().width),
    innerScroll: Math.round(b.scrollHeight - b.clientHeight),
  };
});
ok(m.overflowX <= 0, '手机宽度下无横向溢出（' + m.overflowX + 'px）');
ok(m.pageScroll <= 0, '整页不滚动，只有内容区滚动（' + m.pageScroll + 'px）');
ok(m.innerScroll > 0, '内容区独立滚动（' + m.innerScroll + 'px）');
ok(m.minAct >= 44, '条目动作按钮高度 ' + m.minAct + 'px（≥ 44）');
ok(m.minFoot >= 48, '底部主按钮高度 ' + m.minFoot + 'px（≥ 48）');
ok(m.qSize >= 16, '问题正文字号 ' + m.qSize + 'px（≥ 16）');
ok(m.phoneW <= 430, '手机容器宽度 ' + m.phoneW + 'px');
await page.screenshot({ path: path.join(SHOT, 'm09-布局指标.png') });

// 八、重置
await page.locator('[data-nav="intro"]').click();
await page.waitForTimeout(200);
await page.locator('[data-nav="list"]').click();
await page.waitForTimeout(200);
await page.locator('#reset').click();
await page.waitForTimeout(250);
ok((await text(page, '.dc.on')).includes('已问 5 / 共 18'), '重置现场记录回到初始状态');

// 九、直接打开模板不出现空白页
await page.goto(TPL);
await page.waitForTimeout(200);
ok((await text(page, '#app')).includes('模板还没有注入数据'), '直接打开模板给出提示而不是空白页');
ok(errors.length === 0, '控制台无错误' + (errors.length ? '：' + errors.join(' | ') : ''));

await browser.close();
console.log(fails.length ? '\n' + fails.length + ' 项未通过' : '\n全部通过');
process.exit(fails.length ? 1 : 0);
