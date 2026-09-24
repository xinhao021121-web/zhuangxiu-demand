'use client';

import { useState } from 'react';
import { DemandSheetImportSchema } from '@zx/contracts';
import type { DemandSheetDetail, DemandSheetImport, OutboundRecordContract } from '@zx/contracts';

function Shell({
  title,
  children,
  footer,
  onMask,
}: {
  title: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  onMask: () => void;
}) {
  return (
    <>
      <div className="mask" id="mask" onClick={onMask} />
      <div className="modal" id="modal" role="dialog" aria-label={title}>
        <div className="mh">
          <h3>{title}</h3>
        </div>
        <div className="mb">{children}</div>
        <div className="mf">{footer}</div>
      </div>
    </>
  );
}

function Group({
  tier,
  title,
  hint,
  children,
}: {
  tier: string;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="sgroup" data-tier={tier}>
      <div className="gh">
        {title}
        <span className="why">{hint}</span>
      </div>
      <div className="gb">{children ?? <span style={{ color: 'var(--dim2)' }}>无</span>}</div>
    </div>
  );
}

/**
 * 外发前逐条确认（F3）：确认对象是脱敏之后、真正要外发的内容。
 *
 * 自由文本默认不勾选——它是唯一可能夹带姓名的类别，而人名无法自动识别，
 * 所以这个类别要设计师主动判断（产品文档 7.4）。
 */
export function OutboundDialog({
  detail,
  history,
  busy,
  onCancel,
  onConfirm,
}: {
  detail: DemandSheetDetail;
  /** 外发记录：谁、什么时候、发了哪些字段、用的哪版策略 */
  history: OutboundRecordContract[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (selected: Record<string, boolean>) => void;
}) {
  const groups = detail.outboundPreview;
  const [selected, setSelected] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    groups.forEach((group) =>
      group.rows.forEach((row) => {
        if (row.selectable) init[row.fieldKey] = row.selected;
      }),
    );
    return init;
  });

  const freeText = groups.find((g) => g.tier === 'free-text')?.rows ?? [];
  const unselectedFree = freeText.filter((row) => !selected[row.fieldKey]).length;
  const toggle = (key: string) => setSelected((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <Shell
      title={`外发前确认 · ${detail.sheet.demandName}`}
      onMask={onCancel}
      footer={
        <>
          <span className="hint">未勾选的 {unselectedFree} 条自由文本不会参与解读</span>
          <div className="spacer" />
          <button type="button" className="btn" id="send-cancel" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            id="send-ok"
            disabled={busy}
            onClick={() => onConfirm(selected)}
          >
            {busy ? '正在生成…' : '确认并生成'}
          </button>
        </>
      }
    >
      <div className="note">
        本次生效：默认合规策略 v1 · 不外发 / 泛化后外发 / 原样外发三级策略 · 自由文本默认不勾选 ·
        可按公司合规要求调整
        {history.length ? (
          <>
            <br />
            上次外发：{history[0].policyName} {history[0].policyVersion} · 外发 {history[0].fieldKeys.length}{' '}
            个字段 · {history[0].operator} · {history[0].at}
          </>
        ) : null}
      </div>
      {groups.map((group) => (
        <Group key={group.tier} tier={group.tier} title={group.title} hint={group.hint}>
          {group.rows.length ? (
            group.rows.map((row) => (
              <div className="sline" key={row.fieldKey}>
                {row.selectable ? (
                  <input
                    type="checkbox"
                    data-send={row.fieldKey}
                    checked={!!selected[row.fieldKey]}
                    onChange={() => toggle(row.fieldKey)}
                    aria-label={row.label}
                  />
                ) : (
                  <span style={{ width: 13 }} />
                )}
                <span className="k">{row.label}</span>
                <span className="v">
                  {row.value}
                  {row.hits.length ? (
                    <>
                      　
                      <span className="redact">
                        原文含：{[...new Set(row.hits.map((h) => h.label))].join('、')}（已隐去）
                      </span>
                    </>
                  ) : null}
                </span>
              </div>
            ))
          ) : (
            <span style={{ color: 'var(--dim2)' }}>无</span>
          )}
        </Group>
      ))}
    </Shell>
  );
}

export function ExportDialog({ markdown, onClose }: { markdown: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Shell
      title="导出量房沟通清单"
      onMask={onClose}
      footer={
        <>
          <span className="hint">导出的是当前清单，删减过的条目不会出现</span>
          <div className="spacer" />
          <button type="button" className="btn" id="exp-ok" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="btn primary" id="exp-copy" onClick={copy}>
            {copied ? '已复制' : '复制 Markdown'}
          </button>
        </>
      }
    >
      <pre className="md">{markdown}</pre>
    </Shell>
  );
}

/**
 * 改名：采集端不收集房主姓名，房主提交的需求单落库叫「未命名需求单」，
 * 设计师在桌面端改成认得出的叫法（技术方案 5.3 的待定项 9 收敛为「桌面端加改名」）。
 *
 * 只动名字：房主填的内容一个字都不动，也不留「原名」——名字是给设计师看的分类，
 * 不是这份数据的一部分。
 */
export function RenameDialog({
  current,
  busy,
  onCancel,
  onConfirm,
}: {
  current: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (demandName: string) => void;
}) {
  const [name, setName] = useState(current);
  const trimmed = name.trim();
  return (
    <Shell
      title="给这份需求单改个叫法"
      onMask={onCancel}
      footer={
        <>
          <span className="hint">只改叫法，房主填的内容不变</span>
          <div className="spacer" />
          <button type="button" className="btn" id="rn-cancel" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            id="rn-ok"
            disabled={busy || !trimmed}
            onClick={() => onConfirm(trimmed)}
          >
            保存
          </button>
        </>
      }
    >
      <label className="field">
        <span className="lbl">需求单叫法</span>
        <input
          id="rn-name"
          value={name}
          maxLength={40}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && trimmed) onConfirm(trimmed);
          }}
        />
      </label>
      <div className="note">
        建议写「称呼 + 户型或小区」这类能认出来的叫法，例如「张先生 · 89㎡ 老房翻新」。
      </div>
    </Shell>
  );
}

/**
 * 文件导入（产品文档 F1、5.1）：采集端导出的 JSON 与云端提交是同一份契约的两种输入方式。
 *
 * 校验用契约本身（`DemandSheetImportSchema`）在浏览器里先过一遍：粘错了、少一块，
 * 当场说清是哪一处不对，不用等一次往返。服务端仍然会再校验一次——两边认的是同一份 schema。
 */
export function ImportDialog({
  busy,
  error,
  onCancel,
  onImport,
}: {
  busy: boolean;
  /** 服务端拒绝时的原话：契约校验通过、但服务端不认（例如同时被别处导入过） */
  error: string;
  onCancel: () => void;
  onImport: (input: DemandSheetImport) => void;
}) {
  const [raw, setRaw] = useState('');
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState('');

  const read = (json: unknown): DemandSheetImport | null => {
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      setLocalError(
        Array.isArray(json)
          ? '这是一组需求单：一次导入一份，把其中一份的 JSON 复制过来'
          : '这段 JSON 不是一个对象',
      );
      return null;
    }
    // 叫法优先用填的；没填就保留文件里的，再没有就是契约默认的「未命名需求单」
    const parsed = DemandSheetImportSchema.safeParse(
      name.trim() ? { ...json, demandName: name.trim() } : json,
    );
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue.path.length ? issue.path.join('.') : '（根）';
      setLocalError(`这份需求单对不上契约：${where} ${issue.message}`);
      return null;
    }
    setLocalError('');
    return parsed.data;
  };

  const submit = () => {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      setLocalError('这段不是合法的 JSON');
      return;
    }
    const input = read(json);
    if (input) onImport(input);
  };

  return (
    <Shell
      title="导入需求单"
      onMask={onCancel}
      footer={
        <>
          <span className="hint">来源记为「文件导入」，与房主端提交那条路分开记</span>
          <div className="spacer" />
          <button type="button" className="btn" id="im-cancel" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="btn primary" id="im-ok" disabled={busy || !raw.trim()} onClick={submit}>
            {busy ? '正在导入…' : '导入'}
          </button>
        </>
      }
    >
      <div className="im-file">
        <label className="lbl" htmlFor="im-file">
          选择采集端导出的 JSON 文件
        </label>
        <input
          type="file"
          id="im-file"
          accept=".json,application/json"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setRaw(await file.text());
            setLocalError('');
          }}
        />
      </div>

      <label className="field">
        <span className="lbl">或者把 JSON 粘在这里</span>
        <textarea
          id="im-json"
          className="im-json"
          value={raw}
          placeholder='{"submittedAt":"2026-09-25T08:00:00.000Z","form":{"values":{},"instances":{}}}'
          onChange={(e) => {
            setRaw(e.target.value);
            setLocalError('');
          }}
        />
      </label>

      <label className="field">
        <span className="lbl">叫法（可留空，房主端不收集姓名）</span>
        <input
          id="im-name"
          value={name}
          maxLength={40}
          placeholder="未命名需求单"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      {localError || error ? <div className="err-line" id="im-err">{localError || error}</div> : null}
    </Shell>
  );
}
