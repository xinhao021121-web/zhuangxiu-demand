/**
 * 采集通道接线（技术方案 5.3）：构建时给了地址就真的上报，没给就是展示模式。
 *
 * 网络那层用 `Taro.request`：小程序端没有 `fetch`，H5 端同一个 API 走 XHR，两端一条路。
 *
 * 展示模式在 H5 上不是「什么都没发生」：需求单会放进同源的一份收件箱
 * （`@zx/data` 的 `demo-inbox`），解读端一打开就收编——三个入口挂在同一个域名下，
 * 共用一份数据，刷新不丢。小程序端没有「同源」这回事，仍然是「只留本机 + 存交接文件」。
 */

import Taro from '@tarojs/taro';
import { createCollectionClient, createDemoInboxSubmitter } from '@zx/data';
import type { DemandSubmitter, JsonTransport, StorageAdapter } from '@zx/data';
import { isH5 } from './env';

/** 构建时注入（见 `config/index.ts` 的 defineConstants）：空串＝展示模式 */
const BASE = process.env.COLLECTION_API_BASE ?? '';

export const isCollectionConfigured = BASE !== '';

/**
 * 展示模式用的落点：直接用 `window.localStorage`，不走 Taro 那一层——
 * 解读端与现场端读的是同一个键，两边必须是同一种写法。
 */
function browserStorage(): StorageAdapter | null {
  try {
    if (!isH5 || typeof window === 'undefined') return null;
    const storage = window.localStorage;
    const probe = 'zx.demo.probe';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

const sharedInbox = isCollectionConfigured ? null : browserStorage();

/** 演示模式下需求单去了哪：同源收件箱（解读端会收编），还是哪也去不了。 */
export const isDemoInboxShared = sharedInbox !== null;

const taroTransport: JsonTransport = async ({ url, method, token, body }) => {
  const res = await Taro.request({
    url,
    method,
    header: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    data: body as Record<string, unknown>,
    dataType: 'json',
  });
  return { status: res.statusCode, body: res.data };
};

/** 挂在仓储上的提交实现：null 表示没接通道，仓储只回报「留在本机」。 */
export const collectionChannel: DemandSubmitter | null = isCollectionConfigured
  ? createCollectionClient({ baseUrl: BASE, transport: taroTransport })
  : sharedInbox
    ? createDemoInboxSubmitter(sharedInbox)
    : null;
