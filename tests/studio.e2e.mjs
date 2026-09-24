/**
 * 桌面工作台端到端：登录 → 需求单列表 → 原始表格 → 外发前确认 → 表格理解 → 清单（删减/撤销/定位）→ 导出。
 * 运行：pnpm run test:studio（会先起 API 服务与 next start）
 */
import path from 'node:path';
import fs from 'node:fs';
import { launchBrowser } from './browser.mjs';
import { ROOT, STUDIO_BASE, ensureStudioBuild, startApi, startStudio, stop } from './servers.mjs';

const SHOT = path.join(ROOT, 'studio', 'screenshots');
const fails = [];
const ok = (cond, msg) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + msg);
  if (!cond) fails.push(msg);
};

ensureStudioBuild();
const api = await startApi();
const studio = await startStudio();

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
const count = (sel) => page.locator(sel).count();
const text = (sel) => page.locator(sel).first().innerText();

try {
  fs.mkdirSync(SHOT, { recursive: true });
  await page.goto(STUDIO_BASE);
  await page.waitForTimeout(300);

  // 一、登录
  ok(await page.locator('.login').isVisible(), '未登录时先给登录页');
  await page.locator('.login button[type="submit"]').click();
  await page.waitForSelector('.dcard');
  ok((await count('.dcard')) === 3, '登录后左侧列出 3 份需求单');
  ok((await text('.dcard.on')).includes('陈先生'), '默认选中最新的这一份（列表按提交时间倒序）');
  ok((await text('.dcard')).includes('待解读'), '新导入的需求单标为待解读');
  await page.locator('.dcard', { hasText: '张先生' }).click();
  await page.waitForTimeout(400);
  ok((await text('.head')).includes('张先生'), '可以切到主场景需求单');
  ok((await text('.head')).includes('推荐项完成度'), '详情头部显示推荐项完成度');
  await page.screenshot({ path: path.join(SHOT, '01-需求单列表.png') });

  // 二、房主填写的表格
  ok((await count('.sec')) === 13, '原始表格渲染 13 个大类');
  await page.locator('.sec-h[data-sec="厨房"]').click();
  await page.locator('.sec-h[data-sec="主卧"]').click();
  await page.waitForTimeout(200);
  ok((await count('.tag')) >= 2, '字段上标出「助手建议」来源');
  ok((await page.locator('[data-fld="base_other"]').innerText()).includes('13812345678'), '自由文本原文只在本地展示');
  await page.screenshot({ path: path.join(SHOT, '02-原始表格.png') });

  // 三、外发前确认
  await page.locator('.tab[data-tab="under"]').click();
  await page.waitForTimeout(200);
  ok((await text('#main')).includes('还没有解读'), '未解读时表格理解给出空状态');
  await page.locator('#btn-gen2').click();
  await page.waitForSelector('#modal');
  const modal = await text('#modal');
  ok((await count('#modal .sgroup')) === 4, '确认界面给出四个分组');
  ok(modal.includes('不外发｜留在本机'), '标出「不外发」分组');
  ok(modal.includes('泛化后外发'), '标出「泛化后外发」分组');
  ok(modal.includes('自由文本｜默认不勾选'), '标出自由文本分组');
  ok(modal.includes('默认合规策略 v1'), '标出本次生效的策略');
  ok(modal.includes('已隐去：手机号'), '命中的手机号被隐去');
  ok(!modal.includes('13812345678'), '脱敏后的外发内容里不再出现手机号');
  const checks = page.locator(".sgroup[data-tier='free-text'] input[data-send]");
  const n = await checks.count();
  let unchecked = 0;
  for (let i = 0; i < n; i += 1) if (!(await checks.nth(i).isChecked())) unchecked += 1;
  ok(n >= 3 && unchecked === n, `自由文本默认不勾选（${unchecked}/${n}）`);
  await page.screenshot({ path: path.join(SHOT, '03-外发前确认.png') });

  // 四、生成清单
  await page.locator('#send-ok').click();
  await page.waitForSelector('.item');
  await page.waitForTimeout(400);
  ok((await count('.item')) === 21, '清单 21 条（种子场景）');
  ok((await text('.grp')).startsWith('基本信息'), '「基本信息」排在第一个分组');
  const groups = await page.locator('.grp').allInnerTexts();
  ok(groups.some((t) => t.startsWith('主卫')), '卫生间按实例拆出「主卫」分组');
  ok(
    groups.findIndex((t) => t.startsWith('卫生间')) < groups.findIndex((t) => t.startsWith('主卫')),
    '「卫生间」公共条件组排在「主卫」之前',
  );
  ok((await text('.card h3')).includes('必问'), '顶部给出必问计数');
  ok((await count('.badge.b-src-both')) >= 3, '推导项与通用项已合并');
  ok((await text('.item')).includes('为什么问'), '每条含「为什么问」');
  ok((await text('.item')).includes('现场要核实'), '每条含「现场要核实」');
  await page.screenshot({ path: path.join(SHOT, '04-量房清单.png') });

  // 五、删减与撤销
  const before = await count('.item:not(.del)');
  await page.locator('[data-act="del"]').first().click();
  await page.waitForTimeout(500);
  ok((await count('.item:not(.del)')) === before - 1, '删减后生效');
  ok((await text('.item.del [data-act="del"]')).includes('撤销'), '删减后可撤销');
  await page.locator('.item.del [data-act="del"]').first().click();
  await page.waitForTimeout(500);
  ok((await count('.item:not(.del)')) === before, '撤销后恢复');
  await page.screenshot({ path: path.join(SHOT, '05-删减与撤销.png') });

  // 六、关联字段定位
  await page.locator('[data-jump]').first().click();
  await page.waitForTimeout(400);
  ok((await count('.fld.found')) === 1, '点关联字段跳回表格并高亮');
  ok((await text('.tab.on')).includes('表格'), '自动切回原始表格');
  await page.screenshot({ path: path.join(SHOT, '06-定位字段.png') });

  // 七、导出
  await page.locator('#btn-export').click();
  await page.waitForSelector('#modal pre.md');
  const md = await text('#modal pre.md');
  ok(md.includes('# 量房沟通清单'), '导出的 Markdown 带标题');
  ok(md.includes('为什么问：'), '导出的 Markdown 含逐条依据');
  ok(md.includes('必问 11 条 · 共 21 条'), '导出的 Markdown 带计数');
  await page.screenshot({ path: path.join(SHOT, '07-导出清单.png') });
  await page.locator('#exp-ok').click();
  await page.waitForTimeout(200);

  // 八、外发记录事后可查
  await page.locator('#btn-replay').click();
  await page.waitForSelector('#modal');
  const again = await text('#modal');
  ok(again.includes('上次外发'), '重新解读时能查到上次外发发了什么');
  ok(again.includes('默认合规策略 v1'), '记录里带当次生效的策略版本');
  await page.locator('#send-cancel').click();
  await page.waitForTimeout(200);

  // 九、改名：只动叫法，房主填的内容一个字不变
  await page.locator('#btn-rename').click();
  await page.waitForSelector('#modal #rn-name');
  await page.locator('#rn-name').fill('张先生 · 89㎡ 老房翻新');
  await page.locator('#rn-ok').click();
  await page.waitForTimeout(500);
  ok((await count('#modal')) === 0, '改名后弹层关闭');
  ok((await text('.head')).includes('老房翻新'), '改名后详情头部跟着变');
  ok((await text('.dcard.on')).includes('老房翻新'), '改名后左侧列表跟着变');
  await page.locator('.tab[data-tab="form"]').click();
  await page.waitForTimeout(200);
  ok((await page.locator('[data-fld="base_area"]').innerText()).includes('89'), '改名不动房主填的内容');

  // 十、遗漏补录：量房结束后补一句「这次该问但没列的是……」
  await page.locator('.tab[data-tab="list"]').click();
  await page.waitForSelector('#omission');
  ok((await count('#om-empty')) === 1, '还没补录时给出空状态');
  await page.locator('#om-space').selectOption({ index: 0 });
  await page.locator('#om-cat').selectOption('字段清单');
  await page.locator('#om-note').fill('阳台有没有晾晒需求');
  await page.locator('#om-add').click();
  await page.waitForSelector('#om-list');
  ok((await text('#om-list')).includes('阳台有没有晾晒需求'), '补录后这份台账里出现这条');
  ok((await text('#om-list')).includes('字段清单'), '台账带上归类');
  await page.screenshot({ path: path.join(SHOT, '09-遗漏补录.png') });

  // 十一、回流报表：四张口径 + 算不出来的列
  await page.locator('#btn-reports').click();
  await page.waitForSelector('#rep-rules');
  ok((await count('#rep-rules')) === 1 && (await count('#rep-criteria')) === 1, '规则与判据两张报表都在');
  ok((await count('#rep-fields')) === 1 && (await count('#rep-omissions')) === 1, '字段与遗漏两张报表都在');
  ok((await count('#rep-criteria .rtable tr')) > 1, '判据健康度按来源与档位分组出数');
  ok((await count('#rep-fields .rtable tr')) > 1, '字段健康度出数');
  ok((await text('#rep-omissions')).includes('阳台有没有晾晒需求'), '遗漏台账里能看到刚补的那条');
  ok((await text('#rep-omissions')).includes('张先生 · 89㎡ 老房翻新'), '台账按改后的叫法认人');
  ok((await text('#rep-fields')).includes('未采集'), '现场修正率这一列写「未采集」而不是 0');
  ok((await text('#rep-unavailable')).includes('现场记录'), '并写清这一列为什么没有来源');
  // 规则表来自房主端埋点：这一份是文件导入的种子数据，没有埋点，所以是空表而不是一堆 0
  ok((await text('#rep-rules')).includes('还没有埋点'), '没有埋点时规则表是空表');
  await page.screenshot({ path: path.join(SHOT, '10-回流报表.png') });
  await page.locator('#rep-back').click();
  await page.waitForTimeout(200);
  ok((await count('#rep-rules')) === 0, '可以回到需求单');

  // 十二、文件导入：采集端导出的 JSON 与云端提交是同一份契约的两种输入方式
  await page.locator('#btn-import').click();
  await page.waitForSelector('#modal #im-json');
  await page.locator('#im-json').fill('{ 不是 JSON');
  await page.locator('#im-ok').click();
  ok((await text('#im-err')).includes('不是合法的 JSON'), '粘错了当场说清，不用等一次往返');
  await page.locator('#im-json').fill(JSON.stringify({ submittedAt: '2026-09-24T10:00:00.000Z' }));
  await page.locator('#im-ok').click();
  ok((await text('#im-err')).includes('对不上契约'), '缺 form 的 JSON 被契约挡下');
  await page.locator('#im-name').fill('新客户 · 76㎡ 毛坯');
  await page.locator('#im-json').fill(
    JSON.stringify({
      schemaVersion: '1.0',
      submittedAt: '2026-09-24T10:00:00.000Z',
      form: { values: { base_area: 76, base_house_state: '毛坯' }, instances: {} },
      aiMarks: [],
    }),
  );
  await page.locator('#im-ok').click();
  await page.waitForTimeout(600);
  ok((await count('#modal')) === 0, '导入后弹层关闭');
  ok((await count('.dcard')) === 4, '导入后列表多了一份');
  ok((await text('.dcard.on')).includes('新客户 · 76㎡ 毛坯'), '刚导入的这份直接选中');
  ok((await text('.dcard.on')).includes('待解读'), '新导入的标为待解读');
  ok((await text('.head')).includes('文件导入'), '详情里标明它来自文件导入');
  ok((await page.locator('[data-fld="base_area"]').innerText()).includes('76'), '导入的字段值进得了表格');
  await page.screenshot({ path: path.join(SHOT, '11-导入需求单.png') });
  // 回到有清单的那一份，后面还要量布局
  await page.locator('.dcard', { hasText: '张先生' }).click();
  await page.waitForTimeout(400);

  // 八、布局指标
  await page.locator('.tab[data-tab="list"]').click();
  await page.waitForTimeout(300);
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
      navH: Math.round(document.querySelector('.top').getBoundingClientRect().height),
    };
  });
  ok(metrics.overflowX <= 0, `宽屏无横向溢出（${metrics.overflowX}px）`);
  ok(metrics.sideW >= 260 && metrics.sideW <= 320, `左侧需求单栏宽度 ${metrics.sideW}px`);
  ok(metrics.mainW >= 800, `主区宽度 ${metrics.mainW}px`);
  ok(metrics.minItemH >= 70, `清单条目最小高度 ${metrics.minItemH}px（无塌陷）`);
  ok(metrics.navH >= 50 && metrics.navH <= 70, `顶栏高度 ${metrics.navH}px`);

  // 九、窄屏可用性
  await page.setViewportSize({ width: 420, height: 900 });
  await page.waitForTimeout(300);
  const narrow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(narrow <= 0, `窄屏无横向溢出（${narrow}px）`);
  await page.screenshot({ path: path.join(SHOT, '08-窄屏.png') });

  ok(errors.length === 0, '控制台无错误' + (errors.length ? '：' + errors.join(' | ') : ''));
} finally {
  await browser.close();
  stop(studio);
  stop(api);
}

console.log(fails.length ? `\n${fails.length} 项未通过` : '\n全部通过');
process.exit(fails.length ? 1 : 0);
