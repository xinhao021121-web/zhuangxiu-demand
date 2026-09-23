'use client';

import type { ChecklistView } from '@zx/contracts';
import { fieldLabel } from './FormView';

const TIER_NAME = { must: '必问', suggest: '建议问' } as const;
const SOURCE_NAME = { derived: '需求推导', survey: '通用核实', both: '需求推导 + 通用核实' } as const;
const SOURCE_CLASS = { derived: 'b-src-rule', survey: 'b-src-survey', both: 'b-src-both' } as const;

interface Props {
  checklist: ChecklistView;
  onToggle: (key: string, removed: boolean) => void;
  onJump: (fieldKey: string) => void;
  pendingKey: string | null;
}

/** 量房沟通清单：按空间分组、必问在前、可删减可撤销，条目能点回原始表格的字段。 */
export function ChecklistPanel({ checklist, onToggle, onJump, pendingKey }: Props) {
  const removed = new Set(checklist.removedKeys);
  return (
    <div>
      <div className="card">
        <h3>
          量房沟通清单
          <span className="cnt">
            必问 {checklist.counts.must} 条 · 共 {checklist.counts.total} 条（已删减 {removed.size} 条）
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
          {group.items.map((item) => {
            const isDel = removed.has(item.key);
            return (
              <div className={`item${isDel ? ' del' : ''}`} key={item.key} data-key={item.key}>
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
                  <span className={`badge ${SOURCE_CLASS[item.source]}`}>{SOURCE_NAME[item.source]}</span>
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
            );
          })}
        </div>
      ))}
    </div>
  );
}
