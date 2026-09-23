'use client';

/**
 * 桌面端只跟自家服务端打交道：模型密钥与脱敏都在服务端（技术方案 2.4）。
 * token 存在本机，路径走 Next 的 /api 代理，省掉 CORS。
 */

import type {
  ChecklistView,
  DemandSheetDetail,
  DemandSheetSummary,
  OutboundRecordContract,
  User,
} from '@zx/contracts';

const TOKEN_KEY = 'zx.studio.token';

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
    if (response.status === 401) setToken(null);
    throw new ApiError(response.status, body.error ?? `请求失败（${response.status}）`);
  }
  const type = response.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? await response.json() : await response.text()) as T;
}


export const api = {
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
