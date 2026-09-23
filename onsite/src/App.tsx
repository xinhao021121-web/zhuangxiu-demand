/**
 * 现场端：选单 → 出门前过一遍 → 逐空间问 → 记一笔 / 没问上 → 量房记录（F7–F11）。
 *
 * 判断用领域包，数据先落本机：断网时看到的还是上一次同步下来的清单，记录攒着回有网再同步。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildSiteRecordMarkdown, siteStats } from '@zx/checklist';
import type { SiteRecord } from '@zx/checklist';
import type { User } from '@zx/contracts';
import { api, ApiError, DEMO_MODE, getToken, setToken } from './lib/api';
import * as store from './lib/store';
import type { CachedChecklist, LocalRecord } from './lib/store';

type Screen = 'list' | 'intro' | 'field' | 'summary';
type Overlay =
  | { kind: 'note'; itemKey: string; status: 'asked' | 'skip'; text: string }
  | { kind: 'spaces' }
  | { kind: 'end' }
  | null;

const TIER_NAME = { must: '必问', suggest: '建议问' } as const;
const SOURCE_NAME = { derived: '需求推导', survey: '通用核实', both: '需求推导 + 通用核实' } as const;
const SOURCE_CLASS = { derived: 'b-src-rule', survey: 'b-src-survey', both: 'b-src-both' } as const;
const QUICK_SKIP = ['房主不在现场', '现场条件不允许', '时间不够，回头再问', '要等物业或图纸'];
const QUICK_ASKED = ['房主确认可以', '现场条件不允许', '要回去核尺寸', '房主改了想法', '要加预算'];

interface SheetRow {
  id: string;
  demandName: string;
  overview: string;
  submittedAt: string;
  hasChecklist: boolean;
  checklistId: string | null;
}

const nowHM = () => new Date().toTimeString().slice(0, 5);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `r-${Date.now()}-${Math.random()}`);

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [cached, setCached] = useState<CachedChecklist[]>([]);
  const [sheets, setSheets] = useState<SheetRow[]>([]);
  const [records, setRecords] = useState<LocalRecord[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('list');
  const [space, setSpace] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [toast, setToast] = useState('');
  const [online, setOnline] = useState(true);
  const [error, setError] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const current = useMemo(() => cached.find((c) => c.id === currentId) ?? null, [cached, currentId]);
  const checklist = current?.checklist ?? null;
  const removed = useMemo(() => new Set(checklist?.removedKeys ?? []), [checklist]);
  const liveItems = useMemo(() => (checklist?.items ?? []).filter((i) => !removed.has(i.key)), [checklist, removed]);
  const myRecords = useMemo(
    () => records.filter((r) => (checklist ? r.checklistId === checklist.id : false)),
    [records, checklist],
  );
  const stats = useMemo(
    () => (checklist ? siteStats(checklist, myRecords as SiteRecord[]) : null),
    [checklist, myRecords],
  );
  const pending = useMemo(() => records.filter((r) => !r.synced), [records]);
  const statusOf = useCallback(
    (itemKey: string) => [...myRecords].reverse().find((r) => r.itemKey === itemKey),
    [myRecords],
  );
  const spaces = useMemo(() => {
    if (!checklist) return [];
    return checklist.groups
      .filter((g) => g.items.some((i) => !removed.has(i.key)))
      .map((g) => g.space);
  }, [checklist, removed]);

  const say = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 1700);
  }, []);

  /** 把攒在本机的记录推回服务端；没网就留着。 */
  const sync = useCallback(async () => {
    const unsynced = records.filter((r) => !r.synced);
    if (!unsynced.length) return 0;
    const byChecklist = new Map<string, LocalRecord[]>();
    unsynced.forEach((r) => {
      const list = byChecklist.get(r.checklistId) ?? [];
      list.push(r);
      byChecklist.set(r.checklistId, list);
    });
    let syncedCount = 0;
    for (const [checklistId, list] of byChecklist) {
      try {
        await api.pushRecords(
          checklistId,
          list.map((r) => ({
            id: r.id,
            demandSheetId: r.demandSheetId,
            checklistId: r.checklistId,
            itemKey: r.itemKey,
            status: r.status,
            note: r.note,
            at: r.at,
            operator: user?.name ?? '',
          })),
        );
        await store.markSynced(list.map((r) => r.id));
        syncedCount += list.length;
      } catch {
        // 还是没网：留着下次
      }
    }
    if (syncedCount) {
      setRecords(await store.allRecords());
      say(`已同步 ${syncedCount} 条记录`);
    }
    return syncedCount;
  }, [records, say, user]);

  /** 在线时把服务端的清单拉下来存本机：现场断网了还看得到（F10）。 */
  const refreshFromServer = useCallback(async () => {
    const list = await api.sheets();
    setSheets(
      list.map((s) => ({
        id: s.id,
        demandName: s.demandName,
        overview: s.overview,
        submittedAt: s.submittedAt,
        hasChecklist: s.hasChecklist,
        checklistId: s.checklistId,
      })),
    );
    for (const sheet of list) {
      if (!sheet.checklistId) continue;
      const summary = await api.summaryOf(sheet.checklistId);
      await store.cacheChecklist({
        id: summary.checklist.id,
        demandSheetId: summary.demandSheetId,
        demandName: summary.demandName,
        overview: summary.overview,
        submittedAt: summary.submittedAt,
        checklist: summary.checklist,
        fieldValues: summary.fieldValues,
        cachedAt: new Date().toISOString(),
      });
    }
    setCached(await store.cachedChecklists());
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    const boot = async () => {
      setUser((await store.getMeta<User>('user')) ?? null);
      setCached(await store.cachedChecklists());
      setRecords(await store.allRecords());
      if (!getToken()) return;
      try {
        await refreshFromServer();
      } catch {
        setSheets(
          (await store.cachedChecklists()).map((c) => ({
            id: c.demandSheetId,
            demandName: c.demandName,
            overview: c.overview,
            submittedAt: c.submittedAt,
            hasChecklist: true,
            checklistId: c.id,
          })),
        );
      }
    };
    void boot();
  }, [refreshFromServer]);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      say('回到在线，正在同步现场记录');
    };
    const goOffline = () => {
      setOnline(false);
      say('已切到离线：记录只存在这台手机上');
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [say]);

  useEffect(() => {
    if (!online || !user) return;
    void sync();
    // 只在「刚回到在线」时同步一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, user]);

  const afterNav = (next: Screen) => {
    setScreen(next);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  };

  const onLogin = async (next: User, token: string) => {
    setToken(token);
    await store.setMeta('user', next);
    setUser(next);
    try {
      await refreshFromServer();
    } catch {
      // 没网也能进：用的是本机缓存的清单
    }
  };

  const logout = async () => {
    setToken(null);
    await store.setMeta('user', null);
    setUser(null);
    setCurrentId(null);
    afterNav('list');
  };

  const openSheet = async (row: SheetRow) => {
    if (!row.checklistId) {
      say(`${row.demandName} 的清单还在电脑上，先解读再来现场`);
      return;
    }
    let target = await store.cachedChecklist(row.checklistId);
    if (online) {
      try {
        const summary = await api.summaryOf(row.checklistId);
        target = {
          id: summary.checklist.id,
          demandSheetId: summary.demandSheetId,
          demandName: summary.demandName,
          overview: summary.overview,
          submittedAt: summary.submittedAt,
          checklist: summary.checklist,
          fieldValues: summary.fieldValues,
          cachedAt: new Date().toISOString(),
        };
        await store.cacheChecklist(target);
        setCached(await store.cachedChecklists());
      } catch (err) {
        if (!target) {
          setError(err instanceof Error ? err.message : '取清单失败');
          return;
        }
      }
    }
    if (!target) {
      setError('这台手机上还没有这份清单，先联网同步一次');
      return;
    }
    setError('');
    setCurrentId(target.id);
    const first = target.checklist.groups.find((g) =>
      g.items.some((i) => !new Set(target!.checklist.removedKeys).has(i.key)),
    );
    setSpace(first?.space ?? '');
    afterNav('intro');
  };
  /** 写一条记录：先落本机，再尽力同步。 */
  const writeRecord = async (itemKey: string, status: 'asked' | 'skip', note: string) => {
    if (!checklist || !current) return;
    const record: LocalRecord = {
      id: uuid(),
      demandSheetId: current.demandSheetId,
      checklistId: checklist.id,
      itemKey,
      status,
      note,
      at: nowHM(),
      synced: false,
    };
    await store.putRecord(record);
    setRecords(await store.allRecords());
    if (!online) {
      say('已存在这台手机上，联网后自动同步');
      return;
    }
    try {
      await api.pushRecords(checklist.id, [
        {
          id: record.id,
          demandSheetId: record.demandSheetId,
          checklistId: record.checklistId,
          itemKey,
          status,
          note,
          at: record.at,
          operator: user?.name ?? '',
        },
      ]);
      await store.markSynced([record.id]);
      setRecords(await store.allRecords());
      say(status === 'asked' ? '已记录，回来照着这条定方案' : '已记下原因，回公司判断要不要补问');
    } catch {
      say('没同步上，先存在这台手机上');
    }
  };

  const moveSpace = (dir: number) => {
    const index = spaces.indexOf(space);
    const next = index + dir;
    if (next < 0) {
      say('已经是第一个空间');
      return;
    }
    if (next >= spaces.length) {
      askEnd();
      return;
    }
    setSpace(spaces[next]);
    setOverlay(null);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  };

  /** 结束前先拦住没落的必问：这是现场最不该漏的部分。 */
  const askEnd = () => {
    if (stats?.mustOpen.length) {
      setOverlay({ kind: 'end' });
      return;
    }
    afterNav('summary');
  };

  /** 速记：和桌面端导出用的是同一个领域函数。 */
  const recordMarkdown = () =>
    checklist && current
      ? buildSiteRecordMarkdown(checklist, myRecords as SiteRecord[], {
          name: current.demandName,
          overview: current.overview,
          submitted: current.submittedAt,
        })
      : '';

  if (!user) {
    return (
      <div className="phone">
        <LoginView onLogin={onLogin} />
      </div>
    );
  }

  const rows: SheetRow[] = sheets.length
    ? sheets
    : cached.map((c) => ({
        id: c.demandSheetId,
        demandName: c.demandName,
        overview: c.overview,
        submittedAt: c.submittedAt,
        hasChecklist: true,
        checklistId: c.id,
      }));

  const netButton = (
    <button
      type="button"
      className={`net${online ? '' : ' off'}`}
      id="net"
      onClick={() => {
        // 现场信号不稳时给一个手动开关：切到离线就只写本机
        window.dispatchEvent(new Event(online ? 'offline' : 'online'));
      }}
    >
      {online ? '● 在线' : '● 离线'}
    </button>
  );

  const bar = () => {
    if (screen === 'list') {
      return (
        <div className="bar">
          <div className="tt">
            <b>现场量房</b>
            <span>{DEMO_MODE ? '演示数据 · 在浏览器里跑，未接服务端' : '选今天要去的这一家'}</span>
          </div>
          <div className="right">{netButton}</div>
        </div>
      );
    }
    const title = screen === 'field' ? space : screen === 'summary' ? '量房记录' : (current?.demandName ?? '');
    const sub =
      screen === 'field'
        ? `共 ${liveItems.length} 条 · 按空间走`
        : screen === 'summary'
          ? `${current?.demandName ?? ''} · 今天现场`
          : '出门前看一眼';
    const back = screen === 'field' ? 'intro' : 'list';
    return (
      <div className="bar">
        <button type="button" className="bk" data-nav={back} onClick={() => afterNav(back)}>
          ‹
        </button>
        <div className="tt">
          <b>{title}</b>
          <span>{sub}</span>
        </div>
        <div className="right">
          {netButton}
          {screen === 'field' ? (
            <button type="button" className="endbtn" id="end" onClick={askEnd}>
              结束
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  const foot = () => {
    if (screen === 'list' || screen === 'summary') return null;
    if (screen === 'intro') {
      return (
        <div className="foot">
          <button type="button" className="btn primary" id="go" onClick={() => afterNav('field')}>
            {(stats?.asked ?? 0) > 0 ? '继续量房' : '开始量房'}
          </button>
        </div>
      );
    }
    const last = spaces[spaces.length - 1] === space;
    return (
      <div className="foot">
        <button type="button" className="btn side" id="prev" onClick={() => moveSpace(-1)}>
          ‹ 上一个
        </button>
        <button type="button" className="btn primary" id="next" onClick={() => moveSpace(1)}>
          {last ? '完成量房' : '下一个空间 ›'}
        </button>
      </div>
    );
  };
  return (
    <div className="phone">
      {bar()}
      <div className="body" ref={bodyRef}>
        {screen === 'list' ? (
          <>
            <div className={`syncbar ${online ? 'ok' : 'off'}`}>
              {online ? '在线：现场记录会直接同步回公司' : '离线：记录先存在这台手机上，回到有网的地方再同步'}
            </div>
            {error ? <div className="syncbar off">{error}</div> : null}
            {rows.map((row) => {
              const cachedRow = row.checklistId ? cached.find((c) => c.id === row.checklistId) : undefined;
              const rowStats = cachedRow
                ? siteStats(cachedRow.checklist, records.filter((r) => r.checklistId === cachedRow.id) as SiteRecord[])
                : null;
              return (
                <button type="button" key={row.id} className="dc" data-d={row.id} onClick={() => void openSheet(row)}>
                  <div className="r1">
                    <span className="nm">{row.demandName}</span>
                    <span className={`st ${row.hasChecklist ? 'done' : 'wait'}`}>
                      {row.hasChecklist ? '清单已生成' : '待解读'}
                    </span>
                  </div>
                  <div className="ov">{row.overview}</div>
                  <div className="mt">
                    <span>提交 {row.submittedAt}</span>
                    {rowStats ? (
                      <span>
                        已问 {rowStats.asked} / 共 {rowStats.total} 条
                      </span>
                    ) : (
                      <span>先在电脑上生成清单</span>
                    )}
                  </div>
                </button>
              );
            })}
            {pending.length ? <div className="syncbar off">{pending.length} 条记录还没同步</div> : null}
            <div className="empty" style={{ padding: '12px 0 0' }}>
              <button
                type="button"
                className="hint"
                id="logout"
                style={{ justifyContent: 'center', width: '100%' }}
                onClick={() => void logout()}
              >
                退出登录（{user.name}）
              </button>
            </div>
          </>
        ) : screen === 'intro' && current && stats ? (
          <>
            <div className="card">
              <div style={{ fontSize: 17.5, fontWeight: 600 }}>{current.demandName}</div>
              <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 5 }}>{current.overview}</div>
              <div style={{ fontSize: 12, color: 'var(--dim2)', marginTop: 4 }}>提交 {current.submittedAt}</div>
            </div>
            <div className="stats">
              <div className="stat">
                <b>{stats.must}</b>
                <span>必问</span>
              </div>
              <div className="stat">
                <b>{stats.total - stats.must}</b>
                <span>建议问</span>
              </div>
              <div className="stat">
                <b>{stats.total}</b>
                <span>共</span>
              </div>
            </div>
            <div className="card">
              <h3>
                现场进度
                <span className="cnt">
                  已问 {stats.asked} / {stats.total}
                </span>
              </h3>
              <div className="pg">
                <i style={{ width: `${stats.total ? Math.round((stats.asked / stats.total) * 100) : 0}%` }} />
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--dim)', marginTop: 9, lineHeight: 1.7 }}>
                按现场动线走：先进门核结构与尺寸，再一个空间一个空间问。每条问完点「已问」，没问上的记一句，回来再补。
              </div>
            </div>
            {stats.mustOpen.length ? (
              <div className="card">
                <h3>出门前先记这几条</h3>
                {stats.mustOpen.slice(0, 3).map((item) => (
                  <div className="srow" key={item.key}>
                    <div className="qq">
                      <b>{item.question}</b>
                      <span>{item.space} · 还没问到</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : screen === 'field' && current && stats ? (
          <>
            <div className="card" style={{ padding: '12px 13px' }}>
              <button type="button" className="prow" id="spaces" onClick={() => setOverlay({ kind: 'spaces' })}>
                <span className="pname">{space}</span>
                <span className="pidx">
                  {spaces.indexOf(space) + 1} / {spaces.length}
                </span>
                <span className="pmust">
                  必问 已问 {stats.mustAsked} / {stats.must}
                </span>
                <span className="pgo">换空间 ▾</span>
              </button>
              <div className="pg">
                <i style={{ width: `${stats.must ? Math.round((stats.mustAsked / stats.must) * 100) : 0}%` }} />
              </div>
            </div>
            {pending.length ? <div className="syncbar off">离线中：{pending.length} 条记录还没同步</div> : null}
            {liveItems
              .filter((item) => item.space === space)
              .map((item) => {
                const record = statusOf(item.key);
                const isOpen = !!open[item.key];
                const context = item.relatedFields
                  .map((fieldKey) => current.fieldValues[fieldKey])
                  .filter((v) => v && v.value)
                  .map((v) => `${v.label}：${v.value}`)
                  .join('　');
                return (
                  <div
                    className={`task${record ? (record.status === 'asked' ? ' asked' : ' skip') : ''}`}
                    key={item.key}
                    data-key={item.key}
                  >
                    <div className="tr">
                      <span className={`badge ${item.tier === 'must' ? 'b-must' : 'b-sug'}`}>{TIER_NAME[item.tier]}</span>
                      <span className={`badge ${SOURCE_CLASS[item.source]}`}>{SOURCE_NAME[item.source]}</span>
                      {record && !record.synced ? <span className="badge b-wait">待同步</span> : null}
                      {record ? (
                        <span className={`mark ${record.status === 'asked' ? 'asked' : 'skip'}`}>
                          {record.status === 'asked' ? '已问' : '没问上'}
                        </span>
                      ) : null}
                    </div>
                    <div className="q" onClick={() => setOpen((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}>
                      {item.question}
                    </div>
                    {isOpen ? (
                      <div className="det">
                        <div className="row">
                          <b>为什么问　</b>
                          {item.why}
                        </div>
                        <div className="row">
                          <b>现场要核实　</b>
                          {item.onsiteChecks.join('；')}
                        </div>
                        {context ? (
                          <div className="row">
                            <b>房主填的　</b>
                            {context}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="hint" onClick={() => setOpen((prev) => ({ ...prev, [item.key]: true }))}>
                        点一下看依据 ▾
                      </div>
                    )}
                    {record?.note ? (
                      <div className={`note${record.status === 'skip' ? ' skip' : ''}`}>{record.note}</div>
                    ) : null}
                    <div className="acts">
                      {record ? (
                        <>
                          <button
                            type="button"
                            className="act undo"
                            data-a="undo"
                            onClick={async () => {
                              await store.deleteRecord(record.id);
                              setRecords(await store.allRecords());
                            }}
                          >
                            撤销
                          </button>
                          <button
                            type="button"
                            className="act"
                            data-a="note"
                            onClick={() =>
                              setOverlay({ kind: 'note', itemKey: item.key, status: record.status, text: record.note })
                            }
                          >
                            {record.status === 'skip' ? '改原因' : '改结论'}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="act"
                            data-a="skip"
                            onClick={() => setOverlay({ kind: 'note', itemKey: item.key, status: 'skip', text: '' })}
                          >
                            没问上
                          </button>
                          <button
                            type="button"
                            className="act"
                            data-a="note"
                            onClick={() => setOverlay({ kind: 'note', itemKey: item.key, status: 'asked', text: '' })}
                          >
                            记一笔
                          </button>
                          <button
                            type="button"
                            className="act main"
                            data-a="asked"
                            onClick={() => void writeRecord(item.key, 'asked', '')}
                          >
                            已问
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
          </>
        ) : screen === 'summary' && current && stats ? (
          <>
            <div className="stats">
              <div className="stat">
                <b>{stats.asked}</b>
                <span>已问</span>
              </div>
              <div className="stat">
                <b>{stats.skip}</b>
                <span>没问上</span>
              </div>
              <div className="stat">
                <b>{stats.left}</b>
                <span>还没问到</span>
              </div>
            </div>
            <div className={`syncbar ${pending.length ? 'off' : 'ok'}`}>
              {pending.length
                ? `${pending.length} 条记录还存在这台手机上，联网后自动同步`
                : '记录已同步回公司'}
            </div>
            <div className="card">
              <h3>{stats.mustOpen.length ? `必问里还有 ${stats.mustOpen.length} 条没落` : '必问都问到了'}</h3>
              {stats.mustOpen.length ? (
                stats.mustOpen.map((item) => (
                  <div className="srow" key={item.key}>
                    <div className="qq">
                      <b>{item.question}</b>
                      <span>
                        {item.space}
                        {statusOf(item.key)?.status === 'skip' ? ' · 没问上' : ' · 还没问到'}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ fontSize: 12.5, color: 'var(--dim)' }}>可以回去定方案方向了。</div>
              )}
            </div>
            {current.checklist.groups.map((group) => {
              const withRecord = group.items.filter((i) => !removed.has(i.key) && statusOf(i.key));
              if (!withRecord.length) return null;
              return (
                <div key={group.space}>
                  <div className="grp">
                    {group.space}　{withRecord.length} 条有记录
                  </div>
                  {withRecord.map((item) => {
                    const record = statusOf(item.key)!;
                    return (
                      <div className="card" key={item.key} style={{ padding: '11px 13px', marginBottom: 8 }}>
                        <span className={`tagline ${record.status === 'asked' ? 'asked' : 'skip'}`}>
                          {record.status === 'asked' ? '已问' : '没问上'}
                        </span>
                        <div className="q" style={{ fontSize: 14.5 }}>
                          {item.question}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--dim)', marginTop: 5, lineHeight: 1.6 }}>
                          {record.note || '只标了状态，没记内容'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <div className="card" style={{ marginTop: 12 }}>
              <h3>带回公司的速记</h3>
              <pre className="md">{recordMarkdown()}</pre>
              <div className="sf">
                <button
                  type="button"
                  className="btn"
                  id="copy"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(recordMarkdown());
                    } catch {
                      // 剪贴板不可用就算了
                    }
                    say('速记已复制');
                  }}
                >
                  复制速记
                </button>
                <button type="button" className="btn primary" data-nav="list" onClick={() => afterNav('list')}>
                  回到列表
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty">正在加载…</div>
        )}
      </div>
      {foot()}
      {overlay ? (
        <>
          <div className="mask" id="mask" onClick={() => setOverlay(null)} />
          <div className="sheet" id="sheet">
            {overlay.kind === 'note' ? (
              <NoteSheet
                overlay={overlay}
                question={checklist?.items.find((i) => i.key === overlay.itemKey)?.question ?? ''}
                setOverlay={setOverlay}
                onSave={writeRecord}
              />
            ) : null}
            {overlay.kind === 'spaces' ? (
              <SpacesSheet
                spaces={spaces}
                current={space}
                checklist={current?.checklist ?? null}
                records={myRecords}
                onPick={(name) => {
                  setSpace(name);
                  setOverlay(null);
                }}
                onClose={() => setOverlay(null)}
              />
            ) : null}
            {overlay.kind === 'end' ? (
              <EndSheet
                mustOpen={stats?.mustOpen ?? []}
                statusOf={statusOf}
                onClose={() => setOverlay(null)}
                onConfirm={() => {
                  setOverlay(null);
                  afterNav('summary');
                }}
              />
            ) : null}
          </div>
        </>
      ) : null}
      <div className={`toast${toast ? ' on' : ''}`} id="toast">
        {toast}
      </div>
    </div>
  );
}

/** 现场速记：用领域包的同一份拼装逻辑，和桌面端导出的清单是同一套判据。 */
interface NoteSheetProps {
  overlay: Extract<Overlay, { kind: 'note' }>;
  question: string;
  setOverlay: (value: Overlay) => void;
  onSave: (itemKey: string, status: 'asked' | 'skip', note: string) => Promise<void>;
}

/** 「记一笔」与「没问上」共用同一个抽屉：差别只在文案与保存后标成什么（F9）。 */
function NoteSheet({ overlay, question, setOverlay, onSave }: NoteSheetProps) {
  const [text, setText] = useState(overlay.text);
  const skip = overlay.status === 'skip';
  const quick = skip ? QUICK_SKIP : QUICK_ASKED;
  return (
    <>
      <h4>{skip ? '记一句原因 · 保存后标成没问上' : '记一笔 · 保存后标成已问'}</h4>
      <div className="sq">{question}</div>
      <div className="chips">
        {quick.map((t) => (
          <button
            type="button"
            className="chip"
            data-chip={t}
            key={t}
            onClick={() => {
              const value = text.replace(/[；;]\s*$/, '');
              setText((value ? `${value}；` : '') + t);
            }}
          >
            {t}
          </button>
        ))}
      </div>
      <textarea
        data-draft
        value={text}
        placeholder={skip ? '为什么没问上，回公司好判断要不要补问' : '一句话结论，回公司照着这条定方案'}
        onChange={(e) => {
          setText(e.target.value);
          setOverlay({ ...overlay, text: e.target.value });
        }}
      />
      <div className="sf">
        <button type="button" className="btn" id="sh-cancel" onClick={() => setOverlay(null)}>
          取消
        </button>
        <button
          type="button"
          className="btn primary"
          id="sh-save"
          onClick={async () => {
            await onSave(overlay.itemKey, overlay.status, text.trim());
            setOverlay(null);
          }}
        >
          {skip ? '保存并标记没问上' : '保存并标记已问'}
        </button>
      </div>
    </>
  );
}

interface SpacesSheetProps {
  spaces: string[];
  current: string;
  checklist: CachedChecklist['checklist'] | null;
  records: LocalRecord[];
  onPick: (name: string) => void;
  onClose: () => void;
}

function SpacesSheet({ spaces, current, checklist, records, onPick, onClose }: SpacesSheetProps) {
  const removed = new Set(checklist?.removedKeys ?? []);
  const latest = new Map<string, LocalRecord>();
  records.forEach((r) => latest.set(r.itemKey, r));
  return (
    <>
      <h4>换一个空间</h4>
      {spaces.map((name) => {
        const items = (checklist?.items ?? []).filter((i) => i.space === name && !removed.has(i.key));
        const asked = items.filter((i) => latest.get(i.key)?.status === 'asked').length;
        const must = items.filter((i) => i.tier === 'must');
        const mustAsked = must.filter((i) => latest.get(i.key)?.status === 'asked').length;
        const tail =
          must.length && mustAsked < must.length
            ? `必问还剩 ${must.length - mustAsked} 条`
            : `已问 ${asked} / ${items.length}`;
        return (
          <button
            type="button"
            className={`rowbtn${name === current ? ' on' : ''}`}
            data-s={name}
            key={name}
            onClick={() => onPick(name)}
          >
            <span className="rn">{name}</span>
            <span className="rs">{tail}</span>
            {name === current ? <span className="rc">当前</span> : null}
          </button>
        );
      })}
      <div className="sf">
        <button type="button" className="btn" id="sh-cancel" onClick={onClose}>
          关闭
        </button>
      </div>
    </>
  );
}

interface EndSheetProps {
  mustOpen: { key: string; question: string; space: string }[];
  statusOf: (key: string) => LocalRecord | undefined;
  onClose: () => void;
  onConfirm: () => void;
}

function EndSheet({ mustOpen, statusOf, onClose, onConfirm }: EndSheetProps) {
  return (
    <>
      <h4>结束量房</h4>
      <div className="sq">必问里还有 {mustOpen.length} 条没落</div>
      <div className="ctx">
        {mustOpen.map((item) => (
          <div key={item.key}>
            · {item.question}
            <span style={{ color: 'var(--dim2)' }}>
              （{item.space}
              {statusOf(item.key)?.status === 'skip' ? ' · 没问上' : ''}）
            </span>
          </div>
        ))}
      </div>
      <div className="sf">
        <button type="button" className="btn" id="sh-cancel" onClick={onClose}>
          继续问
        </button>
        <button type="button" className="btn primary" id="sh-end" onClick={onConfirm}>
          结束并看记录
        </button>
      </div>
    </>
  );
}

function LoginView({ onLogin }: { onLogin: (user: User, token: string) => Promise<void> | void }) {
  const [phone, setPhone] = useState('13800000002');
  const [code, setCode] = useState('000000');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="login"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError('');
        try {
          const result = await api.login(phone, code);
          await onLogin(result.user, result.token);
        } catch (err) {
          setError(err instanceof ApiError ? err.message : '登录失败');
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1>现场量房</h1>
      <p>公司内部工具。登录后按空间逐条走清单，记一句话结论，没网也能记。</p>
      <label htmlFor="phone">手机号</label>
      <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <label htmlFor="code">验证码</label>
      <input id="code" value={code} onChange={(e) => setCode(e.target.value)} />
      {error ? <p className="err">{error}</p> : null}
      <button type="submit" className="btn primary" disabled={busy} style={{ width: '100%' }}>
        {busy ? '正在登录…' : '登录'}
      </button>
    </form>
  );
}
