'use client';

/**
 * 桌面端只跟自家服务端打交道：模型密钥与脱敏都在服务端（技术方案 2.4）。
 * token 存在本机，路径走 Next 的 /api 代理，省掉 CORS。
 *
 * 同一份界面代码要能跑两种后端：真实服务，或（纯静态托管时的）浏览器内演示服务。
 * 两者方法签名一致，靠 pick 在调用时分流。
 */

import type { LocalService } from '@zx/service';
import type {
  ChecklistView,
  DemandSheetDetail,
  DemandSheetSummary,
  OutboundRecordContract,
  User,
} from '@zx/contracts';

const TOKEN_KEY = 'zx.studio.token';

/** 演示模式：没有 API 服务时（GitHub Pages 这类纯静态托管）改用浏览器内的实现。 */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO === '1';

/** 真实服务地址：静态托管时用 NEXT_PUBLIC_API_BASE 指到自己的 API。 */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.status === 401) setToken(null);
    throw new ApiError(response.status, body.error ?? `请求失败（${response.status}）`);
  }
  const type = response.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? await response.json() : await response.text()) as T;
}

/** 演示实现走动态导入：真实产物里不会带上演示数据与内存实现。 */
let localPromise: Promise<LocalService> | null = null;
const getLocal = () => (localPromise ??= import('./demo').then((m) => m.createDemoService()));

async function viaLocal<T>(run: (service: LocalService) => Promise<T>): Promise<T> {
  try {
    return await run(await getLocal());
  } catch (error) {
    const status = (error as { status?: number }).status ?? 400;
    throw new ApiError(status, error instanceof Error ? error.message : '演示模式出错');
  }
}

/** 同一件事两种实现，调用时按 DEMO_MODE 分流。 */
function pick<A extends unknown[], T>(
  useLocal: (service: LocalService, ...args: A) => Promise<T>,
  useHttp: (...args: A) => Promise<T>,
) {
  return (...args: A): Promise<T> => (DEMO_MODE ? viaLocal((s) => useLocal(s, ...args)) : useHttp(...args));
}

const httpApi = {
  login: (phone: string, code: string) =>
    request<{ token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, code }),
    }),
  listSheets: () => request<DemandSheetSummary[]>('/demand-sheets'),
  detail: (id: string) => request<DemandSheetDetail>(`/demand-sheets/${id}`),
  generate: (id: string, selected: Record<string, boolean>) =>
    request<ChecklistView>(`/demand-sheets/${id}/checklist`, {
      method: 'POST',
      body: JSON.stringify({ selected }),
    }),
  checklist: (id: string) => request<ChecklistView>(`/checklists/${id}`),
  setItemRemoved: (checklistId: string, key: string, removed: boolean) =>
    request<{ key: string; removed: boolean }>(
      `/checklists/${checklistId}/items/${encodeURIComponent(key)}`,
      { method: 'PATCH', body: JSON.stringify({ removed }) },
    ),
  outboundRecords: (id: string) => request<OutboundRecordContract[]>(`/demand-sheets/${id}/outbound-records`),
};

/** 界面只认这个接口：HTTP 封装与内存服务都必须满足它（签名漂了会在编译期报出来）。 */
export interface StudioApi {
  login(phone: string, code: string): Promise<{ token: string; user: User }>;
  listSheets(): Promise<DemandSheetSummary[]>;
  detail(id: string): Promise<DemandSheetDetail>;
  generate(id: string, selected: Record<string, boolean>): Promise<ChecklistView>;
  checklist(id: string): Promise<ChecklistView>;
  setItemRemoved(checklistId: string, key: string, removed: boolean): Promise<{ key: string; removed: boolean }>;
  outboundRecords(id: string): Promise<OutboundRecordContract[]>;
}

export const api: StudioApi = {
  login: pick((s, phone: string, code: string) => s.login(phone, code), httpApi.login),
  listSheets: pick((s) => s.listSheets(), httpApi.listSheets),
  detail: pick((s, id: string) => s.detail(id), httpApi.detail),
  generate: pick((s, id: string, selected: Record<string, boolean>) => s.generate(id, selected), httpApi.generate),
  checklist: pick((s, id: string) => s.checklist(id), httpApi.checklist),
  setItemRemoved: pick(
    (s, checklistId: string, key: string, removed: boolean) => s.setItemRemoved(checklistId, key, removed),
    httpApi.setItemRemoved,
  ),
  outboundRecords: pick((s, id: string) => s.outboundRecords(id), httpApi.outboundRecords),
};
