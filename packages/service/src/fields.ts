/** 表单模型里的字段键：固定字段是 id，实例字段是「实例键.id」。流水线与校验都要用。 */

import type { FormModel, InstanceState } from '@zx/field-spec';

export function fieldKeysOf(model: FormModel): string[] {
  const keys = Object.keys(model.values);
  Object.values<InstanceState[]>(model.instances).forEach((list) => {
    list.forEach((inst) => Object.keys(inst.values).forEach((id) => keys.push(`${inst.key}.${id}`)));
  });
  return keys;
}
