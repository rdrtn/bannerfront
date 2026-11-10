import type { ReactNode } from 'react';

export function NumField(props: {
  label: string;
  value: number;
  onChange(v: number): void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
}) {
  return (
    <label className="f">
      <span>{props.label}</span>
      <span className="unit-wrap">
        <input
          type="number"
          value={Number.isFinite(props.value) ? props.value : 0}
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          disabled={props.disabled}
          onChange={(e) => {
            const v = e.target.valueAsNumber;
            if (Number.isFinite(v)) props.onChange(props.max !== undefined ? Math.min(props.max, v) : v);
          }}
        />
        {props.unit && <em>{props.unit}</em>}
      </span>
    </label>
  );
}

export function ColorField(props: { label: string; value: string | null; onChange(v: string): void; nullable?: boolean; onClear?(): void; disabled?: boolean }) {
  return (
    <label className="f">
      <span>{props.label}</span>
      <span className="unit-wrap">
        <input
          type="color"
          value={props.value ? props.value.slice(0, 7) : '#000000'}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.value)}
        />
        {props.nullable && (
          <button type="button" className="mini" disabled={props.disabled} onClick={props.onClear}>
            {props.value ? 'Remover' : 'Nenhum'}
          </button>
        )}
      </span>
    </label>
  );
}

export function SelectField<T extends string>(props: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(v: T): void;
  disabled?: boolean;
}) {
  return (
    <label className="f">
      <span>{props.label}</span>
      <select value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className="sec">
      <h3>{props.title}</h3>
      <div className="fields">{props.children}</div>
    </section>
  );
}
