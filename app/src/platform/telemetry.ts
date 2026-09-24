/**
 * 采集端埋点（产品文档第十章、技术方案 6.11）。
 *
 * 事件名与每个事件带什么字段，清单在 `@zx/data` 的 `events.ts`——这里只负责在正确的时机调它。
 * 采集端目前还不能上报：房主那条采集通道（A4）还没开，事件先跟着草稿落在本机。
 */

import { trackEvent } from '../store';
import { WIDE_BREAKPOINT, isH5 } from './env';

let sessionTracked = false;

/**
 * 一次会话记一次：填写时长、装机率、静默触发率三个指标的分母都从这里来。
 * 手机上打开的会话带 `narrow`，装机率只算这一批（装到主屏幕的是手机版）。
 */
export function trackSession(): void {
  if (sessionTracked) return;
  sessionTracked = true;
  const narrow = typeof window === 'undefined' ? true : window.innerWidth < WIDE_BREAKPOINT;
  trackEvent('session', { env: process.env.TARO_ENV, narrow });
}

/**
 * 手机版被加到主屏幕：装机率的分子。只有 H5 有 `appinstalled`，小程序端不会触发。
 * 返回清理函数，交给调用方的 effect 收尾。
 */
export function watchInstall(): () => void {
  if (!isH5 || typeof window === 'undefined') return () => {};
  const onInstall = () => trackEvent('install', {});
  window.addEventListener('appinstalled', onInstall);
  return () => window.removeEventListener('appinstalled', onInstall);
}
