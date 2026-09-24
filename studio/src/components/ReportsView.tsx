'use client';

import type { Reports } from '@zx/contracts';

/**
 * 回流报表（产品文档 7.6）：规则 / 判据 / 字段三张健康度 + 遗漏台账。
 *
 * 报表只汇总与排序，不自动改规则（7.5 第 1 条）——所以这里没有阈值、没有红黄绿，
 * 只把分子分母摆出来。算不出来的列写「未采集」，没有样本的率写「—」：两者都不是 0。
 */
export function ReportsView({ reports, onClose }: { reports: Reports; onClose: () => void }) {
  const rate = (value: number | null) => (value === null ? <span className="dash">—</span> : `${value}%`);

  return (
    <>
      <div className="head">
        <div>
          <h2>回流报表</h2>
          <div className="meta">
            <span>四张口径：规则 / 判据 / 字段 / 遗漏（产品文档 7.6）</span>
            <span>系统只汇总，判断交给人</span>
          </div>
        </div>
        <div className="acts">
          <button type="button" className="btn" id="rep-back" onClick={onClose}>
            回到需求单
          </button>
        </div>
      </div>

      <div className="card" id="rep-rules">
        <h3>
          规则健康度
          <span className="cnt">哪些发现该下架或改写 · 拒绝率 = 不感兴趣 / 展示</span>
        </h3>
        {reports.rules.length ? (
          <table className="rtable">
            <thead>
              <tr>
                <th>规则</th>
                <th>触发条件</th>
                <th className="num">展示</th>
                <th className="num">采纳</th>
                <th className="num">不感兴趣</th>
                <th className="num">拒绝率</th>
              </tr>
            </thead>
            <tbody>
              {reports.rules.map((r) => (
                <tr key={r.ruleId}>
                  <td className="mono">{r.ruleId}</td>
                  <td className="dim">{r.trigger ?? '（这条规则已经不在当前版本里）'}</td>
                  <td className="num">{r.shown}</td>
                  <td className="num">{r.adopted}</td>
                  <td className="num">{r.rejected}</td>
                  <td className="num">{rate(r.rejectRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-line">
            还没有埋点：规则数据来自房主端，房主提交需求单时随单上报（shown / adopt / ignore）。
          </div>
        )}
      </div>

      <div className="card" id="rep-criteria">
        <h3>
          判据健康度
          <span className="cnt">哪些判据太宽、哪些档位定错了 · 删减率 = 被删 / 条目</span>
        </h3>
        {reports.criteria.length ? (
          <table className="rtable">
            <thead>
              <tr>
                <th>来源</th>
                <th>档位</th>
                <th className="num">条目</th>
                <th className="num">被删</th>
                <th className="num">删减率</th>
              </tr>
            </thead>
            <tbody>
              {reports.criteria.map((c) => (
                <tr key={c.group}>
                  <td>{sourceLabel(c.source)}</td>
                  <td>
                    <span className={`badge ${c.tier === 'must' ? 'b-must' : 'b-sug'}`}>
                      {c.tier === 'must' ? '必问' : '建议问'}
                    </span>
                  </td>
                  <td className="num">{c.items}</td>
                  <td className="num">{c.removed}</td>
                  <td className="num">{rate(c.removalRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-line">还没有生成过清单，没有可汇总的条目。</div>
        )}
        <div className="note">
          「来源」是这条条目打哪来：需求推导（模型从已填内容推的）、通用核实（16 项资产）、推导+通用（两条撞在
          一起并成一条）。条目上没有存它满足了哪条判据，所以这一版按来源与档位分组。
        </div>
      </div>

      <div className="card" id="rep-fields">
        <h3>
          字段健康度
          <span className="cnt">哪些字段该进表单、哪些该出表单</span>
        </h3>
        {reports.fields.length ? (
          <table className="rtable">
            <thead>
              <tr>
                <th>字段</th>
                <th className="num">有值</th>
                <th className="num">答不清楚</th>
                <th className="num">不清楚率</th>
                <th className="num">被清单引用</th>
                <th className="num">没问上</th>
                <th className="num">没问上率</th>
                <th className="num">现场修正率</th>
              </tr>
            </thead>
            <tbody>
              {reports.fields.map((f) => (
                <tr key={f.fieldId}>
                  <td>
                    {f.label}
                    <span className="mono dim"> {f.fieldId}</span>
                  </td>
                  <td className="num">{f.answered}</td>
                  <td className="num">{f.unclear}</td>
                  <td className="num">{rate(f.unclearRate)}</td>
                  <td className="num">{f.referenced}</td>
                  <td className="num">{f.skipped}</td>
                  <td className="num">{rate(f.skipRate)}</td>
                  <td className="num">
                    {f.corrected === null ? <span className="never">未采集</span> : `${f.corrected}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-line">还没有需求单，没有可汇总的字段。</div>
        )}
        <div className="note">
          不清楚率 = 答「不清楚 / 听设计师建议」的需求单数 ÷ 有值的需求单数；没问上率 = 被标「没问上」的清单条目数
          ÷ 引用到该字段的条目数。
        </div>
      </div>

      <div className="card" id="rep-omissions">
        <h3>
          遗漏台账
          <span className="cnt">清单漏掉了哪一类问题 · 人工补录</span>
        </h3>
        {reports.omissions.length ? (
          <table className="rtable">
            <thead>
              <tr>
                <th>需求单</th>
                <th>分区</th>
                <th>归类</th>
                <th>该问的是什么</th>
                <th>谁补的</th>
                <th>什么时候</th>
              </tr>
            </thead>
            <tbody>
              {reports.omissions.map((o) => (
                <tr key={o.id}>
                  <td>{o.demandName}</td>
                  <td>{o.space}</td>
                  <td>
                    <span className="chip cat">{o.category}</span>
                  </td>
                  <td>{o.note}</td>
                  <td className="dim">{o.operator}</td>
                  <td className="dim">{o.at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-line">
            还没有补录。遗漏率不是 0，是没有数据——没有补录入口时它显示「未采集」，不显示 0。
          </div>
        )}
      </div>

      {reports.unavailable.length ? (
        <div className="warn" id="rep-unavailable">
          {reports.unavailable.map((u) => (
            <div key={u.column}>
              <b>{u.column}</b>：{u.reason}
            </div>
          ))}
          <div className="dim">「—」= 还没有样本（分母为 0），不是 0%。</div>
        </div>
      ) : null}
    </>
  );
}

function sourceLabel(source: 'derived' | 'survey' | 'both'): string {
  return source === 'derived' ? '需求推导' : source === 'both' ? '推导+通用' : '通用核实';
}
