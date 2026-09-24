/** 环境变量都在这里读，密钥不进仓库、不进前端（技术方案 7.1）。 */

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export interface ApiEnv {
  port: number;
  /** SQLite 数据文件；接 Postgres 时换掉 db 适配器，这一项随之消失 */
  dbPath: string;
  /** 自签 token 的密钥 */
  tokenSecret: string;
  tokenTtlSeconds: number;
  /** 采集通道的匿名会话：另一把钥匙，与内部 token 互不通用（技术方案 5.3） */
  collectionSecret: string;
  collectionSessionTtlSeconds: number;
  /** 公司内部账号的验证码；V1 由管理员统一下发，待定项见技术方案第十章 */
  authCode: string;
  /** fake：不调模型，用桩数据跑通流程；deepseek：官方 API */
  model: 'fake' | 'deepseek';
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekModel: string;
  /** 部署形态：官方接口或私有化部署，两者 API 形态一致 */
  modelEndpoint: 'official' | 'private';
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): ApiEnv {
  return {
    port: num(source.PORT, 8787),
    dbPath: source.DB_PATH ?? 'services/api/.data/api.sqlite',
    tokenSecret: source.TOKEN_SECRET ?? 'dev-only-secret',
    tokenTtlSeconds: num(source.TOKEN_TTL_SECONDS, 12 * 3600),
    collectionSecret: source.COLLECTION_SECRET ?? 'dev-only-collection-secret',
    collectionSessionTtlSeconds: num(source.COLLECTION_SESSION_TTL_SECONDS, 24 * 3600),
    authCode: source.AUTH_CODE ?? '000000',
    model: source.MODEL_PROVIDER === 'deepseek' ? 'deepseek' : 'fake',
    deepseekApiKey: source.DEEPSEEK_API_KEY ?? '',
    deepseekBaseUrl: source.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    deepseekModel: source.DEEPSEEK_MODEL ?? 'deepseek-chat',
    modelEndpoint: source.MODEL_ENDPOINT === 'private' ? 'private' : 'official',
  };
}
