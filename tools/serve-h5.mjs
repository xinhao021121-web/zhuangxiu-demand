/**
 * H5 产物静态服务器：本机预览与内网演示用，也是「同一个产物部署为静态站点」的本地等价物。
 *
 * 用法：
 *   node tools/serve-h5.mjs                              # http://127.0.0.1:4173
 *   node tools/serve-h5.mjs --port 8080 --host 0.0.0.0   # 局域网可访问
 *   node tools/serve-h5.mjs --root app/dist/h5           # 指定产物目录
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};
const TEXT_LIKE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.txt', '.svg']);
/** 带内容哈希的文件名可以长期缓存，其余保持短缓存。 */
const HASHED = /\.[0-9a-f]{8,}\.(js|css)$/;

function parseArgs(argv) {
  const args = { port: 4173, host: '127.0.0.1', root: path.join(PROJECT_ROOT, 'app', 'dist', 'h5'), prefix: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--port' && value) args.port = Number(value);
    else if (key === '--host' && value) args.host = value;
    else if (key === '--root' && value) args.root = path.resolve(PROJECT_ROOT, value);
    else if (key === '--prefix' && value) args.prefix = value.replace(/\/+$/, '');
  }
  return args;
}

const { port, host, root, prefix } = parseArgs(process.argv.slice(2));
const ROOT_WITH_SEP = root.endsWith(path.sep) ? root : root + path.sep;

/** 解析请求路径，越界（../）直接拒绝。prefix 用于模拟「部署在 /<repo>/ 这种子路径下」。 */
function resolveInside(urlPath, urlPrefix = '') {
  if (urlPrefix && urlPath !== urlPrefix && !urlPath.startsWith(urlPrefix + '/')) return null;
  const rel = decodeURIComponent(urlPrefix ? urlPath.slice(urlPrefix.length) : urlPath).replace(/^[/\\]+/, '');
  const full = path.resolve(root, rel || 'index.html');
  if (full !== root && !full.startsWith(ROOT_WITH_SEP)) return null;
  return full;
}

async function isFile(file) {
  const stat = await fsp.stat(file).catch(() => null);
  return stat?.isFile() ? stat : null;
}

/** 命中文件返回文件；目录取 index.html；页面类请求找不到时回退到 index.html（深链接兼容）。 */
async function pickFile(urlPath, urlPrefix = '') {
  const full = resolveInside(urlPath, urlPrefix);
  if (!full) return { error: 400 };
  const stat = await fsp.stat(full).catch(() => null);
  if (stat?.isDirectory()) {
    const index = path.join(full, 'index.html');
    return (await isFile(index)) ? { file: index } : { error: 404 };
  }
  if (stat?.isFile()) return { file: full };
  const ext = path.extname(full);
  if (ext && ext !== '.html') return { error: 404 };
  const index = path.join(root, 'index.html');
  return (await isFile(index)) ? { file: index } : { error: 404 };
}

function headersFor(file, size) {
  const ext = path.extname(file).toLowerCase();
  const name = path.basename(file);
  const cache =
    name === 'index.html'
      ? 'no-cache'
      : HASHED.test(name)
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600';
  return {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': String(size),
    'Cache-Control': cache,
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Method Not Allowed');
    return;
  }
  const picked = await pickFile((req.url || '/').split('?')[0], prefix);
  if (picked.error) {
    res.writeHead(picked.error, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(picked.error === 400 ? '非法路径' : 'Not Found');
    return;
  }
  const body = await fsp.readFile(picked.file);
  const ext = path.extname(picked.file).toLowerCase();
  const acceptsGzip = String(req.headers['accept-encoding'] || '').includes('gzip');
  const headers = headersFor(picked.file, body.length);
  let payload = body;
  if (acceptsGzip && TEXT_LIKE.has(ext) && body.length > 1024) {
    payload = zlib.gzipSync(body, { level: 6 });
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = String(payload.length);
    headers.Vary = 'Accept-Encoding';
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : payload);
});

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((info) => info && info.family === 'IPv4' && !info.internal)
    .map((info) => info.address);
}

if (!fs.existsSync(path.join(root, 'index.html'))) {
  console.error(`找不到产物：${path.join(root, 'index.html')}\n请先运行：pnpm run build:h5`);
  process.exit(1);
}

/** 端口被占用时给一句可执行的提示，而不是抛栈。 */
function listen(targetPort, attempt = 0) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && attempt === 0 && !process.argv.includes('--port')) {
      console.warn(`端口 ${targetPort} 已被占用，改用 ${targetPort + 1}`);
      listen(targetPort + 1, 1);
      return;
    }
    console.error(
      e.code === 'EADDRINUSE'
        ? `启动失败：端口 ${targetPort} 已被占用，可加 --port 指定其他端口`
        : `启动失败：${e.message}`,
    );
    process.exit(1);
  });
  server.listen(targetPort, host, () => {
    const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
    console.log('Web 端已上线（静态站点）');
    console.log(`  本机：http://${shown}:${targetPort}/`);
    if (host === '0.0.0.0' || host === '::') {
      lanAddresses().forEach((ip) => console.log(`  局域网：http://${ip}:${targetPort}/`));
    } else {
      console.log('  手机与其他设备访问：用 --host 0.0.0.0 重新启动');
    }
    console.log(`  产物目录：${root}`);
  });
}

listen(port);
