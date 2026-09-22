import { useMemo } from 'react';
import Taro from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { recommendStats } from '@zx/field-spec';
import { OVERVIEW_LIMIT, buildOverview, buildSummary, buildSurveyChecklist } from '@zx/summary';
import { summarise, useAppStore } from '../store';

/** 同一套弹层：窄屏从底部升起占据大半屏，宽屏是居中卡片，差异交给媒体查询。 */
export function Overlay({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <View className="mask" id="mask" onClick={onClose}>
      <View className="panel" onClick={(e) => e.stopPropagation()}>
        <View className="panel-grab" />
        {children}
      </View>
    </View>
  );
}

export function SummaryView({ onClose }: { onClose: () => void }) {
  const draft = useAppStore((s) => s.draft);
  const { adopted } = useMemo(() => summarise(draft), [draft]);
  const overview = useMemo(() => buildOverview(draft.model, adopted), [draft, adopted]);
  const body = useMemo(() => buildSummary(draft.model, adopted), [draft, adopted]);
  const survey = useMemo(() => buildSurveyChecklist(), []);
  const text = `${overview}\n\n${body}\n\n${survey}`;

  return (
    <>
      <View className="panel-head">
        <Text className="panel-title">需求摘要</Text>
        <View className="btn btn-sm" id="sum-done" onClick={onClose}>
          <Text>关闭</Text>
        </View>
      </View>
      <View className="panel-body" id="sum-text">
        <Text className="sum-overview">{`核心摘要（${overview.length}/${OVERVIEW_LIMIT} 字）：${overview}`}</Text>
        <Text className="sum-body">{body}</Text>
        <Text className="sum-body">{survey}</Text>
      </View>
      <View className="panel-foot">
        <View
          className="btn btn-sm btn-primary"
          id="sum-copy"
          onClick={async () => {
            try {
              await Taro.setClipboardData({ data: text });
            } catch {
              /* 复制失败不打断流程 */
            }
          }}
        >
          <Text>复制文本</Text>
        </View>
      </View>
    </>
  );
}

/** 需要二次确认的三件事：字段替换、删除已填内容的实例、提交。 */
export function ConfirmView() {
  const pending = useAppStore((s) => s.pending);
  const draft = useAppStore((s) => s.draft);
  const confirmPending = useAppStore((s) => s.confirmPending);
  const cancelPending = useAppStore((s) => s.cancelPending);
  const stats = recommendStats(draft.model);
  const { open, adopted } = useMemo(() => summarise(draft), [draft]);

  if (!pending) return null;

  if (pending.kind === 'submit') {
    return (
      <>
        <View className="panel-body" id="cf-body">
          <Text className="panel-title">提交前检查</Text>
          <Text className="panel-line">{`需求清晰度 ${stats.percent}%（推荐项 ${stats.done}/${stats.total}）`}</Text>
          <Text className="panel-line">{`已确认助手发现 ${adopted.length} 条`}</Text>
          <Text className="panel-line">
            {open ? `还有 ${open} 条发现未处理，可以选择「仍要提交」或先回去处理。` : '发现项已处理完毕，可以提交。'}
          </Text>
          <Text className="panel-line">
            提交后会生成《需求意向书》和《量房确认清单》两份材料，量房确认清单 16 项由设计师现场逐条确认。
          </Text>
        </View>
        <View className="panel-foot">
          <View className="btn btn-sm" id="cf-cancel" onClick={cancelPending}>
            <Text>返回修改</Text>
          </View>
          <View className="btn btn-sm btn-primary" id="cf-ok" onClick={confirmPending}>
            <Text>仍要提交</Text>
          </View>
        </View>
      </>
    );
  }

  if (pending.kind === 'removeInstance') {
    return (
      <>
        <View className="panel-body" id="del-body">
          <Text className="panel-title">删除这个空间？</Text>
          <Text className="panel-line">这个空间已经填了内容，删除后需要重新填写。</Text>
        </View>
        <View className="panel-foot">
          <View className="btn btn-sm" id="del-cancel" onClick={cancelPending}>
            <Text>取消</Text>
          </View>
          <View className="btn btn-sm btn-primary" id="del-ok" onClick={confirmPending}>
            <Text>确认删除</Text>
          </View>
        </View>
      </>
    );
  }

  return (
    <>
      <View className="panel-body" id="ow-body">
        <Text className="panel-title">这个字段已经有内容</Text>
        <Text className="panel-line">写入助手建议会替换原来的选择，确认继续吗？</Text>
      </View>
      <View className="panel-foot">
        <View className="btn btn-sm" id="ow-cancel" onClick={cancelPending}>
          <Text>保留原内容</Text>
        </View>
        <View className="btn btn-sm btn-primary" id="ow-ok" onClick={confirmPending}>
          <Text>替换</Text>
        </View>
      </View>
    </>
  );
}

export function Toast({ text }: { text: string }) {
  if (!text) return null;
  return (
    <View className="toast" id="toast">
      <Text>{text}</Text>
    </View>
  );
}