/**
 * 真实模型实测：拿三个种子场景各跑一次生成，把口径打出来。
 *
 * 用途（技术方案 4.7 第 4 条）：换个型号、改一次提示词，都用它复测一遍再定。
 * 判定口径：不降级、每条可溯源、合并命中、必问是否收敛在少数几条。
 *
 * 用法：
 *   DEEPSEEK_API_KEY=... node tools/measure-model.mjs
 *   DEEPSEEK_API_KEY=... DEEPSEEK_MODEL=deepseek-reasoner node tools/measure-model.mjs
 * 可选：API_PORT（默认 8899）、SHEETS（默认 d1,d2,d3）
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = process.env.API_PORT ?? '8899';
const BASE = `http://127.0.0.1:${PORT}`;
const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
const SHEETS = (process.env.SHEETS ?? 'd1,d2,d3').split(',').map((s) => s.trim());
const DB = path.join(ROOT, 'services', 'api', '.data', 'measure.sqlite');

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('缺少 DEEPSEEK_API_KEY：密钥只走环境变量，不进仓库');
  process.exit(2);
}

const tsx = path.join(ROOT, 'services', 'api', 'node_modules', 'tsx', 'dist', 'cli.mjs');
fs.rmSync(DB, { force: true });
const server = spawn(process.execPath, [tsx, 'src/server.ts'], {
  cwd: path.join(ROOT, 'services', 'api'),
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT, DB_PATH: DB, MODEL_PROVIDER: 'deepseek', DEEPSEEK_MODEL: MODEL },
});
/** 模型降级的原因由服务端日志给出：这几行是最有诊断价值的输出，原样带出来。 */
const serverLog = [];
server.stdout.on('data', (chunk) => serverLog.push(String(chunk)));
server.stderr.on('data', (chunk) => serverLog.push(String(chunk)));

const waitFor = async (url, timeoutMs = 60000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('等不到服务：' + url);
};

const post = (path, token, body) =>
  fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
const get = (path, token) => fetch(BASE + path, { headers: { authorization: `Bearer ${token}` } });

try {
  await waitFor(`${BASE}/health`);
  const login = await (await post('/auth/login', null, { phone: '13800000002', code: '000000' })).json();
  const token = login.token;

  const rows = [];
  for (const id of SHEETS) {
    const started = Date.now();
    const response = await post(`/demand-sheets/${id}/checklist`, token, {});
    const seconds = (Date.now() - started) / 1000;
    if (!response.ok) {
      rows.push({ id, error: `HTTP ${response.status}` });
      continue;
    }
    const checklist = await response.json();
    const merged = checklist.items.filter((i) => i.source === 'both').length;
    const external = checklist.items.filter((i) => i.source === 'derived').length;
    const duplicates = [...new Set(checklist.items.map((i) => i.object))].length !== checklist.items.length;
    rows.push({
      id,
      seconds: seconds.toFixed(1),
      degraded: checklist.degraded ? '是' : '否',
      must: checklist.counts.must,
      total: checklist.counts.total,
      merged,
      external,
      duplicates,
      groups: checklist.groups.map((g) => `${g.space}:${g.items.length}`).join(' '),
    });
  }

  console.log(`\n模型：${MODEL} · 场景：${SHEETS.join(', ')}\n`);
  console.log('场景  耗时   降级  必问/共  合并  资产外  同对象重复');
  rows.forEach((r) => {
    if (r.error) return console.log(`${r.id}    ${r.error}`);
    console.log(
      `${r.id}    ${r.seconds}s   ${r.degraded}    ${r.must}/${r.total}`.padEnd(34) +
        `${r.merged}      ${r.external}       ${r.duplicates ? '有' : '无'}`,
    );
    console.log(`      分组：${r.groups}`);
  });

  const degraded = serverLog.join('').match(/^\[清单降级\].*$/gm) ?? [];
  if (degraded.length) {
    console.log('\n降级原因：');
    degraded.forEach((line) => console.log('  ' + line));
  }
  const bad = rows.some((r) => r.error || r.degraded === '是' || r.duplicates);
  console.log(bad ? '\n有需要注意的项（降级 / 重复 / 请求失败）' : '\n口径正常：未降级、无同对象重复');
  process.exitCode = bad ? 1 : 0;
} finally {
  server.kill();
  // Windows 上文件句柄释放得晚一点，删不掉就算了：它在 .data/ 里，本来也不进仓库
  try {
    fs.rmSync(DB, { force: true });
  } catch {
    // 忽略
  }
}
