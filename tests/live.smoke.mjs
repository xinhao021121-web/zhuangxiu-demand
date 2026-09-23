/**
 * 线上地址验证：发布完成后用真实公网地址跑一遍入口页与三个入口。
 * 运行：
 *   node tests/live.smoke.mjs                                   # 默认验证 Cloudflare Pages 地址
 *   node tests/live.smoke.mjs --url https://example.com/        # 验证另一个线上地址
 */
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser } from './browser.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOT = path.join(ROOT, 'app', 'screenshots');

const argIndex = process.argv.indexOf('--url');
const URL_TO_CHECK =
  (argIndex >= 0 ? process.argv[argIndex + 1] : '') ||
  process.env.ZX_LIVE_URL ||
  'https://demand-studio.pages.dev/';

const APP_URL = new URL('app/', URL_TO_CHECK).href;
const STUDIO_URL = new URL('studio/', URL_TO_CHECK).href;
const ONSITE_URL = new URL('onsite/', URL_TO_CHECK).href;

const fails = [];
const ok = (cond, msg) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + msg);
  if (!cond) fails.push(msg);
};
const fetchText = (url) =>
  fetch(url, { headers: { 'User-Agent': 'codex-live-check' } }).catch((e) => ({ error: e }));

console.log(`验证地址：${URL_TO_CHECK}`);

/* 一、入口页：投递给招聘方的那个链接 */
const landing = await fetchText(URL_TO_CHECK);
if (landing.error) {
  ok(false, `入口页可访问（${landing.error.message}）`);
} else {
  const html = await landing.text();
  ok(landing.status === 200, `入口页返回 200（实际 ${landing.status}）`);
  ok(landing.headers.get('content-type')?.includes('text/html'), '入口页 Content-Type 是 text/html');
  ok(html.includes('设计需求解读台'), '入口页是作品集首页');
  ok(
    html.includes('./studio/') && html.includes('./onsite/') && html.includes('./app/'),
    '入口页给出三个体验入口',
  );
  ok(html.includes('判据') && html.includes('脱敏'), '入口页写出关键设计点');
}

/* 二、采集端 H5（在 /app/ 下，用相对路径，两种托管都不用改） */
const intake = await fetchText(APP_URL);
if (intake.error) {
  ok(false, `采集端可访问（${intake.error.message}）`);
} else {
  const html = await intake.text();
  ok(intake.status === 200, `采集端返回 200（实际 ${intake.status}）`);
  ok(html.includes('id="app"'), '采集端包含应用挂载节点');
  const assetPaths = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((m) => m[1]);
  ok(assetPaths.length >= 2, `采集端引用了 ${assetPaths.length} 个静态资源`);
  const jsAsset = assetPaths.find((p) => p.endsWith('.js'));
  const jsRes = await fetch(new URL(jsAsset, APP_URL).href, { headers: { 'User-Agent': 'codex-live-check' } });
  ok(jsRes.status === 200, '采集端 JS 产物可以从线上地址加载');
}

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

/* 三、入口页在浏览器里 */
await page.goto(URL_TO_CHECK, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.hero h1', { timeout: 30000 });
ok((await page.title()).includes('作品集'), '入口页标题正确');
ok((await page.locator('a.btn.primary').getAttribute('href')) === './studio/', '主按钮指向桌面工作台');
ok((await page.locator('a.btn').count()) >= 3, '入口页有三个入口按钮');
await page.screenshot({ path: path.join(SHOT, 'pages-00-入口页.png'), fullPage: true });

/* 四、采集端主流程 */
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.sec-card', { timeout: 30000 });
ok((await page.locator('.sec-card').count()) === 13, '采集端渲染 13 个大类');
ok((await page.locator('.assistant-side').count()) === 1, '宽屏下助手侧栏就位');
await page.click('#btn-demo');
await page.waitForTimeout(600);
const found = await page.locator('#c-found').innerText();
ok(Number(found.replace(/\D/g, '')) > 0, `采集端助手给出发现（已发现 ${found} 条）`);
ok((await page.locator('.dk').count()) > 0, '采集端展示发现卡片');
fs.mkdirSync(SHOT, { recursive: true });
await page.screenshot({ path: path.join(SHOT, '06-线上站点.png') });

/**
 * 另外两个入口：桌面工作台与现场端 PWA。
 * 它们在没有 API 服务时走演示模式（浏览器内跑同一套领域包），所以线上也应该能点开。
 */
async function checkApp(label, url, selector, extra) {
  const res = await fetch(url, { headers: { 'User-Agent': 'codex-live-check' } }).catch((e) => ({ error: e }));
  if (!res || res.error) {
    ok(false, `${label}可访问（${res?.error?.message ?? '请求失败'}）`);
    return;
  }
  ok(res.status === 200, `${label}返回 200（实际 ${res.status}）`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.login', { timeout: 30000 });
  await page.waitForTimeout(800); // 等 React 水合：水合前点击会触发原生表单提交
  let entered = false;
  for (let attempt = 0; attempt < 6 && !entered; attempt += 1) {
    await page.locator('.login button[type="submit"]').click().catch(() => {});
    entered = await page
      .waitForSelector(selector, { timeout: 4000 })
      .then(() => true)
      .catch(() => false);
  }
  ok(entered, `${label}登录后进得去`);
  if (!entered) return;
  ok(await extra(), `${label}的演示动线跑得通`);
}

await checkApp('桌面工作台', STUDIO_URL, '.dcard', async () => {
  const cards = await page.locator('.dcard').count();
  const hasChecklist = (await page.locator('.dcard.on').innerText()).includes('已解读');
  return cards === 3 && hasChecklist;
});

await checkApp('现场端', ONSITE_URL, '.dc', async () => {
  const cards = await page.locator('.dc').count();
  // 可装到手机主屏幕：service worker 注册上了，manifest 也在
  const ready = await page.evaluate(async () => {
    const sw = 'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).length > 0 : false;
    const link = document.querySelector('link[rel="manifest"]');
    const manifest = link ? await fetch(link.href).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null;
    return sw && !!manifest && manifest.start_url === './';
  });
  return cards === 3 && ready;
});

await browser.close();
ok(errors.length === 0, errors.length ? `线上页面控制台无错误：${errors.join(' | ')}` : '线上页面控制台无错误');
console.log(fails.length ? `\n${fails.length} 项未通过` : '\n全部通过');
process.exit(fails.length ? 1 : 0);