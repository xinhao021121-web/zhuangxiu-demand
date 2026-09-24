/** 客户端时钟（毫秒）换算成落库时间：房主手机的时钟可能不准，明显不合法时用服务端时间兜住。 */

/**
 * 填写时长这类跨事件差值要在同一个时钟下算，所以换算只做一次，落库后不再依赖客户端时钟。
 * 内部通道（文件导入时随需求单带进来的埋点）与采集通道都用这一条。
 */
export function toIsoAt(clientMs: number, fallback: string): string {
  if (!Number.isFinite(clientMs)) return fallback;
  const at = new Date(clientMs);
  return Number.isNaN(at.getTime()) ? fallback : at.toISOString();
}
