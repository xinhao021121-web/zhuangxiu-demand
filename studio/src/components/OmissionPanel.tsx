'use client';

import { useState } from 'react';
import { OMISSION_CATEGORIES } from '@zx/contracts';
import type { Omission, OmissionCategory, OmissionCreate } from '@zx/contracts';

/**
 * 遗漏补录（产品文档 7.5 第 5 条）：量房结束后补一句「这次该问但没列的是……」。
 *
 * 它不产生于任何自动动作，只能由人补，所以这块放在清单页的最下面——设计师刚看完清单、
 * 心里还记着漏了什么的那一刻。补录只追加，不回溯改历史。
 */
export function OmissionPanel({
  spaces,
  omissions,
  busy,
  onAdd,
}: {
  /** 这份清单里出现过的分区：补录要落到具体的分区上，选项就取它 */
  spaces: string[];
  omissions: Omission[];
  busy: boolean;
  onAdd: (input: OmissionCreate) => void;
}) {
  const [space, setSpace] = useState(spaces[0] ?? '');
  const [category, setCategory] = useState<OmissionCategory>('模型推演');
  const [note, setNote] = useState('');
  const ready = !!space && !!note.trim() && !busy;

  const add = () => {
    if (!ready) return;
    onAdd({ space, category, note: note.trim() });
    setNote('');
  };

  return (
    <div className="card" id="omission">
      <h3>
        遗漏补录
        <span className="cnt">这次该问、但清单没列的是什么</span>
      </h3>

      <div className="om-form">
        <select id="om-space" value={space} onChange={(e) => setSpace(e.target.value)} aria-label="分区">
          {spaces.length === 0 ? <option value="">（还没有清单）</option> : null}
          {spaces.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          id="om-cat"
          value={category}
          onChange={(e) => setCategory(e.target.value as OmissionCategory)}
          aria-label="归类"
        >
          {OMISSION_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          id="om-note"
          value={note}
          maxLength={200}
          placeholder="一句话：该问的是什么"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <button type="button" className="btn primary" id="om-add" disabled={!ready} onClick={add}>
          {busy ? '正在记…' : '补录'}
        </button>
      </div>

      {omissions.length ? (
        <ul className="om-list" id="om-list">
          {omissions.map((o) => (
            <li key={o.id}>
              <span className="chip">{o.space}</span>
              <span className="chip cat">{o.category}</span>
              <span className="om-note">{o.note}</span>
              <span className="om-meta">
                {o.operator} · {o.at}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-line" id="om-empty">
          还没有补录。量房时发现「该问而没列」的，回来在这里记一条——它是判据准不准的最终裁判。
        </div>
      )}

      <div className="note">补录不会改写这份清单，也不动房主原填：它记的是下一版该补什么。</div>
    </div>
  );
}
