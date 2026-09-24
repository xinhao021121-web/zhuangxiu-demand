/** 环境变量都在这里读，密钥不进仓库、不进前端（技术方案 7.1）。 */

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const list = (v: string | undefined) =>
  v
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** 本机开发默认放开的来源：H5 预览、桌面工作台、现场端（常用命令里的三个端口）。 */
const LOCAL_ORIGINS = [
  'http://127.0.0.1:4173',
  'http://localhost:4173',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'http://127.0.0.1:5174',
  'http://localhost:5174',
];

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
  /** CORS 白名单：逗号分隔的来源，不支持通配；不配就是本机那三个端口（技术方案 5.3 的上线前置） */
  corsAllowedOrigins: string[];
  /** 采集通道的限流：同一来源在一个窗口里允许的请求数 */
  collectionRateLimit: number;
  collectionRateWindowSeconds: number;
  /** 服务挂在反向代理后面：限流用 X-Forwarded-For 当客户端地址；直连时保持关闭，那个头可以伪造 */
  trustProxy: boolean;
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
    corsAllowedOrigins: list(source.CORS_ALLOWED_ORIGINS) ?? LOCAL_ORIGINS,
    collectionRateLimit: num(source.COLLECTION_RATE_LIMIT, 20),
    collectionRateWindowSeconds: num(source.COLLECTION_RATE_WINDOW_SECONDS, 60),
    trustProxy: source.TRUST_PROXY === '1',
    model: source.MODEL_PROVIDER === 'deepseek' ? 'deepseek' : 'fake',
    deepseekApiKey: source.DEEPSEEK_API_KEY ?? '',
    deepseekBaseUrl: source.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    deepseekModel: source.DEEPSEEK_MODEL ?? 'deepseek-chat',
    modelEndpoint: source.MODEL_ENDPOINT === 'private' ? 'private' : 'official',
  };
}
