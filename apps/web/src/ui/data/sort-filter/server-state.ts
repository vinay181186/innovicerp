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
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { isUsable, type SfState } from './filter-model';
import { useSfSnapshot, useSfStore } from './scope';
import { loadSf, saveSf } from './sf-storage';

export interface ServerSortFilter {
  value: SfState;
  /** Replace the state (or update it from the current one). */
  onChange: (next: SfState | ((prev: SfState) => SfState)) => void;
  /** The `sf` request param, undefined when nothing is sorted / filtered. */
  param: string | undefined;
  /** True while a column filter is applied (not just a sort). */
  filtering: boolean;
  /** Clear every column filter (the sort stays). */
  clearFilters: () => void;
  /** The `sf` param without one field's filter — for counts that must ignore it. */
  paramWithout: (field: string) => string | undefined;
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

/**
 * @param tableKey the table's key (ui/data/table-keys.ts)
 * @param onChanged called after every change — send the list back to page 1.
 */
export function useServerSortFilter(tableKey: string, onChanged?: () => void): ServerSortFilter {
  const key = `${PREFIX}${window.location.pathname}:${tableKey}`;
  const [value, setValue] = useState<SfState>(() => loadSf(key));
  const changedRef = useRef(onChanged);
  changedRef.current = onChanged;

  useEffect(() => saveSf(key, value), [key, value]);

  const onChange = useCallback((next: SfState | ((prev: SfState) => SfState)) => {
    setValue((prev) => (typeof next === 'function' ? next(prev) : next));
    changedRef.current?.();
  }, []);

  const param = useMemo(() => encodeSf(toSfQuery(value)), [value]);
  const filtering = Object.values(value.filters).some(isUsable);

  // Registered in the page scope on its own, so the Sort & Filter button
  // (with its count and its Keep / Clear question) stays on screen even
  // while the table is replaced by an error — the user can always clear a
  // filter the server refused.
  const store = useSfStore();
  const regId = useId();
  const active = Object.values(value.filters).filter(isUsable).length;
  useEffect(() => {
    if (!store) return;
    store.setHolder(regId, active);
  }, [store, regId, active]);
  useEffect(() => (store ? () => store.setHolder(regId, 0) : undefined), [store, regId]);
  const clearToken = useSfSnapshot(store).clearToken;
  const clearSeen = useRef(clearToken);
  useEffect(() => {
    if (clearSeen.current === clearToken) return;
    clearSeen.current = clearToken;
    onChange((s) => (Object.keys(s.filters).length === 0 ? s : { ...s, filters: {} }));
  }, [clearToken, onChange]);
  const clearFilters = useCallback(() => onChange((s) => ({ ...s, filters: {} })), [onChange]);
  const paramWithout = useCallback(
    (field: string) => {
      const filters = { ...value.filters };
      delete filters[field];
      return encodeSf(toSfQuery({ ...value, filters }));
    },
    [value],
  );
  return useMemo(
    () => ({ value, onChange, param, filtering, clearFilters, paramWithout }),
    [value, onChange, param, filtering, clearFilters, paramWithout],
  );
}
