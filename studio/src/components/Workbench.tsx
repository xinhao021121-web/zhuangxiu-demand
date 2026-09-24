'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildChecklistMarkdown } from '@zx/checklist';
import type {
  ChecklistView,
  DemandSheetDetail,
  DemandSheetSummary,
  Omission,
  OmissionCreate,
  OutboundRecordContract,
  Reports,
  User,
} from '@zx/contracts';
import { api, ApiError, DEMO_MODE, getToken, setToken } from '../lib/api';
import { ChecklistPanel } from './ChecklistPanel';
import { ExportDialog, OutboundDialog, RenameDialog } from './Dialogs';
import { FormView } from './FormView';
import { LoginView } from './Login';
import { OmissionPanel } from './OmissionPanel';
import { ReportsView } from './ReportsView';
import { UnderstandingPanel } from './UnderstandingPanel';

type Tab = 'form' | 'under' | 'list';
type Dialog = { kind: 'outbound' } | { kind: 'export' } | { kind: 'rename' } | null;
/** 主区两种视图：某一份需求单，或整条链路的回流报表 */
type View = 'sheet' | 'reports';

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
  const [view, setView] = useState<View>('sheet');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  /** 外发记录：生成前给设计师看一眼上次发了什么（F3 的事后可查） */
  const [history, setHistory] = useState<OutboundRecordContract[]>([]);
  /** 这份需求单补录过的遗漏（新的在前） */
  const [omissions, setOmissions] = useState<Omission[]>([]);
  const [reports, setReports] = useState<Reports | null>(null);
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

  const reloadOmissions = useCallback(async (id: string) => {
    try {
      setOmissions(await api.omissions(id));
    } catch {
      setOmissions([]);
    }
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
    void reloadOmissions(currentId);
  }, [currentId, reloadDetail, reloadHistory, reloadOmissions]);

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
    setView('sheet');
    setFlash(null);
    setError('');
  };

  /** 改名：只动叫法，房主填的内容一个字不变（技术方案 5.3 的待定项 9）。 */
  const renameSheet = async (demandName: string) => {
    if (!currentId) return;
    setBusy(true);
    try {
      await api.renameSheet(currentId, demandName);
      await reloadSheets();
      await reloadDetail(currentId);
      setDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '改名失败');
    } finally {
      setBusy(false);
    }
  };

  /** 遗漏补录：落一条 omission_log，台账立刻回来（补录不回溯改历史）。 */
  const addOmission = async (input: OmissionCreate) => {
    if (!currentId) return;
    setBusy(true);
    try {
      setOmissions(await api.addOmission(currentId, input));
    } catch (err) {
      setError(err instanceof Error ? err.message : '补录失败');
    } finally {
      setBusy(false);
    }
  };

  const openReports = async () => {
    setBusy(true);
    try {
      setReports(await api.reports());
      setView('reports');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '取报表失败');
    } finally {
      setBusy(false);
    }
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
        <h1>问需 · 解读</h1>
        <span className="sub">桌面工作台</span>
        {DEMO_MODE ? (
          <span className="pill" id="demo-pill">演示数据 · 在浏览器里跑，未接服务端</span>
        ) : (
          <span className="pill">公司内部 · 数据不出自有服务端</span>
        )}
        <div className="spacer" />
        <button type="button" className="btn ghost" id="btn-reports" onClick={openReports}>
          回流报表
        </button>
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
          {view === 'reports' && reports ? (
            <ReportsView reports={reports} onClose={() => setView('sheet')} />
          ) : !detail ? (
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
                    <span>{detail.sheet.source === 'miniapp' ? '房主端提交' : '文件导入'}</span>
                  </div>
                </div>
                <div className="acts">
                  <button type="button" className="btn" id="btn-rename" onClick={() => setDialog({ kind: 'rename' })}>
                    改名
                  </button>
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
                <>
                  <ChecklistPanel checklist={checklist} onToggle={toggleItem} onJump={jumpToField} pendingKey={pendingKey} />
                  <OmissionPanel
                    spaces={checklist.groups.map((g) => g.space)}
                    omissions={omissions}
                    busy={busy}
                    onAdd={addOmission}
                  />
                </>
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
      {dialog?.kind === 'rename' && detail ? (
        <RenameDialog
          current={detail.sheet.demandName}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={renameSheet}
        />
      ) : null}
    </>
  );
}
