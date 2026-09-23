/**
 * 起本地服务：API 服务与桌面工作台各起一个进程，跑完测试再收掉。
 *
 * 直接用 node 跑 tsx / next 的入口，不经过 shell，避免 Windows 上 .cmd 转发的麻烦。
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const TSX = path.join(ROOT, 'services', 'api', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const NEXT = path.join(ROOT, 'studio', 'node_modules', 'next', 'dist', 'bin', 'next');

export const API_PORT = process.env.API_PORT ?? '8787';
export const STUDIO_PORT = process.env.STUDIO_PORT ?? '3000';
export const API_BASE = `http://127.0.0.1:${API_PORT}`;
export const STUDIO_BASE = `http://127.0.0.1:${STUDIO_PORT}`;

function spawnNode(args, options = {}) {
  return spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

async function waitFor(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return true;
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`等不到服务：${url}`);
}

export async function startApi({ dbPath } = {}) {
  const db = dbPath ?? path.join(ROOT, 'services', 'api', '.data', 'e2e.sqlite');
  fs.rmSync(db, { force: true });
  const child = spawnNode([TSX, 'src/server.ts'], {
    cwd: path.join(ROOT, 'services', 'api'),
    env: { ...process.env, PORT: API_PORT, DB_PATH: db },
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  await waitFor(`${API_BASE}/health`);
  return child;
}

export async function startStudio() {
  const child = spawnNode([NEXT, 'start', '--port', STUDIO_PORT], { cwd: path.join(ROOT, 'studio') });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  await waitFor(STUDIO_BASE);
  return child;
}

/** 构建产物不在就先构建一次：next start 需要 .next。 */
export function ensureStudioBuild() {
  const buildId = path.join(ROOT, 'studio', '.next', 'BUILD_ID');
  if (fs.existsSync(buildId)) return;
  const result = spawnSync(NEXT, ['build'], { cwd: path.join(ROOT, 'studio'), stdio: 'inherit' });
  if (result.status !== 0) throw new Error('next build 失败');
}

export function stop(child) {
  if (!child || child.killed) return;
  try {
    child.kill();
  } catch {
    // 已经退出了
  }
}
