'use client';

import { useState } from 'react';
import type { DemandSheetDetail } from '@zx/contracts';

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
  busy,
  onCancel,
  onConfirm,
}: {
  detail: DemandSheetDetail;
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
