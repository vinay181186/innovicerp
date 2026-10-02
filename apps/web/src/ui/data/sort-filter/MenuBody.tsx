// Sort & Filter (ADR-200) — what the ▾ popover holds, Excel-style:
//   sort (A→Z / Z→A, Smallest→Largest, Oldest→Newest)
//   a condition by column type (text / number / date with presets)
//   search + tick list of the column's values (Select all, Blanks)
//   Clear filter · Cancel · OK
// Nothing applies until OK (or a date preset / sort click), so typing never
// re-filters the table key by key.

import { useMemo, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';

import {
  BLANK,
  DATE_PRESETS,
  isUsable,
  type ColumnFilter,
  type DateOp,
  type NumOp,
  type SfType,
  type SortDir,
  type TextOp,
} from './filter-model';

export interface MenuBodyProps {
  label: string;
  type: SfType;
  sortDir: SortDir | null;
  /** Sorting is not offered (the screen sorts this column itself). */
  sortOff?: boolean | undefined;
  filter: ColumnFilter | undefined;
  values: string[];
  /** The text shown for a tick-list value (server lists tick stored codes). */
  labelOf?: ((v: string) => string) | undefined;
  /** No tick list (server mode, text columns — the values are not all loaded). */
  noTicks?: boolean | undefined;
  onSort: (dir: SortDir | null) => void;
  onFilter: (f: ColumnFilter | null) => void;
  onClose: () => void;
}

const SORT_LABEL: Record<SfType, [string, string]> = {
  text: ['A → Z', 'Z → A'],
  list: ['A → Z', 'Z → A'],
  num: ['Smallest → Largest', 'Largest → Smallest'],
  date: ['Oldest → Newest', 'Newest → Oldest'],
};
const TEXT_OPS: Array<[TextOp, string]> = [
  ['contains', 'Contains'],
  ['notContains', 'Does not contain'],
  ['equals', 'Equals'],
  ['begins', 'Begins with'],
];
const NUM_OPS: Array<[NumOp, string]> = [
  ['eq', '='],
  ['ne', '≠'],
  ['gt', '>'],
  ['gte', '≥'],
  ['lt', '<'],
  ['lte', '≤'],
  ['between', 'Between'],
];
const DATE_OPS: Array<[DateOp, string]> = [
  ['between', 'From – To'],
  ['on', 'On'],
  ['before', 'Before'],
  ['after', 'After'],
];
/** Rendering thousands of checkboxes freezes the page — search narrows it. */
const MAX_TICKS = 300;

export function MenuBody(p: MenuBodyProps): ReactElement {
  const f = p.filter;
  const [mode, setMode] = useState<'cond' | 'values' | null>(null);
  const [textOp, setTextOp] = useState<TextOp>(f?.kind === 'text' ? f.op : 'contains');
  const [q, setQ] = useState(f?.kind === 'text' ? f.q : '');
  const [numOp, setNumOp] = useState<NumOp>(f?.kind === 'num' ? f.op : 'eq');
  const [a, setA] = useState(f?.kind === 'num' ? String(f.a) : '');
  const [b, setB] = useState(f?.kind === 'num' && f.b !== undefined ? String(f.b) : '');
  const isPresetOp = f?.kind === 'date' && DATE_PRESETS.some((d) => d.op === f.op);
  const [dateOp, setDateOp] = useState<DateOp>(
    f?.kind === 'date' && !isPresetOp ? f.op : 'between',
  );
  const [from, setFrom] = useState(f?.kind === 'date' ? (f.from ?? '') : '');
  const [to, setTo] = useState(f?.kind === 'date' ? (f.to ?? '') : '');
  const [search, setSearch] = useState('');
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(f?.kind === 'values' ? f.values : p.values),
  );

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    const lab = p.labelOf ?? ((v: string) => v);
    return s ? p.values.filter((v) => lab(v).toLowerCase().includes(s)) : p.values;
  }, [p.values, p.labelOf, search]);
  const allShownTicked = shown.length > 0 && shown.every((v) => checked.has(v));

  const condition = (): ColumnFilter | null => {
    if (p.type === 'text') return { kind: 'text', op: textOp, q };
    if (p.type === 'num') {
      if (a.trim() === '') return null;
      const bn = b.trim() === '' ? undefined : Number(b);
      return { kind: 'num', op: numOp, a: Number(a), b: numOp === 'between' ? bn : undefined };
    }
    if (p.type === 'date')
      return {
        kind: 'date',
        op: dateOp,
        from: from || undefined,
        to: dateOp === 'between' ? to || undefined : undefined,
      };
    return null;
  };

  const apply = (): void => {
    if (mode === 'cond') {
      const c = condition();
      p.onFilter(c && isUsable(c) ? c : null);
    } else if (mode === 'values') {
      const pick = search.trim()
        ? shown.filter((v) => checked.has(v))
        : p.values.filter((v) => checked.has(v));
      p.onFilter(
        !search.trim() && pick.length === p.values.length ? null : { kind: 'values', values: pick },
      );
    }
    p.onClose();
  };
  const onEnter = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      apply();
    }
  };
  const condInvalid = mode === 'cond' && !(condition() && isUsable(condition() as ColumnFilter));
  const valuesInvalid = mode === 'values' && ![...checked].some((v) => shown.includes(v));
  const [asc, desc] = SORT_LABEL[p.type];

  return (
    <div className="sf-menu" onKeyDown={(e) => e.key === 'Escape' && p.onClose()}>
      {p.sortOff ? null : (
        <div className="sf-sec sf-sort">
          <button
            type="button"
            className={p.sortDir === 'asc' ? 'is-on' : undefined}
            onClick={() => {
              p.onSort(p.sortDir === 'asc' ? null : 'asc');
              p.onClose();
            }}
          >
            ↑ {asc}
          </button>
          <button
            type="button"
            className={p.sortDir === 'desc' ? 'is-on' : undefined}
            onClick={() => {
              p.onSort(p.sortDir === 'desc' ? null : 'desc');
              p.onClose();
            }}
          >
            ↓ {desc}
          </button>
        </div>
      )}

      {p.type === 'date' ? (
        <div className="sf-sec">
          <div className="sf-presets">
            {DATE_PRESETS.map((d) => (
              <button
                type="button"
                key={d.op}
                className={f?.kind === 'date' && f.op === d.op ? 'is-on' : undefined}
                onClick={() => {
                  p.onFilter({ kind: 'date', op: d.op });
                  p.onClose();
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="sf-row">
            <select
              aria-label={`${p.label} condition`}
              value={dateOp}
              onChange={(e) => {
                setDateOp(e.target.value as DateOp);
                setMode('cond');
              }}
            >
              {DATE_OPS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <input
              type="date"
              aria-label={dateOp === 'between' ? 'From' : 'Date'}
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setMode('cond');
              }}
              onKeyDown={onEnter}
            />
            {dateOp === 'between' ? (
              <input
                type="date"
                aria-label="To"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setMode('cond');
                }}
                onKeyDown={onEnter}
              />
            ) : null}
          </div>
        </div>
      ) : p.type === 'num' ? (
        <div className="sf-sec sf-row">
          <select
            aria-label={`${p.label} condition`}
            value={numOp}
            onChange={(e) => {
              setNumOp(e.target.value as NumOp);
              setMode('cond');
            }}
          >
            {NUM_OPS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <input
            type="number"
            inputMode="decimal"
            aria-label="Value"
            value={a}
            onChange={(e) => {
              setA(e.target.value);
              setMode('cond');
            }}
            onWheel={(e) => e.currentTarget.blur()}
            onKeyDown={onEnter}
          />
          {numOp === 'between' ? (
            <input
              type="number"
              inputMode="decimal"
              aria-label="and"
              value={b}
              onChange={(e) => {
                setB(e.target.value);
                setMode('cond');
              }}
              onWheel={(e) => e.currentTarget.blur()}
              onKeyDown={onEnter}
            />
          ) : null}
        </div>
      ) : p.type === 'text' ? (
        <div className="sf-sec sf-row">
          <select
            aria-label={`${p.label} condition`}
            value={textOp}
            onChange={(e) => {
              setTextOp(e.target.value as TextOp);
              setMode('cond');
            }}
          >
            {TEXT_OPS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <input
            type="text"
            aria-label="Text"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setMode('cond');
            }}
            onKeyDown={onEnter}
          />
        </div>
      ) : null}

      <div className="sf-sec" hidden={p.noTicks}>
        <input
          type="search"
          className="sf-search"
          placeholder="Search values…"
          aria-label={`Search ${p.label} values`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={onEnter}
        />
        <div className="sf-ticks" role="group" aria-label={`${p.label} values`}>
          <label className="sf-tick sf-tick-all">
            <input
              type="checkbox"
              checked={allShownTicked}
              onChange={() => {
                const next = new Set(checked);
                for (const v of shown) {
                  if (allShownTicked) next.delete(v);
                  else next.add(v);
                }
                setChecked(next);
                setMode('values');
              }}
            />
            (Select all{search.trim() ? ' shown' : ''})
          </label>
          {shown.slice(0, MAX_TICKS).map((v) => (
            <label key={v} className={v === BLANK ? 'sf-tick sf-blank' : 'sf-tick'} title={v}>
              <input
                type="checkbox"
                checked={checked.has(v)}
                onChange={() => {
                  const next = new Set(checked);
                  if (next.has(v)) next.delete(v);
                  else next.add(v);
                  setChecked(next);
                  setMode('values');
                }}
              />
              <span>{p.labelOf ? p.labelOf(v) : v}</span>
            </label>
          ))}
          {shown.length > MAX_TICKS ? (
            <div className="sf-more">
              {shown.length - MAX_TICKS} more — type in the search box to narrow
            </div>
          ) : shown.length === 0 ? (
            <div className="sf-more">No matching values</div>
          ) : null}
        </div>
      </div>

      <div className="sf-foot">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={!f}
          onClick={() => {
            p.onFilter(null);
            p.onClose();
          }}
        >
          Clear filter
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={p.onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={condInvalid || valuesInvalid}
          onClick={apply}
        >
          OK
        </button>
      </div>
    </div>
  );
}
