'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildChecklistMarkdown } from '@zx/checklist';
import type {
  ChecklistView,
  DemandSheetDetail,
  DemandSheetSummary,
  OutboundRecordContract,
  User,
} from '@zx/contracts';
import { api, ApiError, getToken, setToken } from '../lib/api';
import { ChecklistPanel } from './ChecklistPanel';
import { ExportDialog, OutboundDialog } from './Dialogs';
import { FormView } from './FormView';
import { LoginView } from './Login';
import { UnderstandingPanel } from './UnderstandingPanel';

type Tab = 'form' | 'under' | 'list';
type Dialog = { kind: 'outbound' } | { kind: 'export' } | null;

const USER_KEY = 'zx.studio.user';

function readUser(): User | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

/**
 * 桌面工作台：导入 → 确认外发 → 看理解 → 筛清单 → 导出（F1–F6）。
 *
 * 这一层只做「读状态、渲染、派发事件」：判据、合并、排序、脱敏都在 packages/*，
 * 服务端不在浏览器里（技术方案 3.1 的分层纪律）。
 */
export function Workbench() {
  const [user, setUser] = useState<User | null>(null);
  const [sheets, setSheets] = useState<DemandSheetSummary[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DemandSheetDetail | null>(null);
  const [tab, setTab] = useState<Tab>('form');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  /** 外发记录：生成前给设计师看一眼上次发了什么（F3 的事后可查） */
  const [history, setHistory] = useState<OutboundRecordContract[]>([]);
  const [error, setError] = useState('');

  const reloadSheets = useCallback(async () => {
    const list = await api.listSheets();
    setSheets(list);
    return list;
  }, []);

  const reloadHistory = useCallback(async (id: string) => {
    try {
      setHistory(await api.outboundRecords(id));
    } catch {
      setHistory([]);
    }
  }, []);

  const reloadDetail = useCallback(async (id: string) => {
    const next = await api.detail(id);
    setDetail(next);
    return next;
  }, []);

  useEffect(() => {
    setUser(readUser());
  }, []);

  useEffect(() => {
    if (!user || !getToken()) return;
    reloadSheets()
      .then((list) => {
        if (list.length) setCurrentId((prev) => prev ?? list[0].id);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          setToken(null);
          setUser(null);
        } else {
          setError(err instanceof Error ? err.message : '加载失败');
        }
      });
  }, [user, reloadSheets]);

  useEffect(() => {
    if (!currentId) return;
    reloadDetail(currentId).catch((err: unknown) => setError(err instanceof Error ? err.message : '加载失败'));
    void reloadHistory(currentId);
  }, [currentId, reloadDetail, reloadHistory]);

  const currentSummary = useMemo(() => sheets.find((s) => s.id === currentId) ?? null, [sheets, currentId]);

  const onLogin = (next: User) => {
    window.localStorage.setItem(USER_KEY, JSON.stringify(next));
    setUser(next);
  };

  const logout = () => {
    setToken(null);
    window.localStorage.removeItem(USER_KEY);
    setUser(null);
    setSheets([]);
    setDetail(null);
    setCurrentId(null);
  };

  const selectSheet = (id: string) => {
    setCurrentId(id);
    setTab('form');
    setFlash(null);
    setError('');
  };

  const confirmGenerate = async (selected: Record<string, boolean>) => {
    if (!currentId) return;
    setBusy(true);
    try {
      await api.generate(currentId, selected);
      await reloadDetail(currentId);
      await reloadHistory(currentId);
      await reloadSheets();
      setDialog(null);
      setTab('list');
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setBusy(false);
    }
  };

  const toggleItem = async (key: string, removed: boolean) => {
    const checklist = detail?.checklist;
    if (!checklist) return;
    setPendingKey(key);
    try {
      await api.setItemRemoved(checklist.id, key, removed);
      const next: ChecklistView = await api.checklist(checklist.id);
      setDetail((prev) => (prev ? { ...prev, checklist: next } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : '改清单失败');
    } finally {
      setPendingKey(null);
    }
  };

  const jumpToField = (fieldKey: string) => {
    setTab('form');
    setFlash(fieldKey);
    window.setTimeout(() => {
      const el = document.querySelector(`[data-fld="${fieldKey}"]`);
      if (el) el.scrollIntoView({ block: 'center' });
    }, 60);
    window.setTimeout(() => setFlash(null), 2000);
  };

  const markdown = useMemo(() => {
    if (!detail?.checklist || !currentSummary) return '';
    return buildChecklistMarkdown(detail.checklist, {
      name: detail.sheet.demandName,
      overview: currentSummary.overview,
      submitted: detail.sheet.submittedAt,
    });
  }, [detail, currentSummary]);

  if (!user) return <LoginView onLogin={onLogin} />;

  const checklist = detail?.checklist ?? null;
  const hasChecklist = !!checklist;

  return (
    <>
      <header className="top">
        <h1>设计需求解读台</h1>
        <span className="sub">桌面工作台</span>
        <span className="pill">公司内部 · 数据不出自有服务端</span>
        <div className="spacer" />
        <span className="pill">
          {user.name} · {user.role === 'admin' ? '管理员' : '设计师'}
        </span>
        <button type="button" className="btn ghost" id="btn-logout" onClick={logout}>
          退出
        </button>
      </header>

      <main className="layout">
        <aside className="side">
          <h2>需求单</h2>
          <div>
            {sheets.map((sheet) => (
              <button
                type="button"
                key={sheet.id}
                className={`dcard${sheet.id === currentId ? ' on' : ''}`}
                data-d={sheet.id}
                onClick={() => selectSheet(sheet.id)}
              >
                <div className="row1">
                  <span className="nm">{sheet.demandName}</span>
                  <span className={`st ${sheet.hasChecklist ? 'done' : 'wait'}`}>
                    {sheet.hasChecklist ? '已解读' : '待解读'}
                  </span>
                </div>
                <div className="ov">{sheet.overview}</div>
                <div className="mt">
                  <span>提交 {sheet.submittedAt}</span>
                  <span>完成度 {sheet.progress.percent}%</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="main" id="main">
          {!detail ? (
            <div className="card">
              <div className="empty-st">正在加载需求单…</div>
            </div>
          ) : (
            <>
              <div className="head">
                <div>
                  <h2>{detail.sheet.demandName}</h2>
                  <div className="meta">
                    <span>{currentSummary?.overview}</span>
                    <span>提交 {detail.sheet.submittedAt}</span>
                    <span>
                      推荐项完成度 {detail.progress.done}/{detail.progress.total}（{detail.progress.percent}%）
                    </span>
                  </div>
                </div>
                <div className="acts">
                  {hasChecklist ? (
                    <button type="button" className="btn" id="btn-replay" onClick={() => setDialog({ kind: 'outbound' })}>
                      重新解读
                    </button>
                  ) : (
                    <button type="button" className="btn primary" id="btn-gen" onClick={() => setDialog({ kind: 'outbound' })}>
                      开始解读
                    </button>
                  )}
                  {hasChecklist ? (
                    <button type="button" className="btn" id="btn-export" onClick={() => setDialog({ kind: 'export' })}>
                      导出清单
                    </button>
                  ) : null}
                </div>
              </div>

              {error ? <div className="warn">{error}</div> : null}

              <div className="tabs">
                <button
                  type="button"
                  className={`tab${tab === 'form' ? ' on' : ''}`}
                  data-tab="form"
                  onClick={() => setTab('form')}
                >
                  房主填写的表格
                </button>
                <button
                  type="button"
                  className={`tab${tab === 'under' ? ' on' : ''}`}
                  data-tab="under"
                  onClick={() => setTab('under')}
                >
                  表格理解
                  {detail.understanding.risks.length ? (
                    <span className="n">{detail.understanding.risks.length} 项风险</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  className={`tab${tab === 'list' ? ' on' : ''}`}
                  data-tab="list"
                  onClick={() => setTab('list')}
                >
                  量房沟通清单
                  {checklist ? <span className="n">{checklist.counts.total} 条</span> : null}
                </button>
              </div>

              {tab === 'form' ? (
                <FormView form={detail.form} aiMarks={detail.sheet.aiMarks} flash={flash} />
              ) : tab === 'under' ? (
                hasChecklist ? (
                  <UnderstandingPanel view={detail.understanding} />
                ) : (
                  <div className="card">
                    <div className="empty-st">
                      <div className="big">这份需求单还没有解读</div>
                      <div>
                        解读会调用模型，所以先过一道外发确认：哪些字段出门、脱敏后长什么样，都由你点头。
                      </div>
                      <div style={{ marginTop: 16 }}>
                        <button type="button" className="btn primary" id="btn-gen2" onClick={() => setDialog({ kind: 'outbound' })}>
                          开始解读
                        </button>
                      </div>
                    </div>
                  </div>
                )
              ) : checklist ? (
                <ChecklistPanel checklist={checklist} onToggle={toggleItem} onJump={jumpToField} pendingKey={pendingKey} />
              ) : (
                <div className="card">
                  <div className="empty-st">
                    <div className="big">还没有量房沟通清单</div>
                    <div>确认外发内容之后，清单会按空间排好，直接带去现场。</div>
                    <div style={{ marginTop: 16 }}>
                      <button type="button" className="btn primary" id="btn-gen3" onClick={() => setDialog({ kind: 'outbound' })}>
                        开始解读
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {dialog?.kind === 'outbound' && detail ? (
        <OutboundDialog
          detail={detail}
          history={history}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={confirmGenerate}
        />
      ) : null}
      {dialog?.kind === 'export' ? <ExportDialog markdown={markdown} onClose={() => setDialog(null)} /> : null}
    </>
  );
}
