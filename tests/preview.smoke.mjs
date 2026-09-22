/**
 * Web 端上线冒烟测试：启动静态服务，按真实 HTTP 行为校验产物可用。
 * 运行：node tests/preview.smoke.mjs（先执行 pnpm run build:h5）
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { launchBrowser } from './browser.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 4300 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;

const fails = [];
const ok = (cond, msg) => {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + msg);
  if (!cond) fails.push(msg);
};

const server = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve-h5.mjs'), '--port', String(PORT)], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

async function waitReady() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return true;
    } catch {
      /* 还没起来，继续等 */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

try {
  ok(await waitReady(), '静态服务可以启动并响应');
  ok(serverLog.includes('http://127.0.0.1'), '启动日志给出可访问地址');

  const index = await fetch(`${BASE}/`);
  const indexHtml = await index.text();
  ok(index.status === 200, 'GET / 返回 200');
  ok(index.headers.get('content-type').includes('text/html'), '首页 Content-Type 是 text/html');
  ok(index.headers.get('cache-control') === 'no-cache', 'index.html 不缓存，发版即生效');
  ok(indexHtml.includes('id="app"'), '首页包含应用挂载节点');

  const assetPaths = [...indexHtml.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((m) => m[1]);
  ok(assetPaths.length >= 2, `首页引用了 ${assetPaths.length} 个静态资源`);

  const jsAsset = assetPaths.find((p) => p.endsWith('.js'));
  const jsRes = await fetch(`${BASE}/${jsAsset}`);
  ok(jsRes.status === 200, 'JS 产物可以直接访问');
  ok(jsRes.headers.get('content-type').includes('javascript'), 'JS 产物 MIME 正确');
  ok((jsRes.headers.get('cache-control') || '').includes('immutable'), '带哈希的产物长期缓存（immutable）');

  const gzipRes = await fetch(`${BASE}/${jsAsset}`, { headers: { 'accept-encoding': 'gzip' } });
  ok((gzipRes.headers.get('content-encoding') || '') === 'gzip', '文本资源支持 gzip');

  const deepLink = await fetch(`${BASE}/some/deep/link`);
  ok(deepLink.status === 200, '未知路径回退到 index.html（深链接兼容）');

  const missing = await fetch(`${BASE}/js/not-exist.js`);
  ok(missing.status === 404, '缺失的静态资源返回 404，不误回退成 HTML');

  const traversal = await fetch(`${BASE}/%2e%2e/package.json`);
  const traversalBody = await traversal.text();
  ok(traversal.status !== 200 || !traversalBody.includes('zhuangxiu-demand'), '目录穿越被拦截');

  // 无头浏览器在真实服务地址上跑首屏，确认「能打开」而不是只有 200
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(BASE);
  await page.waitForSelector('.sec-card', { timeout: 20000 });
  ok((await page.locator('.sec-card').count()) === 13, '在线地址上渲染 13 个大类');
  ok((await page.locator('.assistant-side').count()) === 1, '宽屏下助手侧栏就位');
  await page.click('#btn-demo');
  await page.waitForTimeout(400);
  ok((await page.locator('.dk').count()) > 0, '在线地址上助手给出发现');
  ok(errors.length === 0, errors.length ? '在线地址控制台无错误：' + errors.join(' | ') : '在线地址控制台无错误');
  await browser.close();
} finally {
  server.kill();
}

console.log(fails.length ? `\n${fails.length} 项未通过` : '\n全部通过');
process.exit(fails.length ? 1 : 0);
