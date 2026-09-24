/**
 * 两条通道各一套自签 token（技术方案 4.2 与 5.3）。
 *
 * 内部通道按角色控制权限；房主不是用户，采集端走匿名会话。两套令牌的密钥与 scope 都不同，
 * 互相拿到也调不通对面的接口——这是结构性隔离，不靠中间件里的路径判断。
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Role, User } from '@zx/contracts';

/** 内部 token：一名公司内部人员的身份与角色。 */
export interface InternalTokenPayload {
  sub: string;
  scope: 'internal';
  role: Role;
  exp: number;
}

/** 采集会话令牌：只代表「一个匿名的房主会话」，不带任何身份与角色。 */
export interface CollectionTokenPayload {
  sub: string;
  scope: 'collection';
  exp: number;
}

export type TokenPayload = InternalTokenPayload | CollectionTokenPayload;

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

/** 校验令牌：签名、有效期、scope 三者都要对，缺一样就当作没有令牌。 */
export function verifyToken(
  token: string,
  secret: string,
  scope: TokenPayload['scope'],
  now = Date.now(),
): TokenPayload | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = signature(body, secret);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(fromB64url(body).toString('utf8')) as TokenPayload;
    if (payload.scope !== scope) return null;
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
  'omission:write': ['admin', 'designer'],
  'audit:read': ['admin', 'designer'],
  'account:manage': ['admin'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(user: User, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(user.role);
}
