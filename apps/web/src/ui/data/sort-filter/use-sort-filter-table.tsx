// Sort & Filter (ADR-200) — what <DataTable> runs before it draws: reads the
// page scope, keeps this table's sort + filters (per browser tab, so Refresh
// and Back keep them), filters and sorts the given rows, and puts the ▾ menu
// into each column header. With nothing sorted or filtered the rows and the
// columns go through untouched (same array, same objects) — a table looks and
// behaves exactly as before until the user uses the menu.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { todayIst } from '@/lib/date';

import { colId, colKind, colLabel, cx } from '../data-table-cells';
import type { DataTableColumn, DataTableProps } from '../data-table-types';
import { cellText, isFilterableColumn } from './cell-text';
import {
  activeFilterCount,
  applySortFilter,
  detectType,
  distinctValues,
  type ColumnFilter,
  type SfColumn,
  type SfState,
  type SfType,
  type SortDir,
} from './filter-model';
import { HeadMenu } from './HeadMenu';
import { loadSf, saveSf } from './sf-storage';
import { useSfSnapshot, useSfStore } from './scope';
import { SortFilterButton } from './SortFilterButton';
import './sort-filter.css';

const STORE_PREFIX = 'innovic.sf:';

function isEmpty(s: SfState): boolean {
  return s.sort === null && Object.keys(s.filters).length === 0;
}

export interface SortFilterTable<T> {
  props: DataTableProps<T>;
  /** "Showing 18 of 240 · Clear filters", and the button when the page has no header one. */
  bar: ReactNode;
}

export function useSortFilterTable<T>(input: DataTableProps<T>): SortFilterTable<T> {
  const store = useSfStore();
  const snap = useSfSnapshot(store);
  const id = useId();
  const on =
    store !== null &&
    input.sortFilter !== false &&
    (input.sortFilter === true || (!input.editable && input.density !== 'compact')) &&
    // Group headings (ADR-203) follow the row order the screen gave; a browser
    // sort / filter would split the groups and repeat their headings. A
    // grouped table sorts and filters on the server or not at all.
    (input.groupRow === undefined || input.sortFilterServer !== undefined);
  // SERVER mode: the page owns the state and the rows are already the
  // server's answer — a partial footer (more pages / a cap) does not matter.
  const server = on ? input.sortFilterServer : undefined;
  const live = on && (server !== undefined || !snap.partial);
  // Which table this is: the page path + its key. When a mounted table moves
  // to another path (a detail page reused for the next record) its filters
  // are re-read for the new one instead of being carried over.
  const identity = `${window.location.pathname}:${input.tableKey ?? ''}`;
  const storageKey = on && input.tableKey ? `${STORE_PREFIX}${identity}` : null;

  const [localState, setLocalState] = useState<SfState>(() => loadSf(storageKey));
  const [stateFor, setStateFor] = useState(identity);
  if (stateFor !== identity) {
    setStateFor(identity);
    setLocalState(loadSf(storageKey));
  }
  useEffect(() => {
    if (stateFor === identity && !server) saveSf(storageKey, localState);
  }, [storageKey, localState, stateFor, identity, server]);
  const state = server ? server.value : localState;
  const serverChange = server?.onChange;
  const setState = serverChange ?? setLocalState;

  // "Clear filters" from the button's Keep/Clear question.
  const clearSeen = useRef(snap.clearToken);
  useEffect(() => {
    if (snap.clearToken === clearSeen.current) return;
    clearSeen.current = snap.clearToken;
    // Server mode: the page's useServerSortFilter answers the Clear itself.
    if (server) return;
    setState((s) => (Object.keys(s.filters).length === 0 ? s : { ...s, filters: {} }));
  }, [snap.clearToken, setState, server]);

  // The screen's own header sort was used → the ▾ sort gives way, so the
  // table is never ordered by one column while another shows as sorted.
  const callerSortKey = `${input.sortBy ?? ''}:${input.sortDir ?? ''}`;
  const callerSortSeen = useRef(callerSortKey);
  useEffect(() => {
    if (callerSortSeen.current === callerSortKey) return;
    callerSortSeen.current = callerSortKey;
    setState((s) => (s.sort === null ? s : { ...s, sort: null }));
  }, [callerSortKey, setState]);

  const activeCount = live ? activeFilterCount(state) : 0;
  const isServer = server !== undefined;
  // In server mode the page's useServerSortFilter counts the filters (it stays
  // registered while the table is gone, e.g. after the server refused a
  // filter) — the table registers 0 so the button never counts them twice.
  const registered = isServer ? 0 : activeCount;
  const countRef = useRef(registered);
  countRef.current = registered;
  useEffect(() => {
    if (!store || !on) return;
    store.setTable(id, countRef.current, isServer);
    return () => store.removeTable(id);
  }, [store, on, id, isServer]);
  useEffect(() => {
    if (store && on) store.setTable(id, registered, isServer);
  }, [store, on, id, registered, isServer]);

  const { columns, rows, onSort: callerSort } = input;
  const work = live && (snap.enabled || !isEmpty(state));

  // The ▾-able columns. Cell text is read LAZILY, one column at a time, only
  // for the columns that are filtered / sorted or whose menu is opened — not
  // every cell of every column on each render.
  // Keyed by column id — or, in server mode, by the column's server field
  // (only columns that name one are ▾-able there).
  const filterable = useMemo(() => {
    const m = new Map<string, { col: DataTableColumn<T>; label: string }>();
    columns.forEach((c, i) => {
      const cid = colId(c, i);
      const label = colLabel(c, i);
      if (!isFilterableColumn(c, cid, label)) return;
      if (isServer) {
        if (c.sortFilterField) m.set(c.sortFilterField, { col: c, label });
      } else m.set(cid, { col: c, label });
    });
    return m;
  }, [columns, isServer]);
  const cache = useMemo(
    () => ({ rows, filterable, cols: new Map<string, SfColumn>() }),
    [rows, filterable],
  );

  const today = todayIst();
  const outRows = useMemo(() => {
    if (!work || isEmpty(state) || isServer) return rows;
    const ids = new Set(Object.keys(state.filters));
    if (state.sort) ids.add(state.sort.id);
    return applySortFilter(rows.length, colsFor(cache, ids), state, today).map((i) => rows[i] as T);
  }, [work, cache, state, rows, today, isServer]);

  const outCols = useMemo((): Array<DataTableColumn<T>> => {
    if (!work) return columns;
    const setFilter = (cid: string, f: ColumnFilter | null): void =>
      setState((s) => {
        const filters = { ...s.filters };
        if (f) filters[cid] = f;
        else delete filters[cid];
        return { ...s, filters };
      });
    const setSort = (cid: string, dir: SortDir | null): void =>
      setState((s) => ({ ...s, sort: dir ? { id: cid, dir } : null }));
    const menuFor = (cid: string): MenuSpec => {
      if (isServer) return serverMenu(filterable.get(cid)?.col);
      const col = sfCol(cache, cid);
      if (!col) return { type: 'text', values: [] };
      // Excel: the list shows what the OTHER filters leave.
      const others = { ...state.filters };
      delete others[cid];
      const idx = applySortFilter(
        cache.rows.length,
        colsFor(cache, Object.keys(others)),
        { sort: null, filters: others },
        today,
      );
      return {
        type: col.type,
        values: distinctValues(
          idx.map((i) => col.texts[i] ?? null),
          col.type,
        ),
      };
    };
    return columns.map((c, i) => {
      const cid = isServer ? (c.sortFilterField ?? '') : colId(c, i);
      const f = filterable.get(cid);
      if (!f) return c;
      // The screen sorts this column itself (server sort) — keep its header click.
      const sortOff = callerSort !== undefined && c.sortField !== undefined;
      const sortDir = state.sort?.id === cid ? state.sort.dir : null;
      return {
        ...c,
        id: colId(c, i),
        label: f.label,
        header: (
          <HeadMenu
            header={c.header}
            label={f.label}
            showButton={snap.enabled}
            sortDir={sortDir}
            sortOff={sortOff}
            filter={state.filters[cid]}
            getMenu={() => menuFor(cid)}
            onSort={(d) => setSort(cid, d)}
            onFilter={(fl) => setFilter(cid, fl)}
          />
        ),
      };
    });
  }, [
    work,
    filterable,
    cache,
    columns,
    state,
    snap.enabled,
    callerSort,
    today,
    isServer,
    setState,
  ]);

  if (!on) return { props: input, bar: null };

  const ownButton = !snap.hasHeaderButton && snap.tables[0] === id;
  const filteredOut = activeCount > 0;
  const bar =
    ownButton || filteredOut ? (
      <div className="sf-bar">
        {filteredOut ? (
          <span className="sf-note">
            {isServer ? 'Filtered' : `Showing ${outRows.length} of ${rows.length}`}
            {' · '}
            <button
              type="button"
              className="dt-link"
              onClick={() => setState((s) => ({ ...s, filters: {} }))}
            >
              Clear filters
            </button>
          </span>
        ) : null}
        <span style={{ flex: 1 }} />
        {ownButton ? <SortFilterButton inTable /> : null}
      </div>
    ) : null;

  const props: DataTableProps<T> =
    outCols === columns && outRows === rows
      ? input
      : {
          ...input,
          columns: outCols,
          rows: outRows,
          className: cx(input.className, snap.enabled && 'sf-enabled'),
          // A hand-built totals row was summed from ALL rows — it would lie
          // under filtered rows, so it is hidden while a filter applies.
          // (`showTotals` totals are summed from the rows shown, and stay.)
          ...(filteredOut ? { footer: undefined } : {}),
          ...(filteredOut && outRows.length === 0 && (isServer || rows.length > 0)
            ? { empty: 'No rows match the filters.' }
            : {}),
        };
  return { props, bar };
}

interface TextCache<T> {
  rows: T[];
  filterable: Map<string, { col: DataTableColumn<T>; label: string }>;
  cols: Map<string, SfColumn>;
}

/** One column's displayed texts + type, read once per rows / columns change. */
function sfCol<T>(cache: TextCache<T>, cid: string): SfColumn | undefined {
  const hit = cache.cols.get(cid);
  if (hit) return hit;
  const f = cache.filterable.get(cid);
  if (!f) return undefined;
  const texts = cache.rows.map((r, ri) => cellText(f.col, r, ri));
  const made: SfColumn = { id: cid, type: detectType(colKind(f.col), texts), texts };
  cache.cols.set(cid, made);
  return made;
}

function colsFor<T>(cache: TextCache<T>, ids: Iterable<string>): Map<string, SfColumn> {
  const m = new Map<string, SfColumn>();
  for (const cid of ids) {
    const c = sfCol(cache, cid);
    if (c) m.set(cid, c);
  }
  return m;
}

export interface MenuSpec {
  type: SfType;
  values: string[];
  labelOf?: ((v: string) => string) | undefined;
  noTicks?: boolean | undefined;
}

/** Server mode: the column's declared type; a tick list only for `list` columns. */
function serverMenu<T>(col: DataTableColumn<T> | undefined): MenuSpec {
  if (!col) return { type: 'text', values: [], noTicks: true };
  const k = colKind(col);
  const type: SfType =
    col.filterType ??
    (k === 'num' ? 'num' : k === 'date' ? 'date' : k === 'badge' ? 'list' : 'text');
  if (type !== 'list') return { type, values: [], noTicks: true };
  const opts = col.filterOptions ?? [];
  const labels = new Map(opts.map((o) => [o.value, o.label]));
  return { type, values: opts.map((o) => o.value), labelOf: (v) => labels.get(v) ?? v };
}
