/**
 * 无头浏览器启动：本机自带内核可能因缺少运行库或版本不一致启动失败，
 * 因此逐个尝试已存在的内核，最后回落到系统 Chrome / Edge。
 * 也可以用 PLAYWRIGHT_CHROMIUM 手动指定内核路径。
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const exeCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM,
  path.join(process.env.USERPROFILE || '', 'AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'),
  path.join(
    process.env.USERPROFILE || '',
    'AppData/Local/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-win64/chrome-headless-shell.exe',
  ),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

export async function launchBrowser() {
  const available = exeCandidates.filter((p) => fs.existsSync(p));
  const errors = [];
  for (const candidate of available) {
    try {
      return await chromium.launch({ executablePath: candidate });
    } catch (e) {
      errors.push(candidate + '：' + String(e.message).split('\n')[0]);
    }
  }
  try {
    return await chromium.launch();
  } catch (e) {
    errors.push(String(e.message).split('\n')[0]);
  }
  throw new Error('没有可用的浏览器内核：\n' + errors.join('\n'));
}
