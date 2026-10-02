// Sort & Filter (ADR-200) — SERVER mode for a paged / capped list. The page
// owns the sort + filters (so it can send them with its list request) and
// hands them to <DataTable sortFilterServer={…}>; columns opt in with
// `sortFilterField` (the endpoint's field name in its sf column map).
//
//   const sf = useServerSortFilter(TABLE_KEYS.jobCardsList, () => gotoPage(1));
//   useJobCardsList({ …, sf: sf.param });
//   <DataTable … sortFilterServer={sf} />
//
// State is kept per browser tab (Refresh / Back keep it), keyed by page path +
// table. Filters are keyed by FIELD, so `param` is the state as-is.

import { encodeSf, type SfFilter, type SfQuery } from '@innovic/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { EMPTY_STATE, isUsable, sanitizeState, type SfState } from './filter-model';

export interface ServerSortFilter {
  value: SfState;
  /** Replace the state (or update it from the current one). */
  onChange: (next: SfState | ((prev: SfState) => SfState)) => void;
  /** The `sf` request param, undefined when nothing is sorted / filtered. */
  param: string | undefined;
}

const PREFIX = 'innovic.sf-server:';

/** SfState (filters keyed by field) → the wire SfQuery. Unusable filters are dropped. */
export function toSfQuery(s: SfState): SfQuery {
  const filters: SfFilter[] = [];
  for (const [field, f] of Object.entries(s.filters)) {
    if (!isUsable(f)) continue;
    filters.push({ ...f, field } as SfFilter);
  }
  return { sort: s.sort ? { field: s.sort.id, dir: s.sort.dir } : null, filters };
}

function load(key: string): SfState {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? sanitizeState(JSON.parse(raw)) : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}

/**
 * @param tableKey the table's key (ui/data/table-keys.ts)
 * @param onChanged called after every change — send the list back to page 1.
 */
export function useServerSortFilter(tableKey: string, onChanged?: () => void): ServerSortFilter {
  const key = `${PREFIX}${window.location.pathname}:${tableKey}`;
  const [value, setValue] = useState<SfState>(() => load(key));
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;

  useEffect(() => {
    try {
      if (value.sort === null && Object.keys(value.filters).length === 0)
        window.sessionStorage.removeItem(key);
      else window.sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage blocked — the filters still work, just not across a refresh.
    }
  }, [key, value]);

  const onChange = useCallback((next: SfState | ((prev: SfState) => SfState)) => {
    setValue((prev) => (typeof next === 'function' ? next(prev) : next));
    changedRef.current?.();
  }, []);

  const param = useMemo(() => encodeSf(toSfQuery(value)), [value]);
  return useMemo(() => ({ value, onChange, param }), [value, onChange, param]);
}
