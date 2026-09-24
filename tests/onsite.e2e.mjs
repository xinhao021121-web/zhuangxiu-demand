/**
 * 现场端端到端：选单 → 出门前 → 逐空间问 → 记一笔 → 断网记录与重连同步 → 量房记录。
 * 运行：pnpm run test:onsite-app
 */
import path from 'node:path';
import fs from 'node:fs';
import { launchBrowser } from './browser.mjs';
import {
  ONSITE_BASE,
  ROOT,
  ensureOnsiteBuild,
  generateChecklistFor,
  startApi,
  startOnsite,
  stop,
} from './servers.mjs';

const SHOT = path.join(ROOT, 'onsite', 'screenshots');
const fails = [];
const ok = (cond, msg) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + msg);
  if (!cond) fails.push(msg);
};

ensureOnsiteBuild();
const api = await startApi();
await generateChecklistFor('d1');
const onsite = await startOnsite();

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
const count = (sel) => page.locator(sel).count();
const text = (sel) => page.locator(sel).first().innerText();
const task = (hasText) => page.locator('.task', { hasText });

try {
  fs.mkdirSync(SHOT, { recursive: true });
  await page.goto(ONSITE_BASE);
  await page.waitForTimeout(400);

  // 一、登录与现场选单
  ok(await page.locator('.login').isVisible(), '未登录时先给登录页');
  await page.locator('.login button[type="submit"]').click();
  await page.waitForSelector('.dc');
  ok((await count('.dc')) === 3, '列出 3 份需求单');
  ok((await page.locator('.dc', { hasText: '张先生' }).innerText()).includes('清单已生成'), '已生成清单的那份标出来');
  ok((await page.locator('.dc', { hasText: '陈先生' }).innerText()).includes('待解读'), '没生成清单的那份拦住');
  ok((await page.locator('.dc', { hasText: '张先生' }).innerText()).includes('已问 0 / 共 19 条'), '主场景显示现场进度 0 / 19');
  await page.screenshot({ path: path.join(SHOT, 'm01-现场选单.png') });

  // 二、出门前
  await page.locator('.dc', { hasText: '张先生' }).click();
  await page.waitForSelector('#go');
  ok((await count('.stats .stat')) === 3, '出门前给出必问 / 建议问 / 共三个数');
  ok((await text('.stats .stat')).includes('10'), '必问 10 条');
  ok((await text('.card h3')).includes('现场进度'), '给出当前现场进度');
  ok((await count('.card:last-child .srow')) >= 2, '列出还没问到的必问项');
  await page.screenshot({ path: path.join(SHOT, 'm02-出门前.png') });

  // 三、逐空间问
  await page.locator('#go').click();
  await page.waitForSelector('.task');
  ok((await text('.pname')).includes('基本信息'), '默认从「基本信息」开始');
  ok((await text('.pidx')).includes('1 / 8'), '共 8 个空间（卫生间公共条件组单列）');
  ok((await text('.pmust')).includes('必问 已问 0 / 10'), '顶部显示必问进度');
  ok((await count('.task')) === 6, '基本信息 6 条');
  ok((await text('.task')).includes('必问'), '条目带必问档位徽标');
  ok((await text('.task')).includes('需求推导 + 通用核实'), '条目带来源徽标（推导与通用已合并）');
  await page.screenshot({ path: path.join(SHOT, 'm03-逐条走.png') });

  // 展开依据
  ok((await count('.det')) === 0, '依据默认收起（现场先看问题）');
  await task('层高能不能同时满足无主灯吊顶与中央空调').locator('.q').click();
  await page.waitForTimeout(200);
  ok((await count('.det')) === 1, '点一下卡片展开依据');
  const det = await text('.det');
  ok(
    det.includes('为什么问') && det.includes('现场要核实') && det.includes('房主填的'),
    '依据含为什么问 / 现场要核实 / 房主填的',
  );
  ok(det.includes('无主灯'), '「房主填的」带出具体选项值');
  await task('层高能不能同时满足无主灯吊顶与中央空调').locator('.q').click();
  await page.waitForTimeout(150);
  ok((await count('.det')) === 0, '再点一下收起');

  // 已问
  await task('墙体材质与可开槽条件').locator('[data-a="asked"]').click();
  await page.waitForTimeout(400);
  ok((await task('墙体材质与可开槽条件').innerText()).includes('已问'), '点「已问」后条目标记为已问');
  ok((await text('.pmust')).includes('必问 已问 1 / 10'), '必问进度随之更新到 1 / 10');

  // 记一笔
  await task('入户门与窗户是否更换及尺寸').locator('[data-a="note"]').click();
  await page.waitForSelector('#sheet');
  ok((await count('.chip')) === 5, '抽屉里给出快捷短语');
  await page.locator('.chip', { hasText: '现场条件不允许' }).click();
  await page.waitForTimeout(150);
  ok((await page.locator('textarea[data-draft]').inputValue()).includes('现场条件不允许'), '点快捷短语直接写入输入框');
  await page.locator('textarea[data-draft]').fill('门要换，窗户保留；改窗要等物业批');
  await page.locator('#sh-save').click();
  await page.waitForTimeout(500);
  ok((await task('入户门与窗户是否更换及尺寸').innerText()).includes('改窗要等物业批'), '保存后结论留在条目上');
  ok((await task('入户门与窗户是否更换及尺寸').innerText()).includes('已问'), '保存后自动标成已问');
  await page.screenshot({ path: path.join(SHOT, 'm04-记一笔.png') });

  // 四、换空间
  await page.locator('#spaces').click();
  await page.waitForSelector('.rowbtn');
  ok((await count('.rowbtn')) === 8, '换空间抽屉列出 8 个空间');
  const rows = await page.locator('.rowbtn').allInnerTexts();
  ok(
    rows.findIndex((t) => t.startsWith('卫生间')) < rows.findIndex((t) => t.startsWith('主卫')),
    '卫生间的公共条件组排在「主卫」之前',
  );
  await page.screenshot({ path: path.join(SHOT, 'm05-换空间.png') });
  await page.locator('.rowbtn', { hasText: '厨房' }).click();
  await page.waitForTimeout(300);
  ok((await text('.pname')).includes('厨房'), '从抽屉直接跳到厨房');
  ok((await count('.task')) === 2, '厨房 2 条');

  // 五、离线记录与重连同步
  await page.locator('#net').click();
  await page.waitForTimeout(250);
  ok((await text('#toast')).includes('已切到离线'), '可以切到离线（现场没信号）');
  ok((await text('.net')).includes('离线'), '顶栏标出离线状态');
  await task('内嵌冰箱与洗碗机的尺寸').locator('[data-a="asked"]').click();
  await page.waitForTimeout(300);
  ok((await task('内嵌冰箱与洗碗机的尺寸').innerText()).includes('待同步'), '离线时的记录标为待同步');
  ok((await text('.syncbar')).includes('还没同步'), '顶部提示还有记录没同步');
  await page.screenshot({ path: path.join(SHOT, 'm06-离线待同步.png') });
  await page.locator('#net').click();
  await page.waitForTimeout(900);
  ok((await text('#toast')).includes('已同步 1 条'), '联网后自动同步并提示');
  ok(!(await task('内嵌冰箱与洗碗机的尺寸').innerText()).includes('待同步'), '同步后待同步标记消失');

  // 六、没问上
  await page.locator('#spaces').click();
  await page.waitForSelector('.rowbtn');
  await page.locator('.rowbtn', { hasText: '主卧' }).click();
  await page.waitForTimeout(300);
  await task('主卧的朝向、噪音与采光实际情况').locator('[data-a="skip"]').click();
  await page.waitForSelector('#sheet');
  ok((await text('#sheet')).includes('记一句原因'), '「没问上」同样开一次抽屉');
  await page.locator('.chip', { hasText: '房主不在现场' }).click();
  await page.locator('#sh-save').click();
  await page.waitForTimeout(500);
  ok((await task('主卧的朝向、噪音与采光实际情况').innerText()).includes('没问上'), '保存后标成没问上');
  ok((await task('主卧的朝向、噪音与采光实际情况').innerText()).includes('房主不在现场'), '原因留在条目上');

  // 七、结束前拦截未落的必问
  await page.locator('#end').click();
  await page.waitForSelector('#sheet');
  ok((await text('#sheet')).includes('必问里还有'), '结束量房先确认还有必问没落');
  await page.screenshot({ path: path.join(SHOT, 'm07-结束前拦截.png') });
  await page.locator('#sh-cancel').click();
  await page.waitForTimeout(200);
  ok((await count('#sheet')) === 0, '可以继续问，不强行结束');

  // 八、量房记录
  await page.locator('#end').click();
  await page.waitForTimeout(200);
  await page.locator('#sh-end').click();
  await page.waitForTimeout(400);
  ok((await count('.stats .stat')) === 3, '量房记录给出已问 / 没问上 / 还没问到');
  ok((await text('.stats .stat')).includes('3'), '已问 3 条');
  ok((await text('.card')).includes('必问里还有'), '列出还没落的必问');
  const body = await text('.body');
  ok(body.includes('改窗要等物业批'), '带出每条结论');
  ok(body.includes('房主不在现场'), '带出没问上的原因');
  ok(body.includes('# 量房记录 · 张先生'), '生成可复制的速记');
  await page.screenshot({ path: path.join(SHOT, 'm08-量房记录.png') });

  // 九、布局指标（回到逐空间问那一屏来量：操作区与问题正文都在这一屏）
  await page.locator('[data-nav="list"]').last().click();
  await page.waitForSelector('.dc');
  await page.locator('.dc', { hasText: '张先生' }).click();
  await page.waitForSelector('#go');
  await page.locator('#go').click();
  await page.waitForSelector('.task');
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const h = (sel) => [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect().height);
    const acts = h('.act');
    const foot = h('.foot .btn');
    const q = document.querySelector('.q');
    const body = document.querySelector('.body');
    return {
      overflowX: de.scrollWidth - de.clientWidth,
      pageScroll: de.scrollHeight - de.clientHeight,
      minAct: acts.length ? Math.round(Math.min(...acts)) : 0,
      minFoot: foot.length ? Math.round(Math.min(...foot)) : 0,
      qSize: q ? parseFloat(getComputedStyle(q).fontSize) : 0,
      phoneW: Math.round(document.querySelector('.phone').getBoundingClientRect().width),
      innerScroll: body ? Math.round(body.scrollHeight - body.clientHeight) : 0,
    };
  });
  ok(m.overflowX <= 0, `手机宽度下无横向溢出（${m.overflowX}px）`);
  ok(m.pageScroll <= 0, `整页不滚动，只有内容区滚动（${m.pageScroll}px）`);
  ok(m.minAct >= 44, `条目动作按钮高度 ${m.minAct}px（≥ 44）`);
  ok(m.minFoot >= 48, `底部主按钮高度 ${m.minFoot}px（≥ 48）`);
  ok(m.qSize >= 16, `问题正文字号 ${m.qSize}px（≥ 16）`);
  ok(m.phoneW <= 430, `手机容器宽度 ${m.phoneW}px`);

  // 十、装机能力：manifest 与 service worker
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return null;
    const res = await fetch(link.href);
    return res.ok ? await res.json() : null;
  });
  ok(!!manifest && manifest.display === 'standalone', '给出可装到手机主屏幕的 manifest');
  ok((manifest.icons ?? []).length >= 2, 'manifest 带图标');
  const swReady = await page.evaluate(() =>
    'serviceWorker' in navigator ? navigator.serviceWorker.getRegistrations().then((rs) => rs.length > 0) : false,
  );
  ok(swReady, 'service worker 已注册（断网也能打开应用外壳）');

  ok(errors.length === 0, '控制台无错误' + (errors.length ? '：' + errors.join(' | ') : ''));
} finally {
  await browser.close();
  stop(onsite);
  stop(api);
}

console.log(fails.length ? `\n${fails.length} 项未通过` : '\n全部通过');
process.exit(fails.length ? 1 : 0);
