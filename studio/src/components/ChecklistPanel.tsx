'use client';

import { Fragment } from 'react';
import type { ChecklistView } from '@zx/contracts';
import { fieldLabel } from './FormView';

const TIER_NAME = { must: '必问', suggest: '建议问' } as const;
const SOURCE_CLASS = { derived: 'b-src-rule', survey: 'b-src-survey', both: 'b-src-both' } as const;
/** 有推导成分的条目把来源说到底（5.6）：规则托底与「你来定」是确定判断，模型推导是读懂之后推的。 */
const ORIGIN_NAME = { rule: '规则托底', unclear: '房主说你来定', model: '模型推导' } as const;
const sourceName = (item: ChecklistView['items'][number]) => {
  if (item.source === 'survey') return '通用核实';
  const origin = ORIGIN_NAME[item.origin ?? 'model'];
  return item.source === 'both' ? `${origin} + 通用核实` : origin;
};
/** 建议问里的两级（5.6）：来源不是纯通用核实的都算「这一家的」。 */
const isOwn = (source: ChecklistView['items'][number]['source']) => source !== 'survey';

interface Props {
  checklist: ChecklistView;
  onToggle: (key: string, removed: boolean) => void;
  onJump: (fieldKey: string) => void;
  pendingKey: string | null;
}

/** 量房沟通清单：按空间分组、必问在前、可删减可撤销，条目能点回原始表格的字段。 */
export function ChecklistPanel({ checklist, onToggle, onJump, pendingKey }: Props) {
  const removed = new Set(checklist.removedKeys);
  const ownSuggest = checklist.items.filter((i) => i.tier === 'suggest' && isOwn(i.source)).length;
  return (
    <div>
      <div className="card">
        <h3>
          量房沟通清单
          <span className="cnt">
            必问 {checklist.counts.must} 条 · 建议问里这一家的 {ownSuggest} 条 · 共 {checklist.counts.total} 条
            （已删减 {removed.size} 条）
          </span>
        </h3>
        <div className="note">
          按现场动线排：先进门核结构与尺寸，再一个空间一个空间走。删掉的那条是「判断这条值不值得带到现场」，
          动作会记录下来，用来回头调判据。
        </div>
      </div>

      {checklist.degraded ? (
        <div className="warn">
          模型部分未生成：这次只出了规则与通用清单两部分。可以重新解读一次，或直接带着这份清单去现场。
        </div>
      ) : null}

      {checklist.groups.map((group) => (
        <div key={group.space}>
          <div className="grp">
            {group.space}　{group.items.filter((i) => !removed.has(i.key)).length} 条
          </div>
          {group.items.map((item, index) => {
            const isDel = removed.has(item.key);
            const previous = group.items[index - 1];
            const showDivider =
              item.tier === 'suggest' &&
              (!previous || previous.tier === 'must' || isOwn(previous.source) !== isOwn(item.source));
            return (
              <Fragment key={item.key}>
                {showDivider ? (
                  <div className="subgrp" data-sub={isOwn(item.source) ? 'own' : 'survey'}>
                    {isOwn(item.source) ? '建议问 · 这一家的' : '建议问 · 通用核实'}
                  </div>
                ) : null}
                <div className={`item${isDel ? ' del' : ''}`} data-key={item.key}>
                  <div className="acts">
                    <button
                      type="button"
                      className="btn sm"
                      data-act="del"
                      disabled={pendingKey === item.key}
                      onClick={() => onToggle(item.key, !isDel)}
                    >
                      {isDel ? '撤销' : '删减'}
                    </button>
                  </div>
                  <div className="q">
                    <span className={`badge ${item.tier === 'must' ? 'b-must' : 'b-sug'}`}>
                      {TIER_NAME[item.tier]}
                    </span>
                    <span className={`badge ${SOURCE_CLASS[item.source]}`}>{sourceName(item)}</span>
                    <span>{item.question}</span>
                  </div>
                  <div className="line">
                    <b>为什么问</b>
                    <span>{item.why}</span>
                  </div>
                  <div className="line">
                    <b>现场要核实</b>
                    <span>{item.onsiteChecks.join('；')}</span>
                  </div>
                  {item.relatedFields.length ? (
                    <div className="line">
                      <b>关联字段</b>
                      {item.relatedFields.map((fieldKey) => (
                        <button
                          type="button"
                          className="tag jump"
                          key={fieldKey}
                          data-jump={fieldKey}
                          onClick={() => onJump(fieldKey)}
                        >
                          {fieldLabel(fieldKey)}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Fragment>
            );
          })}
        </div>
      ))}
    </div>
  );
}
