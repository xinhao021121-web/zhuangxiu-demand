/** 账号与角色：单组织，没有租户表，只有用户与角色（技术方案 4.2）。 */

import { z } from 'zod';

export const RoleSchema = z.enum(['admin', 'designer']);

export const UserSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  /** 手机号验证码或企业微信扫码接进来，V1 先按手机号识别 */
  phone: z.string().min(1),
  role: RoleSchema,
  /** 将来按门店或分部划分时用它，不必引入租户体系 */
  teamId: z.string().nullable().default(null),
});

export const UserCreateSchema = UserSchema.extend({ id: z.string().optional() });

export const LoginSchema = z.object({
  phone: z.string().min(1),
  /** 公司内部工具：V1 的验证码由服务端下发并校验，测试里直接给固定码 */
  code: z.string().min(1),
});

export type Role = z.infer<typeof RoleSchema>;
export type UserCreate = z.infer<typeof UserCreateSchema>;
export type User = z.infer<typeof UserSchema>;
