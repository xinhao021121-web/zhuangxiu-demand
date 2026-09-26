/**
 * 降级原因的口径（技术方案 6.11 的 `checklist_error`）。
 *
 * 一次生成「没成」有三种：调用没拿到东西、模型给了字段清单之外的名字、内容结构不合法。
 * 三种在埋点里各有一个名字，报表按名字分开数——混在一起就看不出该改网络还是改提示词。
 */

import { describe, expect, it } from 'vitest';
import { describeFailure } from '@zx/service';

const issues = (extra: Partial<Parameters<typeof describeFailure>[0]> = {}) => ({
  structure: [],
  unknownFields: [],
  ...extra,
});

describe('降级原因收敛成一个名字', () => {
  it('三类失败各归一个名字', () => {
    expect(describeFailure(issues({ transport: ['限流'] })).reason).toBe('transport');
    expect(describeFailure(issues({ unknownFields: ['derivedItems[0].relatedFieldIds: 某个不存在的字段'] })).reason).toBe(
      'unknown_fields',
    );
    expect(describeFailure(issues({ structure: ['profile: Required'] })).reason).toBe('structure');
  });

  it('传输失败排最前：问题在网络或服务上，与「模型不听话」不是一回事', () => {
    const failure = describeFailure(
      issues({ transport: ['超时'], structure: ['(根): Expected object, received string'] }),
    );
    expect(failure.reason).toBe('transport');
    expect(failure.detail).toBe('超时');
  });

  it('越界字段带上条数，详情截断到 200 字（落库的是给人查问题用的那一条）', () => {
    const long = 'x'.repeat(500);
    const failure = describeFailure(issues({ unknownFields: ['a', 'b'], structure: [long] }));
    expect(failure.unknownFields).toBe(2);
    expect(failure.detail).toBe('a');
    expect(describeFailure(issues({ structure: [long] })).detail).toHaveLength(200);
  });
});
