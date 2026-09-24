/**
 * 上线前置的两道门（技术方案 5.3 的「上线前置」）：CORS 白名单与限流。
 *
 * 为什么要写进服务里：三个浏览端（采集端 H5、桌面工作台、现场端）都是从静态托管发跨域请求，
 * 而采集通道是**匿名的公开写入口**——它没有任何读接口，但仍然会被人当成免费写入口刷。
 * 放在这里，本机、容器与私有化部署行为一致，不依赖某一家托管平台的配置项。
 *
 * 两条边界写死：
 *   1. **白名单，不是通配。** 没配 `CORS_ALLOWED_ORIGINS` 时只认本机开发的三个端口；
 *      来源不在名单里直接 403，而不是「只加头不拦」——后者会把失败推迟到浏览器里变成一句玄学错误。
 *   2. **限流的键不被客户端伪造。** 默认用连接的远端地址；只有服务真的挂在反向代理后面
 *      （`TRUST_PROXY=1`）才认 `X-Forwarded-For`，否则客户端自己写这个头就能绕过限额。
 */

import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import type { ApiEnv } from './env';

/** 这条 API 只有 JSON 请求体与 Bearer 令牌，不给别的方法与请求头开口子。 */
const ALLOW_METHODS = 'GET,POST,PATCH,OPTIONS';
const ALLOW_HEADERS = 'authorization,content-type';
/** 预检结果缓存十分钟：白名单是静态配置，不需要每次请求都预检一遍 */
const PREFLIGHT_MAX_AGE = '600';

export function createCors(env: Pick<ApiEnv, 'corsAllowedOrigins'>): MiddlewareHandler {
  const allowed = new Set(env.corsAllowedOrigins);
  return async (c, next) => {
    const origin = c.req.header('origin');
    // 没有 Origin 的不是跨域请求（服务端到服务端、curl、健康检查）：放行，也不加任何 CORS 头
    if (!origin) return next();
    if (!allowed.has(origin)) return c.json({ error: '这个来源不在白名单里' }, 403);

    c.header('access-control-allow-origin', origin);
    // 同一个地址对不同来源会返回不同的头，缓存必须按 Origin 分开
    c.header('vary', 'origin');
    if (c.req.method === 'OPTIONS') {
      c.header('access-control-allow-methods', ALLOW_METHODS);
      c.header('access-control-allow-headers', ALLOW_HEADERS);
      c.header('access-control-max-age', PREFLIGHT_MAX_AGE);
      return c.body(null, 204);
    }
    await next();
  };
}

export interface RateLimitOptions {
  /** 窗口内允许的请求数 */
  limit: number;
  windowSeconds: number;
  trustProxy: boolean;
  /** 注入时钟，测试里好复现 */
  now?: () => number;
}

export function createRateLimit(options: RateLimitOptions): MiddlewareHandler {
  const { limit, windowSeconds, trustProxy } = options;
  const now = options.now ?? Date.now;
  const windowMs = windowSeconds * 1000;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return async (c, next) => {
    const key = clientKey(c, trustProxy);
    const at = now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= at) {
      // 顺手清掉过期的桶，否则 Map 会随来源数量一直长
      if (buckets.size > 1000) {
        buckets.forEach((b, k) => {
          if (b.resetAt <= at) buckets.delete(k);
        });
      }
      bucket = { count: 0, resetAt: at + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      c.header('retry-after', String(Math.max(1, Math.ceil((bucket.resetAt - at) / 1000))));
      return c.json({ error: '请求太频繁，稍后再试' }, 429);
    }
    await next();
  };
}

/**
 * 限流的键：默认是连接的远端地址（客户端改不了）。
 * 挂在反向代理后面时，远端地址永远是代理自己，所有房主会共用一个额度，
 * 所以要显式开 `TRUST_PROXY=1` 改用代理写进来的 `X-Forwarded-For` 第一段。
 */
function clientKey(c: Context, trustProxy: boolean): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (trustProxy && forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    // 单测（app.request 没有真实连接）与非 Node 适配器：退到反代那个头，都没有就用一个固定键
    return c.req.header('x-real-ip') ?? forwarded ?? 'local';
  }
}
