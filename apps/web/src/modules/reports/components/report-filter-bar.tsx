// ERPNext-style filter bar: one wrapping row of compact controls, each with a
// tiny caption. Filters apply on their own — a select on change, a date once
// it is a complete, sane date (and on blur), a text box after a ~400ms pause —
// so there is no Apply button. "Clear filters" shows once any filter is set.
// The caller keeps the URL = the filters.
import type { ReportFilterField } from '@innovic/shared';
import { useEffect, useState } from 'react';
import { statusText } from '@/lib/status-text';
import { SearchInput } from '@/ui/forms/SearchInput';

const TEXT_DEBOUNCE_MS = 400;
/** A typed year below this is a half-typed year (0002, 0202), not a filter. */
const MIN_YEAR = 1990;

export interface ReportFilterBarProps {
  filters: ReportFilterField[];
  values: Readonly<Record<string, string>>;
  onChange: (key: string, value: string) => void;
  onClear: () => void;
  /** Bumped by the caller's Clear: drops pending text / half-typed dates. */
  resetKey: number;
}

export function ReportFilterBar({
  filters,
  values,
  onChange,
  onClear,
  resetKey,
}: ReportFilterBarProps): React.JSX.Element | null {
  if (filters.length === 0) return null;
  const anySet = filters.some((f) => (values[f.key] ?? '') !== '');
  return (
    <div className="rpt-filters" role="search" aria-label="Report filters">
      {filters.map((filter) => {
        const id = `filter-${filter.key}`;
        const value = values[filter.key] ?? '';
        return (
          <div key={filter.key} className={`rpt-filter${filter.kind === 'text' ? ' is-wide' : ''}`}>
            <label className="rpt-filter-label" htmlFor={id}>
              {filter.label}
            </label>
            {filter.kind === 'date' ? (
              <DateFilter
                id={id}
                value={value}
                resetKey={resetKey}
                onCommit={(v) => onChange(filter.key, v)}
              />
            ) : filter.kind === 'text' ? (
              <SearchInput
                id={id}
                value={value}
                resetKey={resetKey}
                debounceMs={TEXT_DEBOUNCE_MS}
                width="full"
                placeholder={filter.placeholder ?? filter.label}
                aria-label={filter.label}
                onChange={(v) => onChange(filter.key, v)}
              />
            ) : (
              <select
                id={id}
                className="innovic-select"
                value={value}
                onChange={(e) => onChange(filter.key, e.target.value)}
              >
                <option value="">All</option>
                {(filter.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {statusText(opt)}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
      {anySet ? (
        <button type="button" className="rpt-clear" onClick={onClear}>
          Clear filters
        </button>
      ) : null}
    </div>
  );
}

/** `YYYY-MM-DD`, a real calendar day, year ≥ MIN_YEAR. */
function isUsableDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < MIN_YEAR) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** A date box that holds its own draft and only reports a usable date (or an
 *  empty box = clear). While the year is still being typed, nothing runs. */
function DateFilter(props: {
  id: string;
  value: string;
  resetKey: number;
  onCommit: (v: string) => void;
}): React.JSX.Element {
  const { id, value, resetKey, onCommit } = props;
  const [draft, setDraft] = useState(value);

  // The URL changed under us (Clear, Back, another filter's reset): adopt it.
  useEffect(() => setDraft(value), [value, resetKey]);

  const commit = (v: string): void => {
    if (v === value) return;
    if (v === '' || isUsableDate(v)) onCommit(v);
  };

  return (
    <input
      id={id}
      className="innovic-input"
      type="date"
      min={`${MIN_YEAR}-01-01`}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        // A half-filled box also reads '' — `badInput` tells it apart from a
        // box the user really emptied, which is the only '' that clears.
        if (e.target.value === '' && e.target.validity.badInput) return;
        commit(e.target.value);
      }}
      onBlur={(e) => {
        const partial = draft === '' && e.target.validity.badInput;
        if (!partial && (draft === '' || isUsableDate(draft))) commit(draft);
        else setDraft(value);
      }}
    />
  );
}
