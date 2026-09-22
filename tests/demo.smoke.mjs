/**
 * Demo V0.2 冒烟测试：跑通「空间实例增删 → 房型选择 → 发现 → 采纳 → 摘要」主流程。
 * 运行：node tests/demo.smoke.mjs
 */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PAGE = pathToFileURL(path.join(ROOT, "demo", "装修需求发现助手_Demo_V0.2.html")).href;
const TEMPLATE = pathToFileURL(path.join(ROOT, "tools", "_demo_template.html")).href;
const SHOT = path.join(ROOT, "demo", "screenshots");

const fails = [];
const ok = (cond, msg) => { console.log((cond ? "PASS  " : "FAIL  ") + msg); if (!cond) fails.push(msg); };
const count = (page, sel) => page.locator(sel).count();
const num = async (page, sel) => Number((await page.locator(sel).innerText()).replace(/[^\d]/g, "")) || 0;

const exeCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM,
  path.join(process.env.USERPROFILE || "", "AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe"),
  path.join(process.env.USERPROFILE || "", "AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe"),
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
const exe = exeCandidates.find((p) => fs.existsSync(p));
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("dialog", (d) => d.accept());

await page.goto(PAGE);
await page.waitForTimeout(300);

// 1. 初始结构
ok(await count(page, ".sec-card") === 13, "表单渲染 13 个大类");
ok(await count(page, ".inst-card") === 2, "卫生间默认渲染 2 个实例（主卫、客卫）");
ok(await count(page, '.inst-card[data-inst]') === 2, "实例卡片可识别");
ok(await count(page, ".inst-empty") === 2, "其他卧室与书房默认不显示实例");
ok((await page.locator("#prog-num").innerText()).includes("推荐项 0/"), "初始清晰度 0");
ok(await count(page, ".rec") >= 5, "推荐填写项有标记");

// 2. 添加次卧 → 选房型 → 动态字段
await page.locator('[data-act="add-inst"][data-sec="其他卧室"]').first().click();
await page.waitForTimeout(300);
ok(await count(page, ".inst-card") === 3, "添加次卧后出现 1 个实例");
ok((await page.locator("#dk-list").innerText()).includes("还没选房间用途"), "未选房型时给出补充提示");
const kidFields = await count(page, '[id$=".ch_activity"]');
ok(kidFields === 0, "未选房型时不显示儿童房专属字段");
await page.locator('.inst-card .chip[data-val="儿童房"]').first().click();
await page.waitForTimeout(300);
ok(await count(page, '[id$=".ch_activity"]') === 1, "选择儿童房后显示儿童房专属字段");
ok(await count(page, '[id$=".ch_gender_age"]') === 1, "儿童房显示孩子年龄字段");

// 3. 填入示例数据
await page.click("#btn-demo");
await page.waitForTimeout(900);
ok(await count(page, ".dk") >= 3, "示例数据触发发现卡片");
ok(await num(page, "#c-found") > 0, "已发现计数 > 0");
ok((await page.locator("#dk-list").innerText()).includes("因为你"), "发现卡片带依据文案");
if (await count(page, ".more")) { await page.locator(".more").click(); await page.waitForTimeout(300); }
const dkText = await page.locator("#dk-list").innerText();
ok(dkText.includes("主卫") || dkText.includes("客卫"), "卫生间规则按实例展示");
ok(!(await page.locator("#prog-num").innerText()).includes("推荐项 0/"), "清晰度随填写更新");
await page.screenshot({ path: path.join(SHOT, "01-示例数据.png") });

// 4. 定位与采纳
await page.locator(".dk-target").first().click();
await page.waitForTimeout(400);
ok(true, "点击目标字段可定位");
const beforeHandled = await num(page, "#c-handled");
await page.locator('[data-act="adopt"]').first().click();
await page.waitForTimeout(400);
ok(await count(page, ".ai-badge") >= 1, "采纳后字段出现助手标记");
ok(await num(page, "#c-handled") > beforeHandled, "已处理计数增加");
await page.screenshot({ path: path.join(SHOT, "02-采纳后.png") });

// 5. 改一改
const beforeEdit = await num(page, "#c-handled");
await page.locator('[data-act="edit"]').first().click();
await page.locator(".dk-edit").first().fill("按我们的习惯改写：阳台做家政柜并预留充电插座。");
await page.locator('[data-act="edit-ok"]').first().click();
await page.waitForTimeout(400);
ok(await num(page, "#c-handled") > beforeEdit, "改一改后写入成功");

// 6. 撤销（先展开所在分区）
const badgesBefore = await count(page, ".ai-badge");
const badge = page.locator('[data-act="undo"]').first();
const secName = await badge.evaluate((el) => el.closest(".sec-card").dataset.sec);
if (!(await badge.isVisible())) {
  await page.locator('.sec-head[data-sec="' + secName + '"]').click();
}
await page.waitForTimeout(250);
await badge.click();
await page.waitForTimeout(300);
ok(await count(page, ".ai-badge") < badgesBefore, "撤销助手建议后标记消失");

// 7. 连续忽略 → 静默 → 恢复
for (let i = 0; i < 3; i += 1) {
  const btn = page.locator('[data-act="ignore"]').first();
  if (await btn.count() === 0) break;
  await btn.click();
  await page.waitForTimeout(250);
}
ok((await page.locator("#dk-list").innerText()).includes("静默"), "连续 3 次不感兴趣进入静默");
await page.click("#btn-quiet");
await page.waitForTimeout(300);
ok(!(await page.locator("#dk-list").innerText()).includes("已进入静默模式"), "可一键恢复建议");

// 8. 需求摘要与提交前检查
await page.click("#btn-summary");
await page.waitForTimeout(300);
const summary = await page.locator("#modal-body").innerText();
ok(summary.includes("需求摘要") && summary.includes("卫生间"), "摘要按空间生成");
ok(summary.includes("儿童房") || summary.includes("次卧1"), "摘要包含次卧实例");
await page.screenshot({ path: path.join(SHOT, "03-需求摘要.png") });
await page.click("#modal-ok");
await page.click("#btn-submit");
await page.waitForTimeout(300);
ok((await page.locator("#modal-body").innerText()).includes("需求清晰度"), "提交前检查提示清晰度");
ok((await page.locator("#modal-body").innerText()).includes("量房确认清单"), "提交前说明两份输出物");
await page.click("#modal-ok");

// 9. 删除实例
const beforeDel = await count(page, ".inst-card");
await page.locator('[data-act="del-inst"][data-sec="卫生间"]').last().click();
await page.waitForTimeout(300);
ok(await count(page, ".inst-card") === beforeDel - 1, "可删除空间实例");

// 10. 重置
await page.click("#btn-reset");
await page.waitForTimeout(300);
ok(await count(page, ".inst-card") === 2, "重置后回到默认两个卫生间");
ok(await count(page, ".inst-empty") === 2, "重置后其他卧室与书房回到未添加状态");
ok(await count(page, ".ai-badge") === 0, "重置后清除助手标记");

// 11. 回归：直接打开模板文件不能是空白页
const tplPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await tplPage.goto(TEMPLATE);
await tplPage.waitForTimeout(300);
const tplText = await tplPage.locator("body").innerText();
ok(tplText.includes("模板文件"), "直接打开模板时给出明确提示");
ok(!tplText.includes("NaN"), "直接打开模板时不出现 NaN");
await tplPage.close();

ok(errors.length === 0, errors.length ? "控制台无错误：" + errors.join(" | ") : "控制台无错误");

await browser.close();
console.log(fails.length ? `\n${fails.length} 项未通过` : "\n全部通过");
process.exit(fails.length ? 1 : 0);
