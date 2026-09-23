/**
 * 公司内部账号：自签 token，访问权限按角色控制（技术方案 4.2）。
 *
 * 房主不是用户——采集端走匿名会话，不进入账号体系。
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Role, User } from '@zx/contracts';

export interface TokenPayload {
  sub: string;
  role: Role;
  exp: number;
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const fromB64url = (input: string) => Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function signature(body: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(body).digest());
}

export function signToken(payload: TokenPayload, secret: string): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${signature(body, secret)}`;
}

export function verifyToken(token: string, secret: string, now = Date.now()): TokenPayload | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = signature(body, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8')) as TokenPayload;
    if (!payload.exp || payload.exp * 1000 <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

/** 角色能做什么：设计师可导入、生成、导出；管理员另外管账号与字段清单版本。 */
export const PERMISSIONS = {
  'demand-sheet:write': ['admin', 'designer'],
  'checklist:generate': ['admin', 'designer'],
  'checklist:export': ['admin', 'designer'],
  'site-record:write': ['admin', 'designer'],
  'audit:read': ['admin', 'designer'],
  'account:manage': ['admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(user: User, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(user.role);
}
