/**
 * 现场端只跟自家服务端打交道：清单是服务端生成的，现场记录同步回服务端。
 * 请求失败不抛给界面，交给调用方决定是「先存本机」还是「提示一下」。
 */

import type { ChecklistSummaryView, DemandSheetSummary, SiteRecordContract, User } from '@zx/contracts';

const TOKEN_KEY = 'zx.onsite.token';

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
  const response = await fetch(`/api${path}`, {
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



export const api = {
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
