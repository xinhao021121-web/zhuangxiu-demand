import { describe, expect, it } from 'vitest';
import { createModel, setValue } from '@zx/field-spec';
import { handleSuggestion } from '@zx/rules';
import {
  DRAFT_KEY,
  SCHEMA_VERSION,
  createDraft,
  createLocalRepository,
  createMemoryStorage,
  migrateDraft,
} from '@zx/data';

describe('草稿迁移', () => {
  it('没有草稿时给出默认草稿：两个卫生间、未静默', () => {
    const draft = migrateDraft(null);
    expect(draft.schemaVersion).toBe(SCHEMA_VERSION);
    expect(draft.model.instances['卫生间']).toHaveLength(2);
    expect(draft.assistant.quiet).toBe(false);
  });

  it('旧结构（只有固定字段值）可读，字段清单里没有的字段被丢弃', () => {
    const draft = migrateDraft({
      schemaVersion: 1,
      values: { base_area: 89, legacy_field: '已经删掉的字段', empty_one: '' },
    });
    expect(draft.schemaVersion).toBe(SCHEMA_VERSION);
    expect(draft.model.values.base_area).toBe(89);
    expect(draft.model.values.legacy_field).toBeUndefined();
    expect(draft.model.values.empty_one).toBeUndefined();
    expect(draft.model.instances['卫生间']).toHaveLength(2);
  });

  it('字段清单升级后，实例内已不存在的字段被丢弃', () => {
    const draft = migrateDraft({
      schemaVersion: 1,
      model: {
        values: { base_area: 89 },
        instances: {
          卫生间: [{ key: 'i1', section: '卫生间', values: { wc_type: '主卫', wc_bath: '淋浴', gone: '旧字段' } }],
        },
      },
    });
    expect(draft.model.instances['卫生间']).toHaveLength(1);
    expect(draft.model.instances['卫生间'][0].values.wc_bath).toBe('淋浴');
    expect(draft.model.instances['卫生间'][0].values.gone).toBeUndefined();
  });

  it('静默状态只属于本次会话，读回后不继承', () => {
    const draft = migrateDraft({
      schemaVersion: 2,
      assistant: { handled: { 'pet-cat#-': { status: 'ignored' } }, dismissStreak: 3, quiet: true },
    });
    expect(draft.assistant.quiet).toBe(false);
    expect(draft.assistant.dismissStreak).toBe(3);
    expect(draft.assistant.handled['pet-cat#-']).toEqual({ status: 'ignored' });
  });
});

describe('本地仓储', () => {
  it('草稿可以写入并读回', () => {
    const repo = createLocalRepository(createMemoryStorage());
    const model = setValue(createModel(), 'base_area', 120);
    repo.saveDraft({ ...createDraft(), model });
    expect(repo.loadDraft().model.values.base_area).toBe(120);
    repo.clearDraft();
    expect(repo.loadDraft().model.values.base_area).toBeUndefined();
  });

  it('坏掉的草稿不会让页面崩掉', () => {
    const repo = createLocalRepository(createMemoryStorage({ [DRAFT_KEY]: '{不是 JSON' }));
    expect(repo.loadDraft().schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('埋点落在本地，提交返回结果', () => {
    const storage = createMemoryStorage();
    const repo = createLocalRepository(storage, () => 1000);
    repo.saveDraft(handleDraft());
    repo.track('adopt', { rule: 'pet-cat' });
    const events = repo.loadDraft().events;
    expect(events.some((e) => e.name === 'adopt')).toBe(true);
    const result = repo.submit({ summary: '摘要' });
    expect(result.ok).toBe(true);
    expect(repo.loadDraft().events.some((e) => e.name === 'submit')).toBe(true);
  });
});

function handleDraft() {
  const draft = createDraft();
  draft.assistant = handleSuggestion(draft.assistant, 'pet-cat#-', 'adopted', '养猫家庭要预留猫砂盆位置');
  return draft;
}
