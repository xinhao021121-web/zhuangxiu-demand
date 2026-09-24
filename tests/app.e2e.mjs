/**
 * H5 产物端到端测试：同一份产物在宽屏（Web）与窄屏（展示版 / 小程序形态）下跑通主流程。
 * 覆盖：字段渲染 → 空间实例与房型 → 发现 → 三动作闭环 → 静默 → 摘要 → 提交前检查 → 草稿恢复。
 * 运行：node tests/app.e2e.mjs（先执行 pnpm run build:h5）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './browser.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'app', 'dist', 'h5');
const SHOT = path.join(ROOT, 'app', 'screenshots');

const fails = [];
const ok = (cond, msg) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + msg);
  if (!cond) fails.push(msg);
};
const count = (page, sel) => page.locator(sel).count();
const text = (page, sel) => page.locator(sel).first().innerText();
const num = async (page, sel) => Number((await text(page, sel)).replace(/[^\d]/g, '')) || 0;
const has = async (page, phrase) => (await page.locator('body').innerText()).includes(phrase);

/**
 * 读本机草稿里攒下的埋点（技术方案 6.11）。
 * Taro 的 H5 存储外面套了一层 `{ data }`，里面才是草稿的 JSON 字符串。
 */
const readEvents = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem('zx.demand.draft');
    if (!raw) return [];
    const box = JSON.parse(raw);
    const draft = JSON.parse(typeof box === 'string' ? box : box.data);
    return Array.isArray(draft?.events) ? draft.events : [];
  });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** H5 产物是纯静态站点，测试时用最小静态服务器托管。 */
function serveStatic(dir) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let file = path.join(dir, url === '/' ? 'index.html' : url);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dir, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}


if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('找不到 H5 产物，请先运行：pnpm run build:h5');
  process.exit(1);
}

fs.mkdirSync(SHOT, { recursive: true });
const { server, port } = await serveStatic(DIST);
const BASE = `http://127.0.0.1:${port}/index.html`;
const browser = await launchBrowser();

function watch(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  return errors;
}

/* ==================== 宽屏：Web 端 ==================== */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = watch(page);
  await page.goto(BASE);
  await page.waitForSelector('.sec-card', { timeout: 15000 });

  ok((await count(page, '.sec-card')) === 13, '宽屏渲染 13 个大类');
  await page.locator('.side-card .sdot:has-text("卫生间")').click();
  await page.waitForTimeout(250);
  ok((await count(page, '.inst-card')) === 2, '卫生间默认渲染主卫与客卫 2 个实例');
  await page.locator('.side-card .sdot:has-text("其他卧室")').click();
  await page.locator('.side-card .sdot:has-text("书房与电竞房")').click();
  await page.waitForTimeout(250);
  ok((await count(page, '.inst-empty')) === 2, '其他卧室与书房默认未添加实例');
  ok((await text(page, '#prog-num')).includes('推荐项 0/'), '初始需求清晰度为 0');
  ok((await count(page, '.assistant-side')) === 1, '宽屏助手常驻右侧');
  ok((await count(page, '.dots .sdot')) === 13, '宽屏分区定位 13 个进度点');
  ok((await count(page, '.pills')) === 0, '宽屏不渲染窄屏分区胶囊');

  // 其它卧室 → 选房型 → 动态字段
  await page.locator('.sec-card:has-text("其他卧室") .inst-empty .btn-primary').click();
  await page.waitForTimeout(200);
  ok((await count(page, '[id$=".room_type"]')) === 1, '添加次卧后出现房间用途字段');
  ok((await count(page, '[id$=".ch_activity"]')) === 0, '未选房型时不显示儿童房专属字段');
  await page.locator('.inst-card .chip:has-text("儿童房")').first().click();
  await page.waitForTimeout(200);
  ok((await count(page, '[id$=".ch_activity"]')) === 1, '选完儿童房后显示儿童房专属字段');
  ok((await count(page, '[id$=".el_safety"]')) === 0, '选完儿童房后不再问长辈房字段');

  // 示例数据 → 发现
  await page.click('#btn-demo');
  await page.waitForTimeout(300);
  ok((await num(page, '#c-found')) >= 5, `示例数据触发发现（已发现 ${await num(page, '#c-found')}）`);
  ok(await has(page, '因为你'), '发现卡片带「因为你」依据');
  ok((await text(page, '.dk .prio')).trim() === 'P0', '发现按优先级排序，首条是 P0');
  if (await count(page, '.more')) {
    await page.locator('.more').click();
    await page.waitForTimeout(200);
  }
  const bodyText = await page.locator('body').innerText();
  ok(bodyText.includes('主卫') || bodyText.includes('客卫'), '卫生间规则按实例分别展示');
  ok((await text(page, '#prog-num')).includes('推荐项 0/') === false, '清晰度随填写更新');
  ok((await count(page, '#resume')) === 0 || !(await has(page, '还有 0 条')), '有待看时给出断点恢复提示');
  await page.screenshot({ path: path.join(SHOT, '01-宽屏-示例数据.png') });

  // 字段已有值时替换要二次确认：先取消，再确认
  await page.locator('#fi-budget_reserve .chip:has-text("否")').click();
  await page.waitForTimeout(200);
  const before = await num(page, '#c-handled');
  await page.locator('.dk-acts .btn:has-text("加入")').first().click();
  await page.waitForTimeout(250);
  ok((await count(page, '#ow-body')) === 1, '字段已有内容时替换需要二次确认');
  await page.locator('#ow-cancel').click();
  await page.waitForTimeout(200);
  ok((await num(page, '#c-handled')) === before, '取消替换时不写入，原内容保留');
  await page.locator('.dk-acts .btn:has-text("加入")').first().click();
  await page.waitForTimeout(250);
  await page.locator('#ow-ok').click();
  await page.waitForTimeout(300);
  ok((await num(page, '#c-handled')) > before, '确认替换后已处理计数增加');
  ok((await count(page, '.ai-badge')) >= 1, '采纳后字段出现「助手建议 · 撤销」标记');
  ok(!(await text(page, '.ai-badge')).includes('AI'), '字段标记不再出现 AI 字样');
  ok((await count(page, '.dk.done')) >= 1, '已处理卡片变绿下沉到最近处理');
  ok((await text(page, '#fi-budget_reserve .chip.on')).includes('是'), '助手建议按规则写入目标字段的选项');

  // 改一改
  const beforeEdit = await num(page, '#c-handled');
  await page.locator('.dk:not(.done) .btn:has-text("改一改")').first().click();
  // Taro 的 Textarea 是自定义元素，内部才是真正的 textarea
  await page.locator('.dk-edit textarea').first().fill('按我们的习惯改写：阳台做家政柜并预留充电插座。');
  await page.locator('.btn:has-text("确认写入")').first().click();
  await page.waitForTimeout(300);
  ok((await num(page, '#c-handled')) > beforeEdit, '改一改后写入成功并计入已处理');
  const written = await page.locator('#fi-base_other textarea').first().inputValue();
  ok(written.includes('阳台做家政柜'), '改写后的文案写进表单字段');

  // 撤销助手建议
  const badges = await count(page, '.ai-badge');
  await page.locator('.ai-badge').first().click();
  await page.waitForTimeout(250);
  ok((await count(page, '.ai-badge')) < badges, '撤销后字段上的助手标记消失');


  // 连续忽略 → 静默 → 恢复
  for (let i = 0; i < 3; i += 1) {
    const btn = page.locator('.dk:not(.done) .btn:has-text("不感兴趣")').first();
    if ((await btn.count()) === 0) break;
    await btn.click();
    await page.waitForTimeout(200);
  }
  ok((await count(page, '#quiet-note')) === 1, '连续 3 次不感兴趣进入静默模式');
  await page.click('#btn-quiet');
  await page.waitForTimeout(200);
  ok((await count(page, '#quiet-note')) === 0, '可一键恢复建议');

  // 需求摘要
  await page.click('#btn-summary-top');
  await page.waitForTimeout(300);
  const summary = await text(page, '#sum-text');
  ok(summary.includes('需求摘要') && summary.includes('卫生间'), '摘要按空间生成');
  ok(summary.includes('儿童房') || summary.includes('次卧1'), '摘要包含次卧实例');
  ok(summary.includes('量房确认清单') && summary.includes('16 项'), '摘要带上量房确认清单 16 项');
  ok(summary.includes('核心摘要'), '摘要页给出 150 字以内的核心摘要');
  await page.screenshot({ path: path.join(SHOT, '02-宽屏-需求摘要.png') });
  await page.click('#sum-done');
  await page.waitForTimeout(200);

  // 提交前检查
  await page.click('#btn-submit');
  await page.waitForTimeout(250);
  const check = await text(page, '#cf-body');
  ok(check.includes('需求清晰度'), '提交前检查显示清晰度');
  ok(check.includes('量房确认清单'), '提交前检查说明两份输出物');
  await page.click('#cf-cancel');
  await page.waitForTimeout(200);
  ok((await count(page, '#cf-body')) === 0, '提交前检查可返回修改');
  await page.click('#btn-submit');
  await page.waitForTimeout(200);
  await page.click('#cf-ok');
  await page.waitForTimeout(250);
  ok((await count(page, '#cf-body')) === 0, '确认提交后弹层关闭');
  ok((await count(page, '#toast')) === 1, '提交后给出反馈提示');
  ok((await text(page, '#toast')).includes('本机'), '没接采集通道时提交提示说清只留本机（展示模式）');

  // 删除已填内容的实例需要二次确认
  const beforeDel = await count(page, '.inst-card');
  await page.locator('.inst-card .btn:has-text("删除")').last().click();
  await page.waitForTimeout(250);
  ok((await count(page, '#del-body')) === 1, '删除已填内容的实例要二次确认');
  await page.locator('#del-ok').click();
  await page.waitForTimeout(250);
  ok((await count(page, '.inst-card')) === beforeDel - 1, '确认后删除空间实例');

  // 埋点：事件真的留在本机，而且没有被随后的草稿保存盖掉（踩过的坑）
  const events = await readEvents(page);
  const names = events.map((e) => e.name);
  ok(names.includes('session'), '埋点：进入填写页记了一次会话');
  ok(names.includes('shown'), '埋点：发现展示落在本机（采纳率与不感兴趣率的分母）');
  ok(
    events.some((e) => e.name === 'adopt' && e.props?.rule) && names.includes('ignore'),
    '埋点：采纳与不感兴趣都记了，采纳事件带规则',
  );
  ok(
    names.includes('quiet_on') && names.includes('submit'),
    '埋点：静默触发与提交都记了（静默率与填写时长的分子）',
  );

  // 草稿：刷新后恢复
  await page.reload();
  await page.waitForSelector('.sec-card', { timeout: 15000 });
  ok((await num(page, '#c-handled')) > 0, '刷新后从本地草稿恢复处理记录');
  ok((await count(page, '#quiet-note')) === 0, '静默状态不跨会话继承');

  // 重置
  await page.click('#btn-reset');
  await page.waitForTimeout(250);
  ok((await count(page, '.ai-badge')) === 0, '重置后清除助手标记');
  await page.locator('.side-card .sdot:has-text("卫生间")').click();
  await page.waitForTimeout(250);
  ok((await count(page, '.inst-card')) === 2, '重置后回到默认两个卫生间');
  ok((await text(page, '#prog-num')).includes('推荐项 0/'), '重置后清晰度归零');

  ok(errors.length === 0, errors.length ? '宽屏控制台无错误：' + errors.join(' | ') : '宽屏控制台无错误');
  await page.close();
}

/* ==================== 窄屏：小程序 / 展示版形态 ==================== */
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = watch(page);
  await page.goto(BASE);
  await page.waitForSelector('.sec-card', { timeout: 15000 });

  ok((await count(page, '.sec-card')) === 13, '窄屏渲染 13 个大类');
  ok((await count(page, '.sec-card.open')) === 1, '手风琴一次只展开一个大类');
  ok((await count(page, '.sec-body')) === 1, '按需渲染：只渲染展开的大类');
  ok((await count(page, '.pills .pill')) === 13, '顶部分区导航 13 个胶囊');
  ok((await count(page, '.assistant-side')) === 0, '窄屏不渲染右侧常驻侧栏');
  ok((await text(page, '#find-bar')).includes('发现'), '底部常驻发现横条存在');

  const metrics = await page.evaluate(() => {
    const doc = document.documentElement.scrollWidth;
    const find = document.querySelector('#find-bar').getBoundingClientRect();
    const bar = document.querySelector('.actionbar').getBoundingClientRect();
    const bottom = document.querySelector('.bottom').getBoundingClientRect();
    const small = [...document.querySelectorAll('.chip, .pill, .btn')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.height < 32;
    }).length;
    return { doc, win: window.innerWidth, findTop: find.top, findH: find.height, barTop: bar.top, bottomBottom: bottom.bottom, small };
  });
  ok(metrics.doc <= metrics.win + 1, `窄屏无横向溢出（${metrics.doc} / ${metrics.win}）`);
  ok(metrics.findH >= 44, '发现横条触控高度 ≥ 44px');
  ok(metrics.findTop + metrics.findH <= metrics.barTop + 1, '发现横条在操作栏上方，两者不重叠');
  ok(Math.abs(metrics.bottomBottom - 844) < 2, '底部常驻区贴住屏幕底部');
  ok(metrics.small === 0, `可点击控件高度均 ≥ 32px（${metrics.small} 个过小）`);
  await page.screenshot({ path: path.join(SHOT, '03-窄屏-首屏.png') });

  // 分区导航跳转 + 手风琴
  await page.locator('.pill:has-text("卫生间")').click();
  await page.waitForTimeout(300);
  ok((await count(page, '.sec-card.open')) === 1, '分区导航跳转后仍只展开一个大类');
  ok((await count(page, '.sec-card.open .inst-card')) === 2, '卫生间展开后是 2 个实例');

  // 其它卧室 → 添加 → 选房型
  await page.locator('.pill:has-text("其他卧室")').click();
  await page.waitForTimeout(250);
  await page.locator('.sec-card.open .inst-empty .btn-primary').click();
  await page.waitForTimeout(250);
  ok((await count(page, '.sec-card.open [id$=".ch_activity"]')) === 0, '未选房型时不显示儿童房字段');
  await page.locator('.sec-card.open .inst-card .chip:has-text("儿童房")').first().click();
  await page.waitForTimeout(250);
  ok((await count(page, '.sec-card.open [id$=".ch_activity"]')) === 1, '选择儿童房后显示专属字段');

  // 示例数据 → 发现弹层
  await page.click('#btn-demo');
  await page.waitForTimeout(300);
  ok(/还有 \d+ 条发现/.test(await text(page, '#find-text')), `底部横条显示待看条数（${await text(page, '#find-text')}）`);
  await page.locator('#find-bar').click();
  await page.waitForTimeout(300);
  ok((await count(page, '#mask')) === 1, '点击横条打开发现弹层');
  ok((await count(page, '.dk')) >= 3, '弹层展示发现卡片');
  ok((await text(page, '.dk .prio')).trim() === 'P0', '弹层内发现按优先级排序');
  await page.screenshot({ path: path.join(SHOT, '04-窄屏-发现弹层.png') });

  // 采纳 → 卡片下沉
  const before = await num(page, '#c-handled');
  await page.locator('.dk:not(.done) .btn:has-text("加入")').first().click();
  await page.waitForTimeout(300);
  ok((await num(page, '#c-handled')) > before, '采纳后已处理计数增加');
  ok((await count(page, '.dk.done')) >= 1, '已处理卡片变绿下沉');

  // 点击目标字段：收起弹层 → 展开所属大类 → 高亮
  const target = page.locator('.dk:not(.done) .dk-target').first();
  await target.click();
  await page.waitForTimeout(500);
  ok((await count(page, '#mask')) === 0, '定位后弹层自动收起');
  ok((await count(page, '.sec-card.open')) === 1, '定位后自动展开目标大类');
  ok((await count(page, '.field.flash')) >= 1, '目标字段高亮提示');

  // 摘要整页
  await page.click('#btn-summary');
  await page.waitForTimeout(300);
  const summary = await text(page, '#sum-text');
  ok(summary.includes('需求摘要'), '窄屏摘要页有标题');
  ok(summary.includes('卫生间'), '窄屏摘要按空间实例生成');
  await page.screenshot({ path: path.join(SHOT, '05-窄屏-需求摘要.png') });
  await page.click('#sum-done');
  await page.waitForTimeout(200);

  // 提交前检查
  await page.click('#btn-submit');
  await page.waitForTimeout(250);
  const check = await text(page, '#cf-body');
  ok(check.includes('需求清晰度') && check.includes('量房确认清单'), '窄屏提交前检查说明清晰度与两份输出物');
  await page.click('#cf-cancel');
  await page.waitForTimeout(200);

  // 重置
  await page.click('#btn-reset');
  await page.waitForTimeout(250);
  ok((await count(page, '.ai-badge')) === 0, '重置后清除助手标记');
  await page.locator('.pill:has-text("卫生间")').click();
  await page.waitForTimeout(250);
  ok((await count(page, '.sec-card.open .inst-card')) === 2, '重置后回到默认两个卫生间');
  ok((await text(page, '#prog-num')).includes('清晰度 0%'), '重置后清晰度归零');

  ok(errors.length === 0, errors.length ? '窄屏控制台无错误：' + errors.join(' | ') : '窄屏控制台无错误');
  await context.close();
}

/* ==================== 手机版：可装到主屏幕 ==================== */
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = watch(page);
  await page.goto(BASE);
  await page.waitForSelector('.sec-card', { timeout: 15000 });

  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return null;
    const res = await fetch(link.href);
    return res.ok ? res.json() : null;
  });
  ok(!!manifest && manifest.display === 'standalone', '给出可装到手机主屏幕的 manifest');
  ok((manifest?.icons ?? []).length >= 2, 'manifest 带图标');
  ok(!!manifest?.name?.includes('问需'), 'manifest 用问需的产品名');

  let registrations = -1;
  for (let i = 0; i < 20 && registrations < 1; i += 1) {
    registrations = await page.evaluate(async () =>
      'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length : -1,
    );
    if (registrations < 1) await page.waitForTimeout(150);
  }
  ok(registrations >= 1, `已注册 service worker（${registrations} 个），装到主屏幕后断网也能打开`);

  ok(errors.length === 0, '手机版控制台无错误' + (errors.length ? '：' + errors.join(' | ') : ''));
  await page.close();
}

await browser.close();
server.close();
console.log(fails.length ? `\n${fails.length} 项未通过` : '\n全部通过');
process.exit(fails.length ? 1 : 0);
