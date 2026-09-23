/**
 * 把三个静态产物发布到 GitHub Pages（gh-pages 分支，不需要 Actions 权限）。
 *
 * 用法：
 *   node tools/deploy-github-pages.mjs                 # 用 origin 作为目标仓库
 *   node tools/deploy-github-pages.mjs --repo https://github.com/<owner>/<repo>.git
 *   node tools/deploy-github-pages.mjs --skip-build    # 复用已有产物
 *   node tools/deploy-github-pages.mjs --dry-run      # 只组装不推送（本地验证用）
 *
 * 两个托管方的路径前缀不同，所以前缀是构建参数：
 *   GitHub Pages 的仓库页挂在 /<repo>/ 下 → 默认前缀 /zhuangxiu-demand
 *   Cloudflare Pages 挂在根 → --target pages（前缀为空）
 * 采集端 H5 用的是相对路径，两边都不用改。
 *
 *   node tools/deploy-github-pages.mjs --target pages    # 发到 Cloudflare Pages（wrangler）
 *
 * 目录结构（页面上就是这四个地址）：
 *   /                入口页（landing/，投递给招聘方的那个链接）
 *   /app/            采集端 H5（app/dist/h5，宽屏 Web / 窄屏展示版）
 *   /studio/         桌面工作台（Next 静态导出，演示模式）
 *   /onsite/         现场端 PWA（Vite 产物，演示模式）
 *
 * API 服务跑不在 Pages 上：两个端在演示模式下用浏览器内的实现跑同一套领域包，
 * 真实服务接回来时把 NEXT_PUBLIC_API_BASE / VITE_API_BASE 指向自己的域名即可。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO_SLUG = 'zhuangxiu-demand';
const STUDIO_EXPORT = path.join(PROJECT_ROOT, 'studio', '.next-export');

/** 三个产物各自从哪来、放到页面上的哪个位置。 */
const TARGETS = [
  { name: '入口页', from: path.join(PROJECT_ROOT, 'landing'), to: '' },
  { name: '采集端 H5', from: path.join(PROJECT_ROOT, 'app', 'dist', 'h5'), to: 'app' },
  { name: '桌面工作台', from: STUDIO_EXPORT, to: 'studio' },
  { name: '现场端 PWA', from: path.join(PROJECT_ROOT, 'onsite', 'dist'), to: 'onsite' },
];

function git(args, options = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} 失败：${(result.stderr || result.stdout || '').trim()}`);
  }
  return (result.stdout || '').trim();
}

function parseArgs(argv) {
  const pick = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : '');
  const args = {
    repo: '',
    skipBuild: argv.includes('--skip-build'),
    dryRun: argv.includes('--dry-run'),
    target: argv.includes('--target') ? argv[argv.indexOf('--target') + 1] : 'gh-pages',
    prefix: argv.includes('--prefix') ? argv[argv.indexOf('--prefix') + 1] : null,
    outDir: pick('--out'),
  };
  if (args.target !== 'gh-pages' && args.target !== 'pages') throw new Error('--target 只能是 gh-pages 或 pages');
  if (args.prefix === null) args.prefix = args.target === 'pages' ? '' : '/zhuangxiu-demand';
  const i = argv.indexOf('--repo');
  if (i >= 0 && argv[i + 1]) args.repo = argv[i + 1];
  if (!args.repo) {
    const remotes = git(['remote'], { cwd: PROJECT_ROOT }).split('\n').filter(Boolean);
    if (!remotes.includes('origin')) {
      throw new Error('没有配置 origin 远程，请先用 --repo https://github.com/<owner>/<repo>.git 指定');
    }
    args.repo = git(['remote', 'get-url', 'origin'], { cwd: PROJECT_ROOT });
  }
  return args;
}

function pagesUrl(repo) {
  const match = repo.match(/github\.com[/:]([^/]+)\/(.+?)(\.git)?$/);
  if (!match) return null;
  return `https://${match[1]}.github.io/${match[2]}/`;
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from, { withFileTypes: true }).forEach((entry) => {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  });
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const { repo, skipBuild, dryRun, target, prefix, outDir } = parseArgs(process.argv.slice(2));
const PAGES_PROJECT = process.env.PAGES_PROJECT ?? 'demand-studio';

if (!skipBuild) {
  console.log('1/4 构建三个产物…');
  run('pnpm', ['run', 'build:h5']);
  // 演示模式：接口改用浏览器内的实现，这样纯静态托管也能点开
  const studioBase = `${prefix}/studio`;
  const onsiteBase = `${prefix}/onsite`;
  console.log(`  路径前缀：${prefix || '（根目录）'}`);
  run('pnpm', ['--dir', 'studio', 'run', 'build'], {
    NEXT_PUBLIC_DEMO: '1',
    EXPORT_BASE_PATH: studioBase,
    EXPORT_DIST_DIR: '.next-export',
  });
  run('pnpm', ['--dir', 'onsite', 'run', 'build'], {
    VITE_DEMO: '1',
    EXPORT_BASE_PATH: onsiteBase,
  });
} else {
  console.log('1/4 跳过构建，复用现有产物');
}

for (const target of TARGETS) {
  const entry = path.join(target.from, 'index.html');
  if (!fs.existsSync(entry)) {
    console.error(`找不到产物：${entry}（${target.name}）`);
    process.exit(1);
  }
}

// Cloudflare Pages 用固定目录（方便重复发布与排查），GitHub Pages 用临时目录
const workDir = target === 'pages'
  ? path.resolve(PROJECT_ROOT, outDir || '_deploy')
  : fs.mkdtempSync(path.join(os.tmpdir(), 'zx-pages-'));
if (target === 'pages') fs.rmSync(workDir, { recursive: true, force: true });
console.log(`2/4 组装发布目录：${workDir}`);
TARGETS.forEach((target) => {
  const dest = target.to ? path.join(workDir, target.to) : workDir;
  copyDir(target.from, dest);
  console.log(`  ${target.to || '/'} ← ${target.from.replace(PROJECT_ROOT + path.sep, '')}`);
});
// GitHub Pages 默认走 Jekyll，会把 _next/ 这类下划线开头的目录丢掉
fs.writeFileSync(path.join(workDir, '.nojekyll'), '');

if (dryRun) {
  console.log(['--dry-run：只组装不推送。发布目录：', workDir].join(' '));
  process.exit(0);
}

/* Cloudflare Pages：wrangler 直接发布目录，不走 git 分支 */
if (target === 'pages') {
  console.log('3/4 发布到 Cloudflare Pages…');
  const result = spawnSync(
    'npx',
    ['--yes', 'wrangler@latest', 'pages', 'deploy', workDir, '--project-name', PAGES_PROJECT, '--branch', 'main'],
    // 必须在产物目录里跑：仓库根是 pnpm 工作区，wrangler 会误判成 Workers 项目
    { cwd: workDir, stdio: 'inherit', shell: true },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log('\n发布完成。');
  console.log(`站点：https://${PAGES_PROJECT}.pages.dev/`);
  console.log(`  桌面工作台：https://${PAGES_PROJECT}.pages.dev/studio/`);
  console.log(`  现场端：https://${PAGES_PROJECT}.pages.dev/onsite/`);
  process.exit(0);
}

const name = git(['config', 'user.name'], { cwd: PROJECT_ROOT }) || 'deploy-bot';
const email = git(['config', 'user.email'], { cwd: PROJECT_ROOT }) || 'deploy-bot@example.com';
const commitOptions = { cwd: workDir };

console.log('3/4 生成 gh-pages 提交…');
git(['init', '-q', '-b', 'gh-pages'], commitOptions);
git(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'add', '-A'], commitOptions);
git(
  ['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', 'deploy: 采集端 + 桌面工作台 + 现场端'],
  commitOptions,
);
git(['remote', 'add', 'origin', repo], commitOptions);

console.log(`4/4 推送到 ${repo} 的 gh-pages 分支…`);
git(['push', '--force', 'origin', 'gh-pages'], { cwd: workDir, stdio: 'inherit' });

const url = pagesUrl(repo) ?? '';
console.log('\n发布完成。');
console.log(`仓库：${repo.replace(/\.git$/, '')}`);
if (url) {
  console.log(`采集端：${url}`);
  console.log(`桌面工作台：${url}studio/`);
  console.log(`现场端：${url}onsite/`);
  console.log('首次需要在仓库 Settings → Pages 把 Source 设为 gh-pages 分支（根目录），构建约 1 分钟。');
}
fs.rmSync(workDir, { recursive: true, force: true });
