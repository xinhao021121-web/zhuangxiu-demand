/**
 * 上线产物端到端：按 gh-pages 的真实目录结构组装一次，再用静态服务器按 /<repo>/ 前缀托管，
 * 逐个体检三个入口——采集端 H5、桌面工作台、现场端 PWA（都是线上那份产物）。
 *
 * 运行：pnpm run test:pages（会重新构建三个产物；快速迭代可 SKIP_BUILD=1）
 */
import path from 'node:path';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { launchBrowser } from './browser.mjs';
import { ROOT } from './servers.mjs';

const PORT = process.env.PAGES_PORT ?? '4175';
const PREFIX = '/zhuangxiu-demand';
const BASE = `http://127.0.0.1:${PORT}${PREFIX}/`;
const SHOT = path.join(ROOT, 'tests', 'screenshots');

const fails = [];
const ok = (cond, msg) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + msg);
  if (!cond) fails.push(msg);
};

// 一、组装发布目录（--dry-run：只组装不推送）
// 每次都自己构建：别的测试会把 onsite/dist 覆写成非演示产物，复用会验错东西。
// 快速迭代时可以 SKIP_BUILD=1 复用现有产物。
const buildArgs = ['tools/deploy-github-pages.mjs', '--dry-run'];
if (process.env.SKIP_BUILD === '1') buildArgs.push('--skip-build');
const assembled = spawnSync(process.execPath, buildArgs, { cwd: ROOT, encoding: 'utf8' });
if (assembled.status !== 0) {
  console.error(assembled.stdout, assembled.stderr);
  throw new Error('组装发布目录失败');
}
const workDir = assembled.stdout.match(/发布目录：\s*(\S+)/)?.[1];
if (!workDir) throw new Error('没解析出组装目录');
console.log(`组装目录：${workDir}\n`);

// 二、按 /<repo>/ 前缀托管，等价于 GitHub Pages 上的路径
const server = spawn(
  process.execPath,
  ['tools/serve-h5.mjs', '--root', workDir, '--port', PORT, '--prefix', PREFIX],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
);
const waitFor = async (url, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('等不到静态服务器：' + url);
};
await waitFor(BASE);

const browser = await launchBrowser();
const count = (page, sel) => page.locator(sel).count();
const text = (page, sel) => page.locator(sel).first().innerText();

try {
  fs.mkdirSync(SHOT, { recursive: true });

  // 三、入口页（投递给招聘方的那个链接）
  const landing = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const landingErrors = [];
  landing.on('pageerror', (e) => landingErrors.push('pageerror: ' + e.message));
  landing.on('console', (m) => {
    if (m.type() === 'error') landingErrors.push('console: ' + m.text());
  });
  await landing.goto(BASE);
  await landing.waitForSelector('.hero h1');
  ok((await landing.title()).includes('作品集'), '入口页打得开');
  ok((await landing.locator('a.btn').count()) >= 3, '入口页给出三个体验入口');
  ok((await landing.locator('a.btn.primary').getAttribute('href')) === './studio/', '主入口指向桌面工作台');
  ok((await landing.locator('img').count()) >= 3, '入口页带界面截图');
  const imagesOk = await landing.evaluate(() =>
    [...document.querySelectorAll('img')].every((img) => img.complete && img.naturalWidth > 0),
  );
  ok(imagesOk, '入口页三张截图都真的加载出来了');
  await landing.setViewportSize({ width: 390, height: 844 });
  await landing.waitForTimeout(300);
  const landingNarrow = await landing.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  ok(landingNarrow <= 0, `入口页窄屏无横向溢出（${landingNarrow}px）`);
  await landing.setViewportSize({ width: 1280, height: 900 });
  await landing.waitForTimeout(200);
  await landing.screenshot({ path: path.join(SHOT, 'pages-00-入口页.png'), fullPage: true });
  ok(landingErrors.length === 0, '入口页控制台无错误' + (landingErrors.length ? '：' + landingErrors.join(' | ') : ''));
  await landing.close();

  // 四、采集端 H5（宽屏，挂在 /app/ 下）
  const intake = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const intakeErrors = [];
  intake.on('pageerror', (e) => intakeErrors.push('pageerror: ' + e.message));
  intake.on('console', (m) => {
    if (m.type() === 'error') intakeErrors.push('console: ' + m.text());
  });
  await intake.goto(`${BASE}app/`);
  await intake.waitForTimeout(1200);
  ok((await intake.title()).includes('问需 · 采集'), '采集端 H5 打得开');
  ok((await intake.locator('#app').count()) === 1, '采集端挂载点存在');
  const intakeManifest = await intake.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return null;
    const res = await fetch(link.href);
    return res.ok ? res.json() : null;
  });
  ok(!!intakeManifest?.name?.includes('问需'), '采集端带可装机的 manifest（手机版）');
  const intakeSw = await intake.request.get(`${BASE}app/sw.js`);
  ok(intakeSw.ok(), '采集端 service worker 可下载（装到主屏幕后断网也能打开）');
  ok(intakeErrors.length === 0, '采集端控制台无错误' + (intakeErrors.length ? '：' + intakeErrors.join(' | ') : ''));
  await intake.screenshot({ path: path.join(SHOT, 'pages-01-采集端.png') });
  await intake.close();

  // 四、桌面工作台（演示模式）
  const studio = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  const studioErrors = [];
  studio.on('pageerror', (e) => studioErrors.push('pageerror: ' + e.message));
  studio.on('console', (m) => {
    if (m.type() === 'error') studioErrors.push('console: ' + m.text());
  });
  await studio.goto(`${BASE}studio/`);
  await studio.waitForTimeout(800);
  ok(await studio.locator('.login').isVisible(), '桌面工作台打得开，落在登录页');
  await studio.locator('.login button[type="submit"]').click();
  await studio.waitForSelector('.dcard');
  ok((await count(studio, '.dcard')) === 3, '线上演示列出 3 份需求单');
  ok((await text(studio, '#demo-pill')).includes('演示数据'), '标明这是演示数据（未接服务端）');
  ok((await text(studio, '.dcard.on')).includes('已解读'), '主场景是已解读状态');
  await studio.locator('.tab[data-tab="list"]').click();
  await studio.waitForSelector('.item');
  ok((await count(studio, '.item')) === 21, '线上演示的清单 21 条');
  ok((await text(studio, '.card h3')).includes('必问 11 条'), '线上演示的必问 11 条（与种子场景一致）');
  ok((await count(studio, '.badge.b-src-both')) >= 3, '推导项与通用项已合并');
  // 演示模式也要能补录与看报表：静态托管那份走的是浏览器内的 LocalService，不是另一套假数据
  await studio.locator('#om-note').fill('线上演示补的一条遗漏');
  await studio.locator('#om-add').click();
  await studio.waitForSelector('#om-list');
  ok((await text(studio, '#om-list')).includes('线上演示补的一条遗漏'), '演示模式也能补录遗漏');
  await studio.locator('#btn-reports').click();
  await studio.waitForSelector('#rep-rules');
  ok(
    (await count(studio, '#rep-criteria .rtable tr')) > 1 && (await count(studio, '#rep-fields .rtable tr')) > 1,
    '演示模式的判据与字段健康度都出得了数',
  );
  ok((await text(studio, '#rep-omissions')).includes('线上演示补的一条遗漏'), '演示模式的遗漏台账看得到补录');
  ok((await text(studio, '#rep-fields')).includes('未采集'), '演示模式也如实标出没有来源的列');
  await studio.locator('#rep-back').click();
  await studio.waitForTimeout(200);
  await studio.screenshot({ path: path.join(SHOT, 'pages-02-桌面工作台.png') });
  ok(studioErrors.length === 0, '桌面工作台控制台无错误' + (studioErrors.length ? '：' + studioErrors.join(' | ') : ''));
  await studio.close();

  // 五、现场端 PWA（演示模式）
  const onsite = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const onsiteErrors = [];
  onsite.on('pageerror', (e) => onsiteErrors.push('pageerror: ' + e.message));
  onsite.on('console', (m) => {
    if (m.type() === 'error') onsiteErrors.push('console: ' + m.text());
  });
  await onsite.goto(`${BASE}onsite/`);
  await onsite.waitForTimeout(800);
  ok(await onsite.locator('.login').isVisible(), '现场端打得开，落在登录页');
  await onsite.locator('.login button[type="submit"]').click();
  await onsite.waitForSelector('.dc');
  ok((await count(onsite, '.dc')) === 3, '现场端列出 3 份需求单');
  ok((await text(onsite, '.tt span')).includes('演示数据'), '标明这是演示数据');
  await onsite.locator('.dc', { hasText: '张先生' }).click();
  await onsite.waitForSelector('#go');
  ok((await text(onsite, '.stats .stat')).includes('11'), '现场端拿到必问 11 条');
  await onsite.locator('#go').click();
  await onsite.waitForSelector('.task');
  ok((await count(onsite, '.task')) === 7, '基本信息 7 条（与种子场景一致）');
  ok((await text(onsite, '.task')).includes('需求推导 + 通用核实'), '条目带来源徽标');
  const manifest = await onsite.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return null;
    const res = await fetch(link.href);
    return res.ok ? await res.json() : null;
  });
  ok(!!manifest && manifest.start_url === './', '子路径下 manifest 仍然可用（可装到主屏幕）');
  await onsite.screenshot({ path: path.join(SHOT, 'pages-03-现场端.png') });
  ok(onsiteErrors.length === 0, '现场端控制台无错误' + (onsiteErrors.length ? '：' + onsiteErrors.join(' | ') : ''));
  await onsite.close();
} finally {
  await browser.close();
  server.kill();
  fs.rmSync(workDir, { recursive: true, force: true });
}

console.log(fails.length ? `\n${fails.length} 项未通过` : '\n全部通过');
process.exit(fails.length ? 1 : 0);
