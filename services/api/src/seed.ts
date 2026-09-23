/** 种子数据：三个场景与两个账号，让刚起服务的这一版能直接跑完一条完整流程。 */

import users from '../seed/users.json';
import sheets from '../seed/demand-sheets.json';
import type { Repo } from './repo';

interface SeedUser {
  id: string;
  name: string;
  phone: string;
  role: 'admin' | 'designer';
}

interface SeedSheet {
  id: string;
  demandName: string;
  schemaVersion: string;
  submittedAt: string;
  source: string;
  aiMarks: string[];
  form: { values: Record<string, unknown>; instances: Record<string, unknown[]> };
}

export const SEED_USERS = users as unknown as SeedUser[];

/** 只在空库时灌种子，重复启动不会灌两遍。 */
export function seedDatabase(repo: Repo): boolean {
  if (repo.listDemandSheets().length > 0) return false;
  SEED_USERS.forEach((u) => repo.createUser(u));
  (sheets as unknown as SeedSheet[]).forEach((s) => {
    repo.createDemandSheet({
      id: s.id,
      demandName: s.demandName,
      schemaVersion: s.schemaVersion,
      submittedAt: s.submittedAt,
      source: s.source,
      submittedBy: SEED_USERS.find((u) => u.role === 'designer')?.id ?? null,
      payload: s.form as never,
      aiMarks: s.aiMarks,
    });
  });
  return true;
}
