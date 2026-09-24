/**
 * 存储驱动：一个极小的异步接口，仓储层只认它（技术方案 3.1 的分层纪律）。
 *
 * 为什么定在异步一侧：部署形态是 Cloudflare Workers + D1，而 D1 **只有异步 API**；
 * 本地、测试与容器里用的 `node:sqlite` 是同步的。接口定成异步，两种实现都满足
 * （同步实现返回的就是已经 resolve 的值），仓储层因此不用为「换存储」改一遍签名。
 *
 * 只有三个方法：能查多行、能查一行、能写。事务与批量交给各自的实现去做——这一版的
 * 数据量小，且写入都是单条（技术方案 6.12 的取舍：先不落汇总表，也不提前上事务编排）。
 */

export interface Db {
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  get<T>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  run(sql: string, ...params: unknown[]): Promise<void>;
}

/** `undefined` 不是合法的绑定值（node:sqlite 会抛，D1 也会），统一归一成 null。 */
export const bindParams = (params: unknown[]): unknown[] =>
  params.map((p) => (p === undefined ? null : p));
