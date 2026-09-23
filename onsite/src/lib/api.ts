/**
 * 现场端只跟自家服务端打交道：清单是服务端生成的，现场记录同步回服务端。
 *
 * 同一份界面代码要能跑两种后端：真实服务，或（纯静态托管时的）浏览器内演示服务。
 * 两者方法签名一致，靠 pick 在调用时分流。
 */

import type { LocalService } from '@zx/service';
import type { ChecklistSummaryView, DemandSheetSummary, SiteRecordContract, User } from '@zx/contracts';

const TOKEN_KEY = 'zx.onsite.token';

/** 演示模式：没有 API 服务时（GitHub Pages 这类纯静态托管）改用浏览器内的实现。 */
export const DEMO_MODE = import.meta.env.VITE_DEMO === '1';

/** 真实服务地址：静态托管时用 VITE_API_BASE 指到自己的 API。 */
const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 无痕模式下写不进去，忽略即可
  }
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
    throw new ApiError(response.status, body.error ?? `请求失败（${response.status}）`);
  }
  return (await response.json()) as T;
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
  sheets: () => request<DemandSheetSummary[]>('/demand-sheets'),
  summaryOf: (checklistId: string) => request<ChecklistSummaryView>(`/checklists/${checklistId}/summary`),
  pushRecords: (checklistId: string, records: SiteRecordContract[]) =>
    request<{ records: SiteRecordContract[] }>(`/checklists/${checklistId}/site-records`, {
      method: 'POST',
      body: JSON.stringify({ records }),
    }),
};

/** 界面只认这个方法集合：HTTP 封装与内存服务都要满足它。 */
export interface OnsiteApi {
  login(phone: string, code: string): Promise<{ token: string; user: User }>;
  sheets(): Promise<DemandSheetSummary[]>;
  summaryOf(checklistId: string): Promise<ChecklistSummaryView>;
  pushRecords(checklistId: string, records: SiteRecordContract[]): Promise<{ records: SiteRecordContract[] }>;
}

export const api: OnsiteApi = {
  login: pick((s, phone: string, code: string) => s.login(phone, code), httpApi.login),
  sheets: pick((s) => s.listSheets(), httpApi.sheets),
  summaryOf: pick((s, checklistId: string) => s.summary(checklistId), httpApi.summaryOf),
  pushRecords: pick(
    (s, checklistId: string, records: SiteRecordContract[]) => s.pushRecords(checklistId, records),
    httpApi.pushRecords,
  ),
};
