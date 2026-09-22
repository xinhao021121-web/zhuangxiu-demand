/**
 * 小程序端（移动端）Demo 冒烟测试。
 * 覆盖：手风琴表单 → 分区导航 → 空间实例 → 发现弹层 → 三动作闭环 →
 *       移动端定位 → 静默 → 摘要 → 提交前检查，并校验移动端布局指标。
 * 运行：node tests/mobile.smoke.mjs
 */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PAGE = pathToFileURL(path.join(ROOT, "mobile", "装修需求发现助手_小程序端Demo_V0.1.html")).href;
const TEMPLATE = pathToFileURL(path.join(ROOT, "tools", "_mobile_template.html")).href;
const TEMPLATE_FILE = path.join(ROOT, "tools", "_mobile_template.html");
const SHOT = path.join(ROOT, "mobile", "screenshots");

const VIEWPORT = { width: 390, height: 844 };

const fails = [];
const ok = (cond, msg) => { console.log((cond ? "PASS  " : "FAIL  ") + msg); if (!cond) fails.push(msg); };
const count = (page, sel) => page.locator(sel).count();
const num = async (page, sel) => Number((await page.locator(sel).innerText()).replace(/[^\d]/g, "")) || 0;
const hitFindBar = (p) => p.evaluate(() => {
  const r = document.querySelector("#find-bar").getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!(el && el.closest("#find-bar"));
});

const exeCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM,
  path.join(process.env.USERPROFILE || "", "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe"),
  path.join(process.env.USERPROFILE || "", "AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe"),
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
const available = exeCandidates.filter((p) => fs.existsSync(p));

/* 逐个尝试：本机 ms-playwright 自带内核可能因缺少运行库无法启动，需回落到系统 Chrome / Edge */
async function launchBrowser() {
  const errors = [];
  for (const candidate of available) {
    try { return await chromium.launch({ executablePath: candidate }); }
    catch (e) { errors.push(candidate + "：" + String(e.message).split("\n")[0]); }
  }
  try { return await chromium.launch(); }
  catch (e) { errors.push(String(e.message).split("\n")[0]); }
  throw new Error("没有可用的浏览器内核：\n" + errors.join("\n"));
}

const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: VIEWPORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("dialog", (d) => d.accept());

fs.mkdirSync(SHOT, { recursive: true });
await page.goto(PAGE);
await page.waitForTimeout(400);

/* 0. 字段规格完整性：规则里引用的目标字段必须都存在于字段清单 */
{
  const specIds = new Set(await page.evaluate(() => SPEC.map((f) => f.id)));
  const tpl = fs.readFileSync(TEMPLATE_FILE, "utf8");
  const referenced = new Set([...tpl.matchAll(/target:'([a-z0-9_]+)'/g)].map((m) => m[1]));
  const missing = [...referenced].filter((id) => !specIds.has(id));
  ok(missing.length === 0, "规则目标字段都在字段清单内" + (missing.length ? "：缺少 " + missing.join(", ") : ""));
  ok(specIds.size === 191, "字段清单注入 191 个字段（实际 " + specIds.size + "）");
}

/* 1. 首屏结构 */
const secCount = await count(page, ".sec-card");
ok(secCount === 13, `表单渲染 13 个大类（实际 ${secCount}）`);
ok(await count(page, ".snav") === 13, "顶部分区导航 13 个");
ok(await count(page, ".sec-body") === 1, "首屏只展开一个大类（手风琴）");
ok(await count(page, ".sec-card.open") === 1, "首屏展开的是「认识你家」");
ok((await page.locator(".nav-title").innerText()).includes("装修需求采集"), "顶部标题正确");
ok(await count(page, ".capsule") === 1, "顶部有胶囊按钮区");
ok((await page.locator("#find-bar").innerText()).includes("发现"), "底部常驻发现横条存在");
ok((await page.locator("#prog-num").innerText()).includes("清晰度"), "顶部显示需求清晰度");
await page.screenshot({ path: path.join(SHOT, "01-首屏.png") });

/* 2. 移动端布局指标 */
{
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth, win: window.innerWidth,
  }));
  ok(overflow.doc <= overflow.win + 1, `无横向溢出（${overflow.doc} / ${overflow.win}）`);

  const findBox = await page.locator("#find-bar").boundingBox();
  const barBox = await page.locator(".actionbar").boundingBox();
  const bottomBox = await page.locator(".bottom").boundingBox();
  ok(findBox.y + findBox.height <= barBox.y + 1, "发现横条在操作栏上方，两者不重叠");
  ok(Math.abs(bottomBox.y + bottomBox.height - VIEWPORT.height) < 1.5, "底部常驻区贴住屏幕底部");
  ok(findBox.x >= 0 && findBox.x + findBox.width <= VIEWPORT.width + 1, "发现横条不超出屏幕");
  ok(findBox.height >= 44, "发现横条触控高度 ≥ 44px");

  const smallTaps = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll(".chip, .snav, .btn").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.height < 32) bad.push((el.className || "") + ":" + Math.round(r.height));
    });
    return bad;
  });
  ok(smallTaps.length === 0, "可点击控件高度均 ≥ 32px" + (smallTaps.length ? "：" + smallTaps.slice(0, 4).join(" | ") : ""));
}

/* 2b. 布局细节：导航跟随、折叠头部一致、底部不遮挡、按需渲染 */
{
  await page.evaluate(() => window.jumpSection("卫生间"));
  await page.waitForTimeout(500);
  const navScroll = await page.locator("#sec-nav").evaluate((el) => el.scrollLeft);
  ok(navScroll > 0, "分区导航自动滚动到当前大类");

  const expectBase = await page.evaluate(() => SPEC.filter((f) => f.section === "认识你家").length);
  await page.evaluate(() => window.jumpSection("认识你家"));
  await page.waitForTimeout(450);
  const rendered = await count(page, '.sec-card[data-sec="认识你家"] .field');
  ok(rendered === expectBase && expectBase > 40, `展开大类渲染全部字段（${rendered} / ${expectBase}）`);

  await page.evaluate(() => { EXPANDED = null; renderAll(); });
  await page.waitForTimeout(350);
  const heads = await page.evaluate(() =>
    [...document.querySelectorAll(".sec-head")].map((el) => Math.round(el.getBoundingClientRect().height)));
  ok(new Set(heads).size === 1, `折叠头部高度一致（${heads[0]}px）`);
  ok(heads[0] >= 44, "折叠头部触控高度 ≥ 44px");

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  const lastBox = await page.locator(".tool-card").boundingBox();
  const bar = await page.locator(".actionbar").boundingBox();
  ok(lastBox.y + lastBox.height <= bar.y + 1, "滚到底部时最后一张卡片不被底部操作栏遮挡");

  await page.locator("#find-bar").click();
  await page.waitForTimeout(420);
  ok(await hitFindBar(page) === false, "弹层打开时底部横条被遮挡，不会误触");
  await page.locator("#mask").click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(350);
  ok(await hitFindBar(page) === true, "关闭弹层后底部横条恢复可点");
}


/* 3. 手风琴：同时只渲染一个大类 */
await page.locator('.sec-head[data-sec="厨房"]').click();
await page.waitForTimeout(250);
ok(await count(page, ".sec-card.open") === 1, "展开新大类后其他大类收起");
ok((await page.locator(".sec-card.open .sec-title").innerText()).includes("厨房"), "当前展开的是厨房");
ok(await count(page, ".sec-body") === 1, "只渲染一个展开体（按需渲染）");

/* 4. 分区导航跳转 */
await page.locator('.snav[data-sec="卫生间"]').click();
await page.waitForTimeout(400);
ok(await count(page, ".sec-card.open") === 1, "分区导航跳转后仍只展开一个大类");
ok(await count(page, '.sec-card[data-sec="卫生间"] .inst-card') === 2, "卫生间默认 2 个实例");
const navOn = await page.locator(".snav.on").innerText();
ok(navOn.includes("卫生间"), "分区导航高亮当前大类");

/* 5. 添加次卧 → 选房型 → 动态字段 */
await page.locator('.snav[data-sec="其他卧室"]').click();
await page.waitForTimeout(350);
ok(await count(page, ".inst-empty") === 1, "其他卧室默认未添加实例");
await page.locator('[data-act="add-inst"][data-sec="其他卧室"]').first().click();
await page.waitForTimeout(350);
ok(await count(page, '.sec-card[data-sec="其他卧室"] .inst-card') === 1, "添加后出现 1 个次卧实例");
ok(await count(page, '[id$=".ch_activity"]') === 0, "未选房型时不显示儿童房专属字段");
await page.locator('.inst-card .chip[data-val="儿童房"]').first().click();
await page.waitForTimeout(300);
ok(await count(page, '[id$=".ch_activity"]') === 1, "选择儿童房后显示儿童房专属字段");

/* 6. 示例数据 → 发现 */
await page.locator('[data-act="demo"]').first().click();
await page.waitForTimeout(800);
const findText = await page.locator("#find-text").innerText();
ok(/还有 \d+ 条发现/.test(findText), "填入示例后横条显示待看条数（" + findText + "）");
await page.screenshot({ path: path.join(SHOT, "02-表单已填.png") });

await page.locator("#find-bar").click();
await page.waitForTimeout(450);
ok(await page.locator("#sheet").evaluate((el) => el.classList.contains("on")), "点击底部横条打开发现弹层");
ok(await count(page, ".dk") >= 3, "弹层展示发现卡片");
ok((await page.locator("#dk-list").innerText()).includes("因为你"), "卡片带「因为你」依据");
const firstPrio = await page.locator(".dk .prio").first().innerText();
ok(firstPrio.trim() === "P0", "发现卡片按优先级排序（首条 " + firstPrio.trim() + "）");
if (await count(page, ".more")) { await page.locator(".more").click(); await page.waitForTimeout(300); }
const dkText = await page.locator("#dk-list").innerText();
ok(dkText.includes("主卫") || dkText.includes("客卫"), "卫生间规则按实例展示");
await page.screenshot({ path: path.join(SHOT, "03-发现弹层.png") });

/* 7. 采纳：卡片变绿下沉 + 字段标记 + 撤销 */
{
  const before = await num(page, "#c-handled");
  await page.locator('[data-act="adopt"]').first().click();
  await page.waitForTimeout(450);
  ok(await num(page, "#c-handled") > before, "采纳后已处理计数增加");
  ok(await count(page, ".dk.done") >= 1, "已处理卡片变绿下沉到列表底部");
  await page.screenshot({ path: path.join(SHOT, "04-采纳后.png") });
}

/* 8. 移动端定位：收起弹层 → 展开所属大类 → 字段高亮 */
{
  const target = page.locator(".dk:not(.done) .dk-target").first();
  const key = await target.getAttribute("data-key");
  const secName = await page.evaluate((k) => {
    const id = k.includes(".") ? k.split(".")[1] : k;
    return (SPEC.find((f) => f.id === id) || {}).section;
  }, key);
  await target.click();
  await page.waitForTimeout(500);
  ok(!(await page.locator("#sheet").evaluate((el) => el.classList.contains("on"))), "定位后弹层自动收起");
  ok(await page.locator('.sec-card[data-sec="' + secName + '"]').evaluate((el) => el.classList.contains("open")),
    "定位后自动展开目标大类（" + secName + "）");
  const el = page.locator("#fi-" + key);
  ok(await el.count() === 1, "目标字段已渲染");
  ok(await el.evaluate((n) => n.classList.contains("flash")), "目标字段高亮提示");
}

/* 9. 改一改 */
await page.locator("#find-bar").click();
await page.waitForTimeout(400);
{
  const before = await num(page, "#c-handled");
  await page.locator('[data-act="edit"]').first().click();
  await page.locator(".dk-edit").first().fill("按我们的习惯改写：阳台做家政柜并预留充电插座。");
  await page.locator('[data-act="edit-ok"]').first().click();
  await page.waitForTimeout(400);
  ok(await num(page, "#c-handled") > before, "改一改后写入成功");
}

/* 10. 撤销 */
await page.locator("#mask").click({ position: { x: 10, y: 10 } });
await page.waitForTimeout(350);
{
  const badges = await count(page, ".ai-badge");
  if (badges > 0) {
    const badgeEl = page.locator('[data-act="undo"]').first();
    const sec = await badgeEl.evaluate((n) => n.closest(".sec-card").dataset.sec);
    if (!(await badgeEl.isVisible())) {
      await page.evaluate((s) => window.jumpSection(s), sec);
      await page.waitForTimeout(400);
    }
    await badgeEl.click();
    await page.waitForTimeout(350);
    ok(await count(page, ".ai-badge") < badges, "撤销助手建议后字段标记消失");
  } else {
    ok(false, "未找到可撤销的助手标记");
  }
}

/* 11. 连续忽略 → 静默 → 恢复 */
await page.locator("#find-bar").click();
await page.waitForTimeout(400);
for (let i = 0; i < 3; i += 1) {
  const btn = page.locator('[data-act="ignore"]').first();
  if (await btn.count() === 0) break;
  await btn.click();
  await page.waitForTimeout(300);
}
ok((await page.locator("#dk-list").innerText()).includes("静默"), "连续 3 次不感兴趣进入静默");
ok((await page.locator("#find-text").innerText()).includes("暂停"), "静默时横条提示建议已暂停");
await page.locator("#btn-quiet").click();
await page.waitForTimeout(350);
ok(!(await page.locator("#dk-list").innerText()).includes("已进入静默模式"), "可一键恢复建议");

/* 12. 需求摘要整页 */
await page.locator("#btn-summary").click();
await page.waitForTimeout(450);
const summary = await page.locator("#sum-text").innerText();
ok(summary.includes("需求摘要"), "摘要页有标题行");
ok(summary.includes("卫生间") && summary.includes("儿童房"), "摘要按空间实例生成");
await page.screenshot({ path: path.join(SHOT, "05-需求摘要.png") });
await page.locator("#sum-done").click();
await page.waitForTimeout(350);
ok(!(await page.locator("#summary-page").evaluate((el) => el.classList.contains("on"))), "摘要页可关闭");
if (await page.locator("#sheet").evaluate((el) => el.classList.contains("on"))) {
  await page.locator("#mask").click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(350);
}

/* 13. 提交前检查 */
await page.locator("#btn-submit").click();
await page.waitForTimeout(400);
const cf = await page.locator("#cf-body").innerText();
ok(cf.includes("需求清晰度"), "提交前检查显示清晰度");
ok(cf.includes("量房确认清单"), "提交前检查说明两份输出物");
await page.locator("#cf-cancel").click();
await page.waitForTimeout(300);
ok(!(await page.locator("#confirm").evaluate((el) => el.classList.contains("on"))), "提交前检查可返回修改");

/* 14. 删除实例与重置 */
await page.evaluate(() => window.jumpSection("卫生间"));
await page.waitForTimeout(400);
{
  const before = await count(page, '.sec-card[data-sec="卫生间"] .inst-card');
  await page.locator('[data-act="del-inst"][data-sec="卫生间"]').last().click();
  await page.waitForTimeout(350);
  ok(await count(page, '.sec-card[data-sec="卫生间"] .inst-card') === before - 1, "可删除空间实例");
}
await page.locator('[data-act="reset"]').first().click();
await page.waitForTimeout(400);
ok(await count(page, ".ai-badge") === 0, "重置后清除助手标记");
await page.evaluate(() => window.jumpSection("卫生间"));
await page.waitForTimeout(400);
ok(await count(page, '.sec-card[data-sec="卫生间"] .inst-card') === 2, "重置后回到默认两个卫生间");
ok((await page.locator("#prog-num").innerText()).includes("清晰度 0%"), "重置后清晰度归零");

/* 15. 回归：直接打开模板文件不能是空白页 */
const tplPage = await context.newPage();
await tplPage.goto(TEMPLATE);
await tplPage.waitForTimeout(350);
const tplText = await tplPage.locator("body").innerText();
ok(tplText.includes("模板文件"), "直接打开模板时给出明确提示");
ok(!tplText.includes("NaN"), "直接打开模板时不出现 NaN");
await tplPage.close();

ok(errors.length === 0, errors.length ? "控制台无错误：" + errors.join(" | ") : "控制台无错误");

await browser.close();
console.log(fails.length ? `\n${fails.length} 项未通过` : "\n全部通过");
process.exit(fails.length ? 1 : 0);
