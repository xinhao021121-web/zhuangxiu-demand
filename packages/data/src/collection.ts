/**
 * 采集通道（技术方案 5.3）：把草稿拼成结构化需求单，交给服务端那条只写的通道。
 *
 * 这一层不做业务判断，也不认识任何平台的网络 API：草稿怎么变成需求单是纯函数，
 * 发请求的那个 `transport` 由调用方注入（采集端注 `Taro.request`，测试注一个桩）。
 */

import type { DemandSheetSubmission, DemandSubmitter, Draft, TrackEvent, SubmitOutcome } from './types';
import { DEMAND_SCHEMA_VERSION } from './types';

/** 平台无关的一次 JSON 请求：采集端注 `Taro.request`（小程序没有 fetch），测试注一个桩。 */
export interface JsonRequest {
  url: string;
  method: 'GET' | 'POST';
  /** 采集通道的会话令牌，带在 Authorization 上 */
  token?: string;
  body?: unknown;
}

export type JsonTransport = (request: JsonRequest) => Promise<{ status: number; body: unknown }>;

/**
 * 提交 id：弱网重试的幂等键，服务端拿它当需求单 id。
 *
 * 小程序端没有 `crypto.randomUUID`，所以自己拼一个：时间戳 + 随机数，冲突概率足够低，
 * 而且一眼能看出是客户端生成的（与种子数据的 d1/d2 不撞）。
 */
export function newSubmissionId(at: number, rand: () => number = Math.random): string {
  return `a-${at.toString(36)}-${Math.floor(rand() * 0x100000000).toString(36)}`;
}

/**
 * 草稿 → 结构化需求单。传的是表单、助手写入过的字段与版本号，不传摘要文本：
 * 摘要给人看，需求单给系统读，两者不能混成一份东西。
 */
export function buildSubmission(
  draft: Draft,
  options: { submissionId: string; submittedAt: string },
): DemandSheetSubmission {
  return {
    submissionId: options.submissionId,
    schemaVersion: DEMAND_SCHEMA_VERSION,
    submittedAt: options.submittedAt,
    source: 'miniapp',
    form: { values: draft.model.values, instances: draft.model.instances },
    aiMarks: Object.keys(draft.aiMarks),
  };
}

/**
 * 交接文件：房主手机把这份需求单存下来、通过任何渠道（微信、邮件、当面）交给设计师的那一份。
 *
 * 内容与提交给采集通道的是**同一份结构**，只是换了一种递送方式——设计师那边选文件导入，
 * 服务端仍然记 `source: 'file'`。文件名带日期，同一份表反复导也不会互相盖掉。
 */
export function buildHandoff(sheet: DemandSheetSubmission): { fileName: string; text: string } {
  const day = sheet.submittedAt.slice(0, 10).replace(/-/g, '');
  return {
    fileName: `问需-需求单-${/^\d{8}$/.test(day) ? day : '未标日期'}.json`,
    text: JSON.stringify(sheet, null, 2),
  };
}

export interface CollectionClientOptions {
  /** 采集通道的地址，例如 https://api.example.com/a */
  baseUrl: string;
  transport: JsonTransport;
  now?: () => number;
}

/**
 * 采集通道客户端：换一次匿名会话，然后提交。
 *
 * 失败重试一次，带的是同一个 `submissionId`——第一次可能已经到了服务端、只是回执没回来，
 * 服务端据此认出是同一份，所以「房主点一次、网抖了一下」不会变成两份需求单。
 * 4xx 不重试：请求本身不对，重发一遍结果一样。
 */
export function createCollectionClient(options: CollectionClientOptions): DemandSubmitter {
  const base = options.baseUrl.replace(/\/+$/, '');
  const now = options.now ?? Date.now;
  let session: { token: string; expiresAt: number } | null = null;

  async function openSession(): Promise<string> {
    const res = await options.transport({ url: `${base}/session`, method: 'POST' });
    const body = (res.body ?? {}) as { token?: string; expiresAt?: string; error?: string };
    if (res.status !== 200 || !body.token) throw new Error(body.error ?? '取不到会话');
    // 到期前 60 秒就当作过期，免得正好卡在边界上
    session = { token: body.token, expiresAt: Date.parse(body.expiresAt ?? '') - 60_000 };
    return body.token;
  }

  async function token(): Promise<string> {
    if (session && session.expiresAt > now()) return session.token;
    return openSession();
  }

  return {
    async submit(sheet, events) {
      const payload = {
        ...sheet,
        telemetry: events.length ? { batchId: sheet.submissionId, events } : undefined,
      };
      let reason = '提交失败';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const res = await options.transport({
            url: `${base}/demand-sheets`,
            method: 'POST',
            token: await token(),
            body: payload,
          });
          const body = (res.body ?? {}) as {
            id?: string;
            replay?: boolean;
            acceptedEvents?: number;
            error?: string;
          };
          if (res.status === 200 || res.status === 201) {
            return { id: body.id ?? '', replay: body.replay === true, acceptedEvents: body.acceptedEvents ?? 0 };
          }
          reason = body.error ?? `提交失败（${res.status}）`;
          // 会话过期：丢掉它，下一轮换一个新的再来一次
          if (res.status === 401) {
            session = null;
            continue;
          }
          // 其余 4xx 是请求本身不对，重发一遍结果一样
          if (res.status < 500) break;
        } catch (error) {
          reason = error instanceof Error ? error.message : '网络不通';
        }
      }
      throw new Error(reason);
    },
  };
}

/**
 * 把一条提交器接进仓储：能提交就真的上报，没配通道（展示模式）就只回报「留在本机」。
 * 提交器自己会重试，所以这里不再重试，只把失败翻译成房主看得懂的一句话。
 */
export function toSubmitter(
  submitter: DemandSubmitter | null,
  now: () => number = Date.now,
): (sheet: DemandSheetSubmission, events: TrackEvent[]) => Promise<SubmitOutcome> {
  return async (sheet, events) => {
    const at = now();
    if (!submitter) return { ok: true, at, delivered: false };
    try {
      const receipt = await submitter.submit(sheet, events);
      return { ok: true, at, delivered: true, id: receipt.id };
    } catch (error) {
      return { ok: false, at, reason: error instanceof Error ? error.message : '提交失败' };
    }
  };
}
