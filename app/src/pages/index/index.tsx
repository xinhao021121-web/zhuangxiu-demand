import { useEffect, useMemo, useState } from 'react';
import { Text, View } from '@tarojs/components';
import { SECTIONS, fieldOf, recommendStats, splitKey } from '@zx/field-spec';
import { AssistantPanel, FindBar, SectionDots, SectionPills } from '../../components/Assistant';
import { SectionCard } from '../../components/Form';
import { ConfirmView, Overlay, SummaryView, Toast } from '../../components/Overlays';
import { useIsWide } from '../../platform/env';
import { scrollToNode } from '../../platform/scroll';
import { useAppStore } from '../../store';

export default function Index() {
  const wide = useIsWide();
  const draft = useAppStore((s) => s.draft);
  const view = useAppStore((s) => s.view);
  const flashKey = useAppStore((s) => s.flashKey);
  const pending = useAppStore((s) => s.pending);
  const toast = useAppStore((s) => s.toast);
  const fillDemo = useAppStore((s) => s.fillDemo);
  const reset = useAppStore((s) => s.reset);
  const flash = useAppStore((s) => s.flash);
  const requestSubmit = useAppStore((s) => s.requestSubmit);
  const cancelPending = useAppStore((s) => s.cancelPending);

  const [expanded, setExpanded] = useState<string[]>(['认识你家']);
  const [drawer, setDrawer] = useState(false);
  const [summary, setSummary] = useState(false);
  const [scrollTarget, setScrollTarget] = useState('');

  const stats = useMemo(() => recommendStats(view.model), [view.model]);

  useEffect(() => {
    if (!scrollTarget) return;
    const timer = setTimeout(() => {
      scrollToNode(scrollTarget.startsWith('sec:') ? `sec-${scrollTarget.slice(4)}` : `fi-${scrollTarget}`);
      setScrollTarget('');
    }, 60);
    return () => clearTimeout(timer);
  }, [scrollTarget, expanded]);

  const toggle = (section: string) => {
    setExpanded((prev) => {
      if (prev.includes(section)) return prev.filter((n) => n !== section);
      return wide ? [...prev, section] : [section];
    });
  };

  const jumpTo = (section: string) => {
    setExpanded((prev) => (wide ? [...new Set([...prev, section])] : [section]));
    setScrollTarget(`sec:${section}`);
  };

  /** 点击发现卡片：收起弹层、展开目标大类并高亮字段 2 秒。 */
  const gotoField = (key: string) => {
    const [, id] = splitKey(key);
    const field = fieldOf(id);
    setDrawer(false);
    if (!field) return;
    setExpanded((prev) => (wide ? [...new Set([...prev, field.section])] : [field.section]));
    setScrollTarget(key);
    flash(key);
  };

  const openSummary = () => {
    setDrawer(false);
    setSummary(true);
  };

  return (
    <View className={`page ${wide ? 'wide' : 'narrow'}`}>
      <View className="topbar">
        <View className="brand">
          <Text className="dot">筑</Text>
          <Text className="brand-text">问需 · 采集 · 房主端</Text>
        </View>
        <View className="progress-wrap">
          <View className="progress">
            <View className="progress-bar" id="prog-bar" style={{ width: `${stats.percent}%` }} />
          </View>
          <Text className="progress-num" id="prog-num">
            {`需求清晰度 ${stats.percent}% · 推荐项 ${stats.done}/${stats.total}`}
          </Text>
        </View>
        <View className="topbar-acts">
          <View className="btn btn-sm" id="btn-demo" onClick={fillDemo}>
            <Text>填入示例需求</Text>
          </View>
          <View className="btn btn-sm" id="btn-reset" onClick={reset}>
            <Text>重置</Text>
          </View>
          {wide ? (
            <>
              <View className="btn btn-sm btn-primary" id="btn-summary-top" onClick={openSummary}>
                <Text>生成需求摘要</Text>
              </View>
              <View className="btn btn-sm btn-primary" id="btn-submit" onClick={requestSubmit}>
                <Text>提交设计师</Text>
              </View>
            </>
          ) : null}
        </View>
      </View>

      {!wide ? <SectionPills model={view.model} active={expanded[0] ?? ''} onJump={jumpTo} /> : null}

      <View className="layout">
        <View className="form-col">
          {SECTIONS.map((section, index) => (
            <SectionCard
              key={section.name}
              section={section}
              index={index}
              model={draft.model}
              expanded={expanded.includes(section.name)}
              flashKey={flashKey}
              onToggle={() => toggle(section.name)}
            />
          ))}
        </View>

        {wide ? (
          <View className="side">
            <AssistantPanel
              variant="side"
              model={view.model}
              assistant={view.assistant}
              onGoto={gotoField}
              onSummary={openSummary}
            />
            <View className="side-card">
              <Text className="side-title">分区定位</Text>
              <SectionDots model={view.model} onJump={jumpTo} />
            </View>
          </View>
        ) : null}
      </View>

      {!wide ? (
        <View className="bottom">
          <FindBar model={view.model} assistant={view.assistant} onOpen={() => setDrawer(true)} />
          <View className="actionbar">
            <View className="btn btn-sm btn-primary" id="btn-submit" onClick={requestSubmit}>
              <Text>提交设计师</Text>
            </View>
            <View className="btn btn-sm" id="btn-summary" onClick={openSummary}>
              <Text>需求摘要</Text>
            </View>
          </View>
        </View>
      ) : null}

      {!wide ? (
        <Overlay open={drawer} onClose={() => setDrawer(false)}>
          <AssistantPanel
            variant="sheet"
            model={view.model}
            assistant={view.assistant}
            onGoto={gotoField}
            onSummary={openSummary}
          />
        </Overlay>
      ) : null}

      <Overlay open={summary} onClose={() => setSummary(false)}>
        <SummaryView onClose={() => setSummary(false)} />
      </Overlay>

      {pending ? (
        <Overlay open onClose={cancelPending}>
          <ConfirmView />
        </Overlay>
      ) : null}

      <Toast text={toast} />
    </View>
  );
}
