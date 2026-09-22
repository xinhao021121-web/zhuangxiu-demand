import { useMemo, useState } from 'react';
import { Text, Textarea, View } from '@tarojs/components';
import { SECTIONS, instanceName, labelOf, sectionStats } from '@zx/field-spec';
import type { FormModel } from '@zx/field-spec';
import { openSuggestions, suggestionStats, suggestionsOf } from '@zx/rules';
import type { AssistantState, Suggestion } from '@zx/rules';
import { useAppStore } from '../store';

const KIND_LABEL: Record<Suggestion['kind'], string> = {
  risk: '风险提醒',
  discover: '需求发现',
  fill: '信息补充',
};

/** 卡片上同屏最多展开 3 条，其余折叠。 */
const VISIBLE_CARDS = 3;

function scopeLabel(s: Suggestion, model: FormModel): string {
  if (!s.instKey) return '';
  const inst = Object.values(model.instances).flat().find((i) => i.key === s.instKey);
  return inst ? instanceName(model, inst) : '';
}

function DiscoveryCard({ suggestion, model, onGoto }: { suggestion: Suggestion; model: FormModel; onGoto: (key: string) => void }) {
  const adopt = useAppStore((s) => s.adopt);
  const ignore = useAppStore((s) => s.ignore);
  const keep = useAppStore((s) => s.keep);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(suggestion.text);
  const scope = scopeLabel(suggestion, model);
  const targetKey = suggestion.instKey ? `${suggestion.instKey}.${suggestion.target}` : suggestion.target;

  return (
    <View className={`dk ${suggestion.p.toLowerCase()}${suggestion.kind === 'risk' ? ' risk' : ''}`} data-rule={suggestion.id}>
      <View className="dk-top">
        <Text className={`prio ${suggestion.p.toLowerCase()}`}>{suggestion.p}</Text>
        <Text className="dk-kind">{KIND_LABEL[suggestion.kind]}</Text>
        {scope ? <Text className="dk-scope">{scope}</Text> : null}
      </View>
      <Text className="dk-title">{suggestion.title}</Text>
      <Text className="dk-text">{suggestion.text}</Text>
      <Text className="dk-why">{suggestion.why}</Text>
      <Text className="dk-target" onClick={() => onGoto(targetKey)}>
        {`→ ${scope ? `${scope} · ` : ''}${labelOf(suggestion.target)}`}
      </Text>
      {suggestion.kind === 'fill' ? (
        <View className="dk-acts">
          <View className="btn btn-sm btn-soft" onClick={() => onGoto(targetKey)}>
            <Text>去填写</Text>
          </View>
        </View>
      ) : editing ? (
        <View className="dk-acts">
          <Textarea className="dk-edit" value={text} onInput={(e) => setText(e.detail.value)} />
          <View className="dk-edit-acts">
            <View className="btn btn-sm btn-primary" onClick={() => adopt(suggestion.id, text.trim())}>
              <Text>确认写入</Text>
            </View>
            <View className="btn btn-sm" onClick={() => setEditing(false)}>
              <Text>取消</Text>
            </View>
          </View>
        </View>
      ) : (
        <View className="dk-acts">
          <View className="btn btn-sm btn-primary" onClick={() => adopt(suggestion.id)}>
            <Text>加入</Text>
          </View>
          <View className="btn btn-sm" onClick={() => setEditing(true)}>
            <Text>改一改</Text>
          </View>
          {suggestion.kind === 'risk' ? (
            <View className="btn btn-sm" onClick={() => keep(suggestion.id)}>
              <Text>保持需求</Text>
            </View>
          ) : null}
          <View className="btn btn-sm" onClick={() => ignore(suggestion.id)}>
            <Text>不感兴趣</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function HandledCard({ suggestion, model }: { suggestion: Suggestion; model: FormModel }) {
  const scope = scopeLabel(suggestion, model);
  return (
    <View className="dk done">
      <View className="dk-top">
        <Text className="prio">已处理</Text>
        {scope ? <Text className="dk-scope">{scope}</Text> : null}
      </View>
      <Text className="dk-title">{suggestion.title}</Text>
    </View>
  );
}

interface PanelProps {
  variant: 'side' | 'sheet';
  model: FormModel;
  assistant: AssistantState;
  onGoto: (key: string) => void;
  onSummary: () => void;
}

export function AssistantPanel({ variant, model, assistant, onGoto, onSummary }: PanelProps) {
  const setQuiet = useAppStore((s) => s.setQuiet);
  const [reveal, setReveal] = useState(false);
  const all = useMemo(() => suggestionsOf(model), [model]);
  const open = useMemo(() => openSuggestions(model, assistant), [model, assistant]);
  const stats = useMemo(() => suggestionStats(model, assistant), [model, assistant]);
  const handled = useMemo(
    () =>
      all
        .filter((s) => assistant.handled[s.id])
        .slice(-VISIBLE_CARDS)
        .reverse(),
    [all, assistant],
  );
  const shown = reveal ? open : open.slice(0, VISIBLE_CARDS);

  return (
    <View className={`assistant assistant-${variant}`}>
      <View className="assistant-head">
        <View className="assistant-title">
          <Text className="assistant-name">需求发现助手</Text>
          <Text className="tag">纯规则</Text>
        </View>
        <View className="counts">
          <Text className="count">
            已发现 <Text className="count-num" id="c-found">{stats.found}</Text>
          </Text>
          <Text className="count">
            已处理 <Text className="count-num" id="c-handled">{stats.handled}</Text>
          </Text>
          <Text className="count">
            待看 <Text className="count-num" id="c-open">{stats.open}</Text>
          </Text>
        </View>
        {stats.handled > 0 && stats.open > 0 ? (
          <Text className="resume" id="resume">{`你已处理 ${stats.handled} 条发现，还有 ${stats.open} 条待看，可以继续往下看`}</Text>
        ) : null}
      </View>

      <View className="assistant-body" id="dk-list">
        {assistant.quiet ? (
          <View className="quiet" id="quiet-note">
            已进入静默模式，暂停主动建议。你可以点击下方「恢复建议」重新开启。
          </View>
        ) : shown.length ? (
          shown.map((s) => <DiscoveryCard key={s.id} suggestion={s} model={model} onGoto={onGoto} />)
        ) : (
          <View className="empty">当前没有新的发现。继续填写表单，助手会自动跟进。</View>
        )}

        {!assistant.quiet && open.length > VISIBLE_CARDS && !reveal ? (
          <View className="more" onClick={() => setReveal(true)}>
            <Text>{`展开更多（还有 ${open.length - VISIBLE_CARDS} 条）`}</Text>
          </View>
        ) : null}

        {handled.length ? (
          <View className="recent">
            <Text className="recent-title">最近处理</Text>
            {handled.map((s) => (
              <HandledCard key={s.id} suggestion={s} model={model} />
            ))}
          </View>
        ) : null}
      </View>

      <View className="assistant-foot">
        <View className="btn btn-sm" id="btn-quiet" onClick={() => setQuiet(!assistant.quiet)}>
          <Text>{assistant.quiet ? '恢复建议' : '暂时不要建议'}</Text>
        </View>
        <View className="btn btn-sm btn-soft" id="btn-summary" onClick={onSummary}>
          <Text>需求摘要</Text>
        </View>
      </View>
    </View>
  );
}

/** 宽屏的分区定位：竖直进度点。 */
export function SectionDots({ model, onJump }: { model: FormModel; onJump: (section: string) => void }) {
  return (
    <View className="dots">
      {SECTIONS.map((s) => {
        const st = sectionStats(model, s.name);
        const state = st.filled === 0 ? '' : st.total && st.filled >= st.total ? ' done' : ' part';
        return (
          <View key={s.name} className={`sdot${state}`} onClick={() => onJump(s.name)}>
            <Text className="sdot-mark">●</Text>
            <Text className="sdot-name">{s.name}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** 窄屏的分区导航：顶部横滑胶囊。 */
export function SectionPills({
  model,
  active,
  onJump,
}: {
  model: FormModel;
  active: string;
  onJump: (section: string) => void;
}) {
  return (
    <View className="pills" id="sec-nav">
      {SECTIONS.map((s) => {
        const st = sectionStats(model, s.name);
        const state = st.filled === 0 ? '' : st.total && st.filled >= st.total ? ' done' : ' part';
        return (
          <View
            key={s.name}
            className={`pill${state}${active === s.name ? ' on' : ''}`}
            onClick={() => onJump(s.name)}
          >
            <Text>{s.name}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** 窄屏的助手入口：底部常驻发现横条。 */
export function FindBar({ model, assistant, onOpen }: { model: FormModel; assistant: AssistantState; onOpen: () => void }) {
  const open = useMemo(() => openSuggestions(model, assistant).length, [model, assistant]);
  return (
    <View className="find-bar" id="find-bar" onClick={onOpen}>
      <Text className="find-icon">✦</Text>
      <Text className="find-text" id="find-text">
        {assistant.quiet
          ? '建议已暂停，点击查看'
          : open
            ? `还有 ${open} 条发现值得看一眼`
            : '暂时没有新的发现，继续填写表单'}
      </Text>
      <Text className="find-arrow">›</Text>
    </View>
  );
}
