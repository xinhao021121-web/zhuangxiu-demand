/**
 * 契约优先（技术方案 4.1）：同一份 zod schema 产生运行时校验、TypeScript 类型与 OpenAPI。
 *
 * 三个客户端不各自维护类型，契约变更由编译与测试兜住。
 */

import { z } from 'zod';
import { LoginSchema, UserSchema } from './account';
import { ChecklistItemSchema, ChecklistSchema } from './checklist';
import { CollectionSessionSchema, CollectionSubmitSchema } from './collection';
import { DemandSheetImportSchema } from './demand-sheet';
import { OutboundRecordSchema, SiteRecordBatchSchema, SiteRecordSchema } from './outbound';
import { EventBatchSchema, StoredEventSchema } from './telemetry';
import { UnderstandingSchema } from './understanding';

const SCHEMAS = {
  User: UserSchema,
  Login: LoginSchema,
  DemandSheetImport: DemandSheetImportSchema,
  CollectionSession: CollectionSessionSchema,
  CollectionSubmit: CollectionSubmitSchema,
  Understanding: UnderstandingSchema,
  Checklist: ChecklistSchema,
  ChecklistItem: ChecklistItemSchema,
  OutboundRecord: OutboundRecordSchema,
  SiteRecord: SiteRecordSchema,
  SiteRecordBatch: SiteRecordBatchSchema,
  EventBatch: EventBatchSchema,
  StoredEvent: StoredEventSchema,
};

const ref = (name: keyof typeof SCHEMAS) => ({ $ref: `#/components/schemas/${name}` });
const json = (name: keyof typeof SCHEMAS, description: string) => ({
  description,
  content: { 'application/json': { schema: ref(name) } },
});
const jsonArray = (name: keyof typeof SCHEMAS, description: string) => ({
  description,
  content: { 'application/json': { schema: { type: 'array', items: ref(name) } } },
});
const body = (name: keyof typeof SCHEMAS, description: string) => ({
  required: true,
  description,
  content: { 'application/json': { schema: ref(name) } },
});
const path = (id: string) => ({ name: 'id', in: 'path', required: true, schema: { type: 'string' } });

/** V1 的接口清单：桌面工作台与现场端都用这一组。 */
export const API_PATHS = {
  /*
   * 采集通道（技术方案 5.3）：独立前缀、独立鉴权、只有这两个写入口。
   * 列在这里是因为「文档和实现不能两份」——但它是给房主用的，不接内部 token。
   */
  '/a/session': {
    post: {
      summary: '采集端：换一个匿名会话令牌（房主不是用户，不进账号体系）',
      responses: { '200': json('CollectionSession', '会话令牌与到期时间') },
    },
  },
  '/a/demand-sheets': {
    post: {
      summary: '采集端：提交结构化需求单（唯一写入口，落库即 source: miniapp）',
      requestBody: body('DemandSheetImport', '采集端导出的需求单，可带一批埋点'),
      responses: {
        '201': json('CollectionSubmit', '提交回执；重试时 replay 为 true，不会再落一份'),
      },
    },
  },
  '/auth/login': {
    post: {
      summary: '登录：手机号验证码换 token',
      requestBody: body('Login', '手机号与验证码'),
      responses: { '200': json('Login', 'token 与当前用户') },
    },
  },
  '/demand-sheets': {
    get: {
      summary: '需求单列表',
      responses: { '200': jsonArray('DemandSheetImport', '本地保存的需求单，含提交时间与完成度') },
    },
    post: {
      summary: '导入需求单（采集端结构化导出的 JSON）',
      requestBody: body('DemandSheetImport', '需求单导入体'),
      responses: { '201': json('DemandSheetImport', '已落库的需求单') },
    },
  },
  '/demand-sheets/{id}': {
    get: {
      summary: '需求单详情：原始表格 + 表外信息',
      parameters: [path('id')],
      responses: { '200': json('DemandSheetImport', '需求单') },
    },
  },
  '/demand-sheets/{id}/checklist': {
    get: {
      summary: '取已生成的量房沟通清单',
      parameters: [path('id')],
      responses: { '200': json('Checklist', '清单；未生成时 404') },
    },
    post: {
      summary: '生成清单：先脱敏、写外发记录，再调用模型',
      parameters: [path('id')],
      requestBody: body('OutboundRecord', '本次逐条确认的结果（字段键 → 是否外发）'),
      responses: { '201': json('Checklist', '清单；模型失败时降级为纯规则清单') },
    },
  },
  '/demand-sheets/{id}/outbound-records': {
    get: {
      summary: '外发记录：谁、什么时候、发了什么、用的哪版策略',
      parameters: [path('id')],
      responses: { '200': jsonArray('OutboundRecord', '外发记录') },
    },
  },
  '/demand-sheets/{id}/events': {
    get: {
      summary: '取这份需求单的埋点事件（指标就是拿它算的）',
      parameters: [path('id')],
      responses: { '200': jsonArray('StoredEvent', '按时间排序的事件') },
    },
    post: {
      summary: '上报埋点（整批上报，同一 batchId 只落一次）',
      parameters: [path('id')],
      requestBody: body('EventBatch', '一批埋点事件'),
      responses: {
        '201': {
          description: '接收到的条数与因重复跳过的条数',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { accepted: { type: 'integer' }, duplicates: { type: 'integer' } },
              },
            },
          },
        },
      },
    },
  },
  '/checklists/{id}/items/{key}': {
    patch: {
      summary: '删减或撤销一条清单项，动作逐条记录',
      parameters: [path('id'), { name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': json('ChecklistItem', '更新后的条目') },
    },
  },
  '/checklists/{id}/site-records': {
    get: {
      summary: '现场记录',
      parameters: [path('id')],
      responses: { '200': jsonArray('SiteRecord', '现场记录') },
    },
    post: {
      summary: '现场记录批量同步（离线先存本机，回到有网再发）',
      parameters: [path('id')],
      requestBody: body('SiteRecordBatch', '离线期间攒下的记录'),
      responses: { '201': jsonArray('SiteRecord', '已接收的记录') },
    },
  },
} as const;

export function openApiDocument(info: { title: string; version: string } = {
  title: '设计需求解读台 API',
  version: '1.0.0',
}) {
  const schemas: Record<string, unknown> = {};
  Object.entries(SCHEMAS).forEach(([name, schema]) => {
    schemas[name] = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  });
  return {
    openapi: '3.1.0',
    info,
    paths: API_PATHS,
    components: { schemas },
  };
}
