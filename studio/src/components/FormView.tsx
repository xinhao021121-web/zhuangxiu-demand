'use client';

import { useState } from 'react';
import { FIELD_BY_ID, SECTIONS, isEmptyValue, instanceName, labelOf } from '@zx/field-spec';
import type { FieldSpec, FieldValue, FormModel, InstanceState } from '@zx/field-spec';

export function showValue(v: FieldValue): string {
  if (Array.isArray(v)) return v.join('、');
  if (v === undefined || v === null || v === '') return '';
  return String(v);
}

interface FieldRowProps {
  fieldKey: string;
  field: FieldSpec;
  value: FieldValue;
  aiMarked: boolean;
  flashed: boolean;
}

function FieldRow({ fieldKey, field, value, aiMarked, flashed }: FieldRowProps) {
  const empty = isEmptyValue(value);
  return (
    <div className={`fld${empty ? ' empty' : ''}${flashed ? ' found' : ''}`} data-fld={fieldKey}>
      <span className="k">{field.label}</span>
      <span className="v">
        {empty ? '未填' : showValue(value)}
        {aiMarked ? ' ' : null}
        {aiMarked ? <span className="tag">助手建议</span> : null}
      </span>
    </div>
  );
}

function InstanceBlock({
  inst,
  model,
  aiMarks,
  flash,
}: {
  inst: InstanceState;
  model: FormModel;
  aiMarks: string[];
  flash: string | null;
}) {
  const filled = Object.entries(inst.values).filter(([, v]) => !isEmptyValue(v));
  return (
    <div className="inst">
      <div className="ih">
        {instanceName(model, inst)}　已填 {filled.length} 项
      </div>
      {filled.length ? (
        <div className="inst-b">
          {filled.map(([id, v]) => {
            const field = FIELD_BY_ID.get(id);
            if (!field) return null;
            return (
              <FieldRow
                key={id}
                fieldKey={`${inst.key}.${id}`}
                field={field}
                value={v}
                aiMarked={aiMarks.includes(id)}
                flashed={flash === `${inst.key}.${id}`}
              />
            );
          })}
        </div>
      ) : (
        <span style={{ color: 'var(--dim2)' }}>未填写</span>
      )}
    </div>
  );
}

/** 原始表格视图：按 13 个大类还原房主填的内容，标出推荐项完成情况与助手建议。 */
export function FormView({ form, aiMarks, flash }: { form: FormModel; aiMarks: string[]; flash: string | null }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => (SECTIONS[0] ? { [SECTIONS[0].name]: true } : {}));

  return (
    <div>
      {SECTIONS.map((section, index) => {
        const fixed = section.fields.filter((f) => f.scope === '固定');
        const hasInstances = section.fields.some((f) => f.scope !== '固定');
        const gridClass = hasInstances ? 'inst-b' : 'sec-b';
        const list = form.instances[section.name] ?? [];
        const filled = fixed.filter((f) => !isEmptyValue(form.values[f.id])).length;
        const isOpen = !!open[section.name];
        return (
          <div className="sec" key={section.name}>
            <button
              type="button"
              className="sec-h"
              data-sec={section.name}
              aria-expanded={isOpen}
              onClick={() => setOpen((prev) => ({ ...prev, [section.name]: !prev[section.name] }))}
            >
              <span className="num">{index + 1}</span>
              <span className="t">{section.name}</span>
              <span className="m">
                {hasInstances ? `${list.length} 个空间` : `${filled} / ${fixed.length} 已填`}
              </span>
              <span style={{ color: 'var(--dim2)' }}>{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen ? (
              <div style={{ padding: hasInstances ? '0' : '12px 13px 14px' }}>
                {fixed.length ? (
                  <div className={gridClass}>
                    {fixed.map((f) => (
                      <FieldRow
                        key={f.id}
                        fieldKey={f.id}
                        field={f}
                        value={form.values[f.id]}
                        aiMarked={aiMarks.includes(f.id)}
                        flashed={flash === f.id}
                      />
                    ))}
                  </div>
                ) : null}
                {hasInstances ? (
                  <div style={{ padding: hasInstances && !fixed.length ? '12px 13px 14px' : '0 13px 8px' }}>
                    {list.length ? (
                      list.map((inst) => (
                        <InstanceBlock key={inst.key} inst={inst} model={form} aiMarks={aiMarks} flash={flash} />
                      ))
                    ) : (
                      <span style={{ color: 'var(--dim2)' }}>未添加</span>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function fieldLabel(fieldKey: string): string {
  const id = fieldKey.includes('.') ? fieldKey.split('.')[1] : fieldKey;
  return labelOf(id);
}
