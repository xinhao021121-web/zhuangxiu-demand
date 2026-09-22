import { create } from 'zustand';
import {
  INSTANCE_DEF,
  addInstance,
  getValue,
  instanceName,
  isEmptyValue,
  labelOf,
  removeInstance,
  setValue,
} from '@zx/field-spec';
import type { FieldValue, InstanceState } from '@zx/field-spec';
import {
  QUIET_THRESHOLD,
  applySuggestion,
  handleSuggestion,
  needsConfirm,
  suggestionsOf,
  toggleQuiet,
} from '@zx/rules';
import type { Suggestion } from '@zx/rules';
import { createDraft, createLocalRepository } from '@zx/data';
import type { Draft } from '@zx/data';
import { taroStorage } from './platform/storage';

/** 表单变化后防抖多久再更新助手（见产品文档 4.8）。 */
export const REFRESH_DELAY = 800;
const FLASH_DURATION = 1700;

export const repository = createLocalRepository(taroStorage);

/** 需要二次确认的动作：字段替换、删除已填内容的实例、提交。 */
export type Pending =
  | { kind: 'overwrite'; id: string; text?: string }
  | { kind: 'removeInstance'; section: string; key: string }
  | { kind: 'submit' }
  | null;

export interface AppStore {
  /** 实时表单 */
  draft: Draft;
  /** 助手读取的已发布快照 */
  view: Draft;
  flashKey: string;
  pending: Pending;
  toast: string;
  setField: (key: string, value: FieldValue) => void;
  adopt: (id: string, text?: string) => void;
  ignore: (id: string) => void;
  keep: (id: string) => void;
  undoAI: (key: string) => void;
  addInstanceOf: (section: string) => void;
  removeInstanceOf: (section: string, key: string) => void;
  toggleNoNeed: (section: string) => void;
  setQuiet: (quiet: boolean) => void;
  confirmPending: () => void;
  cancelPending: () => void;
  flash: (key: string) => void;
  requestSubmit: () => void;
  reset: () => void;
  fillDemo: () => void;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let flashTimer: ReturnType<typeof setTimeout> | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function toast(message: string): void {
  if (toastTimer) clearTimeout(toastTimer);
  useAppStore.setState({ toast: message });
  toastTimer = setTimeout(() => useAppStore.setState({ toast: '' }), 2200);
}

/** 先按实时表单找发现；表单刚改过导致规则不再命中时，回落到助手当前展示的发现。 */
function findSuggestion(id: string): Suggestion | undefined {
  const { draft, view } = useAppStore.getState();
  return suggestionsOf(draft.model).find((s) => s.id === id) ?? suggestionsOf(view.model).find((s) => s.id === id);
}

/** 结构性动作立即生效：采纳、忽略、增删实例、重置。 */
function commit(draft: Draft, extra: Partial<AppStore> = {}): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  useAppStore.setState({ draft, view: draft, ...extra });
  repository.saveDraft(draft);
}

/** 字段输入防抖后再发布给助手，用户正在输入时不弹提示。 */
function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    const draft = useAppStore.getState().draft;
    useAppStore.setState({ view: draft });
    repository.saveDraft(draft);
  }, REFRESH_DELAY);
}

function flash(key: string): void {
  if (flashTimer) clearTimeout(flashTimer);
  useAppStore.setState({ flashKey: key });
  flashTimer = setTimeout(() => useAppStore.setState({ flashKey: '' }), FLASH_DURATION);
}

function targetLabel(s: Suggestion, model: Draft['model']): string {
  if (!s.instKey) return labelOf(s.target);
  const inst = Object.values(model.instances)
    .flat()
    .find((i: InstanceState) => i.key === s.instKey);
  return inst ? `${instanceName(model, inst)} · ${labelOf(s.target)}` : labelOf(s.target);
}

function applyAdopt(suggestion: Suggestion, text?: string): void {
  const { draft } = useAppStore.getState();
  const outcome = applySuggestion(draft.model, suggestion, text);
  const next: Draft = {
    ...draft,
    model: outcome.model,
    aiMarks: { ...draft.aiMarks, [outcome.key]: true },
    assistant: handleSuggestion(draft.assistant, suggestion.id, 'adopted', text ?? suggestion.text),
  };
  repository.track('adopt', { rule: suggestion.ruleId, target: suggestion.target });
  commit(next);
  flash(outcome.key);
  toast(`已写入「${targetLabel(suggestion, outcome.model)}」，可在字段旁撤销`);
}

function removeInstanceNow(section: string, key: string): void {
  const { draft } = useAppStore.getState();
  const aiMarks = Object.fromEntries(Object.entries(draft.aiMarks).filter(([k]) => !k.startsWith(`${key}.`)));
  commit({ ...draft, model: removeInstance(draft.model, section, key), aiMarks });
  toast('已删除该空间');
}

export const useAppStore = create<AppStore>((set, get) => ({
  draft: createDraft(),
  view: createDraft(),
  flashKey: '',
  pending: null,
  toast: '',

  setField(key, value) {
    set({ draft: { ...get().draft, model: setValue(get().draft.model, key, value) } });
    scheduleRefresh();
  },

  adopt(id, text) {
    // 用实时表单判断「字段已有值」，否则用户刚改的值还在防抖窗口里，会漏掉二次确认
    const { draft } = get();
    const suggestion = findSuggestion(id);
    if (!suggestion) return;
    if (needsConfirm(draft.model, suggestion)) {
      set({ pending: { kind: 'overwrite', id, text } });
      return;
    }
    applyAdopt(suggestion, text);
  },

  ignore(id) {
    const { draft } = get();
    const before = draft.assistant.quiet;
    const assistant = handleSuggestion(draft.assistant, id, 'ignored');
    repository.track('ignore', { id });
    commit({ ...draft, assistant });
    toast(assistant.quiet && !before ? `连续 ${QUIET_THRESHOLD} 次不感兴趣，已进入静默模式` : '已忽略，同类建议不再出现');
  },

  keep(id) {
    const { draft } = get();
    const assistant = handleSuggestion(draft.assistant, id, 'kept');
    repository.track('keep', { id });
    commit({ ...draft, assistant });
    toast('已保留你的原需求，这条提醒不再出现');
  },

  undoAI(key) {
    const { draft } = get();
    const aiMarks = { ...draft.aiMarks };
    delete aiMarks[key];
    commit({ ...draft, model: setValue(draft.model, key, ''), aiMarks });
    toast('已撤销该字段的助手建议');
  },

  addInstanceOf(section) {
    const { draft } = get();
    if ((draft.model.instances[section] ?? []).length >= (INSTANCE_DEF[section]?.max ?? 0)) return;
    commit({
      ...draft,
      model: addInstance(draft.model, section),
      noNeed: { ...draft.noNeed, [section]: false },
    });
    toast(`已添加${INSTANCE_DEF[section]?.namePrefix ?? '空间'}，选一下用途就能看到相关需求`);
  },

  removeInstanceOf(section, key) {
    const { draft } = get();
    const inst = (draft.model.instances[section] ?? []).find((i) => i.key === key);
    if (!inst) return;
    const filled = Object.values(inst.values).filter((v) => !isEmptyValue(v)).length;
    if (filled) {
      set({ pending: { kind: 'removeInstance', section, key } });
      return;
    }
    removeInstanceNow(section, key);
  },

  toggleNoNeed(section) {
    const { draft } = get();
    commit({ ...draft, noNeed: { ...draft.noNeed, [section]: !draft.noNeed[section] } });
  },

  setQuiet(quiet) {
    const { draft } = get();
    commit({ ...draft, assistant: toggleQuiet(draft.assistant, quiet) });
    toast(quiet ? '已进入静默模式' : '已恢复建议');
  },

  confirmPending() {
    const { pending, draft } = get();
    if (!pending) return;
    if (pending.kind === 'overwrite') {
      const suggestion = findSuggestion(pending.id);
      set({ pending: null });
      if (suggestion) applyAdopt(suggestion, pending.text);
      return;
    }
    if (pending.kind === 'removeInstance') {
      set({ pending: null });
      removeInstanceNow(pending.section, pending.key);
      return;
    }
    set({ pending: null });
    const { summary } = summarise(draft);
    repository.submit({ summary });
    toast('已提交给设计师，正文与摘要在本机保存');
  },

  cancelPending() {
    set({ pending: null });
  },

  flash,

  requestSubmit() {
    set({ pending: { kind: 'submit' } });
  },

  reset() {
    repository.clearDraft();
    const draft = createDraft();
    commit(draft);
    toast('已重置');
  },

  fillDemo() {
    const draft = createDraft();
    const seed: Record<string, FieldValue> = {
      base_house_state: '旧房翻新',
      base_area: 89,
      live_type: '长期居住',
      live_members: ['夫妻', '儿子'],
      live_pet: ['猫'],
      live_pet_count: 1,
      live_elder: '否',
      live_allergy: '否',
      budget_total: '20-30万',
      mode: '半包',
      style_pref: ['现代简约'],
      office_need: '偶尔',
      date_finish: '2026-10',
      date_movein: '2026-12',
      kt_freq: '经常',
      kt_form: '开放式',
      kt_height_m: 175,
      kt_height_f: 162,
      kt_dishwasher: '前开式',
      lv_bookshelf: '需要',
      bl_washer: '是',
      bl_dryer: '是',
      dn_people: 3,
      br_bed: '1.8m',
      ex_boots: 2,
      sc_luggage: 2,
      clean_tools: ['扫地机器人'],
      guest_freq: '偶尔',
    };
    Object.entries(seed).forEach(([id, value]) => {
      draft.model = setValue(draft.model, id, value);
    });
    const bathrooms = draft.model.instances['卫生间'];
    Object.entries({ wc_drywet: '是', wc_toilet: '智能马桶', wc_bath: '浴缸加淋浴' }).forEach(([id, v]) => {
      draft.model = setValue(draft.model, `${bathrooms[0].key}.${id}`, v);
    });
    Object.entries({ wc_drywet: '是', wc_toilet: '普通马桶', wc_bath: '淋浴' }).forEach(([id, v]) => {
      draft.model = setValue(draft.model, `${bathrooms[1].key}.${id}`, v);
    });
    draft.model = addInstance(draft.model, '其他卧室');
    const bedroom = draft.model.instances['其他卧室'][0];
    Object.entries({ room_type: '儿童房', room_bed: '1.5m', room_desk: '可升降书桌' }).forEach(([id, v]) => {
      draft.model = setValue(draft.model, `${bedroom.key}.${id}`, v);
    });
    commit(draft);
    toast('已填入示例：89㎡ 旧房翻新 + 养猫 + 两个卫生间');
  },
}));

/** 读回草稿：字段清单升级后旧草稿仍可读，静默状态不跨会话继承。 */
export function bootstrap(): void {
  const draft = repository.loadDraft();
  useAppStore.setState({ draft, view: draft });
}

/** 提交前检查与摘要共用的一份汇总。 */
export function summarise(draft: Draft) {
  const list = suggestionsOf(draft.model);
  const handled = draft.assistant.handled;
  const adopted = list.filter((s) => handled[s.id]?.status === 'adopted');
  return {
    open: list.filter((s) => !handled[s.id]).length,
    adopted: adopted.map((s) => handled[s.id].text ?? s.text),
    suggestions: list,
  };
}

