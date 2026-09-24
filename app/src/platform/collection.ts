/**
 * 采集通道接线（技术方案 5.3）：构建时给了地址就真的上报，没给就是展示模式（提交只落本机）。
 *
 * 网络那层用 `Taro.request`：小程序端没有 `fetch`，H5 端同一个 API 走 XHR，两端一条路。
 */

import Taro from '@tarojs/taro';
import { createCollectionClient } from '@zx/data';
import type { DemandSubmitter, JsonTransport } from '@zx/data';

/** 构建时注入（见 `config/index.ts` 的 defineConstants）：空串＝展示模式 */
const BASE = process.env.COLLECTION_API_BASE ?? '';

export const isCollectionConfigured = BASE !== '';

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
  : null;
