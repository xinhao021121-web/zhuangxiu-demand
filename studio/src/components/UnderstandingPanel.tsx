'use client';

import type { UnderstandingView } from '@zx/contracts';

/** 表格理解四块：客户画像、核心诉求与优先级、矛盾与风险、待确认项。 */
export function UnderstandingPanel({ view }: { view: UnderstandingView }) {
  return (
    <div>
      <div className="card">
        <h3>
          客户画像<span className="cnt">{view.profile.length} 条</span>
        </h3>
        {view.profile.length ? (
          view.profile.map((line) => (
            <div className="sline" key={line.label + line.text}>
              <span className="k">{line.label}</span>
              <span className="v">{line.text}</span>
            </div>
          ))
        ) : (
          <span style={{ color: 'var(--dim2)' }}>还没有画像</span>
        )}
      </div>

      <div className="card">
        <h3>
          核心诉求与优先级<span className="cnt">{view.demands.length} 条</span>
        </h3>
        {view.demands.length ? (
          view.demands.map((text, index) => (
            <div className="sline" key={text}>
              <span className="k">P{index + 1}</span>
              <span className="v">{text}</span>
            </div>
          ))
        ) : (
          <span style={{ color: 'var(--dim2)' }}>还没有归纳出诉求</span>
        )}
      </div>

      <div className="card">
        <h3>
          矛盾与风险<span className="cnt">{view.risks.length} 条</span>
        </h3>
        {view.risks.length ? (
          view.risks.map((line, index) => (
            <div className="sline" key={line.label + index}>
              <span className="k">{line.label}</span>
              <span className="v">{line.text}</span>
            </div>
          ))
        ) : (
          <span style={{ color: 'var(--dim2)' }}>没有发现矛盾</span>
        )}
      </div>

      <div className="card">
        <h3>
          待确认项<span className="cnt">{view.toConfirm.length} 条</span>
        </h3>
        {view.toConfirm.length ? (
          view.toConfirm.map((q) => (
            <div className="sline" key={q.fieldKey}>
              <span className="k">{q.label}</span>
              <span className="v" style={{ color: 'var(--dim)' }}>
                {q.why}
              </span>
            </div>
          ))
        ) : (
          <span style={{ color: 'var(--dim2)' }}>没有待确认项</span>
        )}
      </div>
    </div>
  );
}
