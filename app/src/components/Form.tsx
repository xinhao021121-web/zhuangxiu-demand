import { Input, Text, Textarea, View } from '@tarojs/components';
import { INSTANCE_DEF, fieldKey, getValue, instanceName, isEmptyValue, sectionStats, visibleFields } from '@zx/field-spec';
import type { FieldSpec, FormModel, InstanceState, SectionSpec } from '@zx/field-spec';
import { useAppStore } from '../store';

interface FieldProps {
  model: FormModel;
  field: FieldSpec;
  inst?: InstanceState;
  flashKey: string;
}

/** 字段控件：选项组 / 输入 / 长文本三类覆盖全部字段，两端共用。 */
export function Field({ model, field, inst, flashKey }: FieldProps) {
  const key = fieldKey(inst?.key, field.id);
  const hasAi = useAppStore((s) => !!s.draft.aiMarks[key]);
  const setField = useAppStore((s) => s.setField);
  const undoAI = useAppStore((s) => s.undoAI);
  const value = getValue(model, key);

  const pick = (option: string) => {
    if (field.type === '多选') {
      const list = Array.isArray(value) ? value.slice() : [];
      const i = list.indexOf(option);
      if (i >= 0) list.splice(i, 1);
      else list.push(option);
      setField(key, list);
      return;
    }
    setField(key, value === option ? '' : option);
  };

  let control: JSX.Element;
  if (field.type === '单选' || field.type === '多选') {
    const list = Array.isArray(value) ? value : [];
    control = (
      <View className="chips">
        {field.options.map((option) => {
          const on = field.type === '多选' ? list.includes(option) : value === option;
          return (
            <View key={option} className={`chip${on ? ' on' : ''}`} onClick={() => pick(option)}>
              <Text>{option}</Text>
            </View>
          );
        })}
      </View>
    );
  } else if (field.type === '长文本') {
    control = (
      <Textarea
        className="input input-area"
        value={value === undefined ? '' : String(value)}
        placeholder={field.unit || ''}
        onInput={(e) => setField(key, e.detail.value)}
      />
    );
  } else {
    control = (
      <View className="input-row">
        <Input
          className="input"
          type={field.type === '数字' ? 'number' : 'text'}
          value={value === undefined || value === null ? '' : String(value)}
          placeholder={field.unit || ''}
          onInput={(e) =>
            setField(key, field.type === '数字' ? (e.detail.value === '' ? '' : Number(e.detail.value)) : e.detail.value)
          }
        />
        {field.unit && field.type === '数字' ? <Text className="unit">{field.unit}</Text> : null}
      </View>
    );
  }

  return (
    <View
      id={`fi-${key}`}
      className={`field${field.type === '长文本' ? ' wide' : ''}${flashKey === key ? ' flash' : ''}`}
    >
      <View className="field-label">
        <Text className="field-name">{field.label}</Text>
        {field.suggest === '推荐填写' ? <Text className="rec">推荐填写</Text> : null}
        {hasAi ? (
          <Text className="ai-badge" onClick={() => undoAI(key)}>
            ✦ AI 建议 · 撤销
          </Text>
        ) : null}
      </View>
      {control}
    </View>
  );
}

function Group({ name, fields, model, inst, flashKey }: { name: string; fields: FieldSpec[]; model: FormModel; inst?: InstanceState; flashKey: string }) {
  if (!fields.length) return null;
  return (
    <View className="group">
      <Text className="group-title">{name}</Text>
      <View className="grid">
        {fields.map((f) => (
          <Field key={f.id} model={model} field={f} inst={inst} flashKey={flashKey} />
        ))}
      </View>
    </View>
  );
}

function InstanceCard({ section, inst, model, flashKey }: { section: SectionSpec; inst: InstanceState; model: FormModel; flashKey: string }) {
  const removeInstanceOf = useAppStore((s) => s.removeInstanceOf);
  const list = model.instances[section.name] ?? [];
  const def = INSTANCE_DEF[section.name];
  const fields = visibleFields(section.name, inst);
  const filled = fields.filter((f) => !isEmptyValue(getValue(model, `${inst.key}.${f.id}`))).length;
  const typeField = def.typeField ? fields.find((f) => f.id === def.typeField) : undefined;
  const visible = new Set(fields.map((f) => f.id));

  return (
    <View className="inst-card" id={`inst-${inst.key}`}>
      <View className="inst-head">
        <Text className="inst-title">{instanceName(model, inst)}</Text>
        <Text className="inst-sub">{`${filled} / ${fields.length} 项已填`}</Text>
        {list.length > 1 ? (
          <View className="btn btn-sm" onClick={() => removeInstanceOf(section.name, inst.key)}>
            <Text>删除</Text>
          </View>
        ) : null}
      </View>
      {typeField ? <Field model={model} field={typeField} inst={inst} flashKey={flashKey} /> : null}
      {section.groups.map((g) => (
        <Group
          key={g.name}
          name={g.name}
          fields={g.fields.filter((f) => visible.has(f.id) && f.id !== def.typeField)}
          model={model}
          inst={inst}
          flashKey={flashKey}
        />
      ))}
    </View>
  );
}

interface SectionProps {
  section: SectionSpec;
  index: number;
  model: FormModel;
  expanded: boolean;
  flashKey: string;
  onToggle: () => void;
}

export function SectionCard({ section, index, model, expanded, flashKey, onToggle }: SectionProps) {
  const addInstanceOf = useAppStore((s) => s.addInstanceOf);
  const toggleNoNeed = useAppStore((s) => s.toggleNoNeed);
  const stats = sectionStats(model, section.name);
  const meta = section.scope === '固定' ? `${stats.filled} / ${stats.total}` : `${stats.count} 个空间`;
  const def = INSTANCE_DEF[section.name];
  const list = model.instances[section.name] ?? [];
  const noNeed = useAppStore((s) => !!s.draft.noNeed[section.name]);

  let body: JSX.Element | null = null;
  if (expanded) {
    if (section.scope === '固定') {
      body = (
        <View className="sec-body">
          {section.groups.map((g) => (
            <Group key={g.name} name={g.name} fields={g.fields} model={model} flashKey={flashKey} />
          ))}
        </View>
      );
    } else if (!list.length) {
      body = (
        <View className="sec-body">
          <View className="inst-empty">
            <Text>{noNeed ? '已确认：这个空间暂时没有需求' : `还没有添加${section.name}`}</Text>
            <View className="inst-actions">
              <View className="btn btn-sm" onClick={() => toggleNoNeed(section.name)}>
                <Text>{noNeed ? '恢复' : '没有需求，跳过'}</Text>
              </View>
              <View className="btn btn-sm btn-primary" onClick={() => addInstanceOf(section.name)}>
                <Text>{`+ 添加${def.namePrefix}`}</Text>
              </View>
            </View>
          </View>
        </View>
      );
    } else {
      body = (
        <View className="sec-body">
          {list.map((inst) => (
            <InstanceCard key={inst.key} section={section} inst={inst} model={model} flashKey={flashKey} />
          ))}
          <View className="inst-actions">
            {list.length < def.max ? (
              <View className="btn btn-sm" onClick={() => addInstanceOf(section.name)}>
                <Text>{`+ 添加${def.namePrefix}（还可添加 ${def.max - list.length} 个）`}</Text>
              </View>
            ) : (
              <Text className="inst-sub">{`已达上限 ${def.max} 个`}</Text>
            )}
          </View>
        </View>
      );
    }
  }

  return (
    <View className={`sec-card${expanded ? ' open' : ''}`} id={`sec-${section.name}`}>
      <View className="sec-head" onClick={onToggle}>
        <Text className="sec-num">{index + 1}</Text>
        <Text className="sec-title">{section.name}</Text>
        <Text className="sec-meta">{meta}</Text>
        <Text className="sec-arrow">{expanded ? '▾' : '▸'}</Text>
      </View>
      {body}
    </View>
  );
}

