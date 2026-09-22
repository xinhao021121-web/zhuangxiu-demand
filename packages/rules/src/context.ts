import { instanceName, instanceType } from '@zx/field-spec';
import type { FormModel, InstanceState } from '@zx/field-spec';
import type { RuleContext } from './types';

export const has = (v: unknown, x: string): boolean => {
  if (Array.isArray(v)) return v.includes(x);
  return v === x || (typeof v === 'string' && v.includes(x));
};

export const anyOf = (v: unknown, xs: string[]): boolean => xs.some((x) => has(v, x));

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const filled = (v: unknown): boolean => {
  if (v === undefined || v === null || v === '') return false;
  return !(Array.isArray(v) && v.length === 0);
};

export function createContext(model: FormModel): RuleContext {
  return {
    values: model.values,
    inst: (section: string) => model.instances[section] ?? [],
    name: (inst: InstanceState) => instanceName(model, inst),
    type: (inst: InstanceState) => instanceType(inst),
    model,
  };
}
