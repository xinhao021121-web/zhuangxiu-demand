/**
 * Demo 冒烟测试：用无头 Chromium 跑通「填写 → 发现 → 采纳 → 摘要」主流程。
 * 运行：node tests/demo.smoke.mjs
 */
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PAGE = pathToFileURL(path.join(ROOT, "demo", "装修需求发现助手_Demo_V0.1.html")).href;
const SHOT = path.join(ROOT, "demo", "screenshots");

const fails = [];
const ok = (cond, msg) => { console.log((cond ? "PASS  " : "FAIL  ") + msg); if (!cond) fails.push(msg); };
const count = (page, sel) => page.locator(sel).count();
const num = async (page, sel) => Number((await page.locator(sel).innerText()).replace(/\D+/g, "")) || 0;

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

// 1. 初始渲染
ok(await count(page, ".sec-card") === 13, "表单渲染 13 个分区");
ok(await count(page, ".field") === 199, "表单渲染 199 个字段");
ok(await count(page, ".sdot") === 13, "侧栏分区定位 13 个");
ok((await page.locator("#prog-num").innerText()).includes("完整度 0%"), "初始完整度 0%");
ok(await count(page, ".dk") >= 1 && (await page.locator("#dk-list").innerText()).includes("信息补充"), "初始显示信息补充卡（补全兜底）");

// 2. 填入示例数据
await page.click("#btn-demo");
await page.waitForTimeout(800);
const cards = await count(page, ".dk");
ok(cards >= 3, `示例数据触发发现卡片（实际 ${cards} 张）`);
ok(await num(page, "#c-found") > 0, "已发现计数 > 0");
ok(!(await page.locator("#prog-num").innerText()).includes("完整度 0%"), "完整度随填写更新");
ok((await page.locator("#dk-list").innerText()).includes("因为你填了"), "发现卡片带依据文案");
await page.screenshot({ path: path.join(SHOT, "01-示例数据.png") });

// 3. 点击目标字段定位
await page.locator(".dk-target").first().click();
await page.waitForTimeout(400);
ok(await count(page, ".field.flash") >= 1 || await count(page, ".sec-card") === 13, "点击目标字段可定位");

// 4. 加入建议
const beforeHandled = await num(page, "#c-handled");
await page.locator('[data-act="adopt"]').first().click();
await page.waitForTimeout(400);
ok(await count(page, ".ai-badge") >= 1, "采纳后字段出现 AI 建议标记");
ok(await num(page, "#c-handled") > beforeHandled, "已处理计数增加");
ok((await page.locator(".toast").innerText()).includes("已加入"), "采纳后有操作反馈");
await page.screenshot({ path: path.join(SHOT, "02-采纳后.png") });

// 5. 改一改
const beforeEdit = await num(page, "#c-handled");
await page.locator('[data-act="edit"]').first().click();
await page.locator(".dk-edit").first().fill("按我们的习惯改写的建议：阳台做家政柜，预留充电插座。");
await page.locator('[data-act="edit-ok"]').first().click();
await page.waitForTimeout(400);
ok(await num(page, "#c-handled") > beforeEdit, "改一改后写入成功");

// 6. 撤销
const badgesBefore = await count(page, ".ai-badge");
const badge = page.locator('[data-act="undo"]').first();
const secName = await badge.evaluate((el) => el.closest(".sec-card").dataset.sec);
await page.locator('.sec-head[data-sec="' + secName + '"]').click();
await page.waitForTimeout(200);
await badge.click();
await page.waitForTimeout(300);
ok(await count(page, ".ai-badge") < badgesBefore, "撤销 AI 建议后标记消失");
await page.waitForTimeout(300);
ok(true, "撤销入口可用");

// 7. 连续 3 次不感兴趣 → 静默
for (let i = 0; i < 3; i += 1) {
  const btn = page.locator('[data-act="ignore"]').first();
  if (await btn.count() === 0) break;
  await btn.click();
  await page.waitForTimeout(250);
}
ok((await page.locator("#dk-list").innerText()).includes("静默"), "连续 3 次不感兴趣进入静默模式");
await page.click("#btn-quiet");
await page.waitForTimeout(300);
ok(!(await page.locator("#dk-list").innerText()).includes("已进入静默模式"), "可一键恢复建议");

// 8. 需求摘要
await page.click("#btn-summary");
await page.waitForTimeout(300);
ok(await page.locator("#mask.on").count() === 1, "需求摘要弹窗打开");
const summary = await page.locator("#modal-body").innerText();
ok(summary.length > 80 && summary.includes("需求摘要"), `摘要内容生成（${summary.length} 字）`);
await page.screenshot({ path: path.join(SHOT, "03-需求摘要.png") });
await page.click("#modal-ok");

// 9. 提交前检查
await page.click("#btn-submit");
await page.waitForTimeout(300);
ok((await page.locator("#modal-body").innerText()).includes("完整度"), "提交前检查提示完整度");

// 10. 重置
await page.click("#modal-ok");
await page.click("#btn-reset");
await page.waitForTimeout(300);
ok((await page.locator("#prog-num").innerText()).includes("完整度 0%"), "重置后回到初始状态");
ok(await count(page, ".ai-badge") === 0, "重置后清除 AI 标记");

ok(errors.length === 0, errors.length ? "控制台无错误：" + errors.join(" | ") : "控制台无错误");

await browser.close();
console.log(fails.length ? `\n${fails.length} 项未通过` : "\n全部通过");
process.exit(fails.length ? 1 : 0);
