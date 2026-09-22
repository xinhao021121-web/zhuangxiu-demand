/**
 * 把 H5 产物发布到 GitHub Pages（gh-pages 分支，不需要 Actions 权限）。
 *
 * 用法：
 *   node tools/deploy-github-pages.mjs                 # 用 origin 作为目标仓库
 *   node tools/deploy-github-pages.mjs --repo https://github.com/<owner>/<repo>.git
 *   node tools/deploy-github-pages.mjs --skip-build    # 复用已有产物
 *
 * 做法：先构建 app/dist/h5，再把它的内容作为一个孤立提交推到远端 gh-pages 分支；
 * 仓库的 Settings → Pages 里把 Source 设为 gh-pages 分支根目录即可（脚本会打印地址）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = path.join(PROJECT_ROOT, 'app', 'dist', 'h5');

function git(args, options = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} 失败：${(result.stderr || result.stdout || '').trim()}`);
  }
  return (result.stdout || '').trim();
}

function parseArgs(argv) {
  const args = { repo: '', skipBuild: argv.includes('--skip-build') };
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

const { repo, skipBuild } = parseArgs(process.argv.slice(2));

if (!skipBuild) {
  console.log('1/4 构建 H5 产物…');
  const build = spawnSync('pnpm', ['run', 'build:h5'], { cwd: PROJECT_ROOT, stdio: 'inherit', shell: true });
  if (build.status !== 0) process.exit(build.status ?? 1);
} else {
  console.log('1/4 跳过构建，复用现有产物');
}

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`找不到产物：${path.join(DIST, 'index.html')}`);
  process.exit(1);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zx-pages-'));
console.log(`2/4 准备发布目录：${workDir}`);
copyDir(DIST, workDir);

const name = git(['config', 'user.name'], { cwd: PROJECT_ROOT }) || 'deploy-bot';
const email = git(['config', 'user.email'], { cwd: PROJECT_ROOT }) || 'deploy-bot@example.com';
const commitOptions = { cwd: workDir };

console.log('3/4 生成 gh-pages 提交…');
git(['init', '-q', '-b', 'gh-pages'], commitOptions);
git(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'add', '-A'], commitOptions);
git(
  ['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', 'deploy: 更新 H5 产物（宽屏 Web / 窄屏展示版）'],
  commitOptions,
);
git(['remote', 'add', 'origin', repo], commitOptions);

console.log(`4/4 推送到 ${repo} 的 gh-pages 分支…`);
git(['push', '--force', 'origin', 'gh-pages'], { cwd: workDir, stdio: 'inherit' });

const url = pagesUrl(repo);
console.log('\n发布完成。');
console.log(`仓库：${repo.replace(/\.git$/, '')}`);
if (url) {
  console.log(`站点：${url}`);
  console.log('首次需要在仓库 Settings → Pages 把 Source 设为 gh-pages 分支（根目录），构建约 1 分钟。');
}
fs.rmSync(workDir, { recursive: true, force: true });
