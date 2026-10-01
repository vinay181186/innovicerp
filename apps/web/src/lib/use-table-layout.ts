// One table's column layout for the logged-in user (ADR-199): order, pins,
// hidden. Contract: packages/shared/src/schemas/table-prefs.ts.
//
//   GET    /me/table-layouts/:tableKey   saved layout ([] = never saved)
//   PUT    /me/table-layouts/:tableKey   the full column list
//   DELETE /me/table-layouts/:tableKey   back to the screen's defaults
//
// The screen's own column list always wins: saved keys the code no longer has
// are ignored, new code columns are appended with their default visibility.
// A change shows at once (local state); the save follows, debounced 600 ms.
// A sequence number makes sure an older save's answer never touches the state
// of a newer change. One retry on a network error, then a "Not saved — retry"
// flag for the toolbar. A 404 (API side not deployed yet) is silent — the
// layout then simply lives in memory for the session.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  tableLayoutSchema,
  type SaveTableLayoutInput,
  type TableLayout,
  type TableLayoutColumn,
} from '@innovic/shared';

import { ApiError, apiFetch } from './api';

export interface TableLayoutState {
  order: string[];
  pins: string[];
  hidden: string[];
}

export interface TableLayoutDefaults {
  pins?: string[] | undefined;
  hidden?: string[] | undefined;
}

export interface UseTableLayoutResult extends TableLayoutState {
  setLayout: (next: TableLayoutState) => void;
  reset: () => void;
  /** The last save failed (after its one retry). */
  saveFailed: boolean;
  retrySave: () => void;
}

const SAVE_DELAY_MS = 600;

export const tableLayoutQueryKey = (tableKey: string) => ['me', 'table-layout', tableKey] as const;

function layoutPath(tableKey: string): string {
  return `/me/table-layouts/${encodeURIComponent(tableKey)}`;
}

function isStatus(e: unknown, status: number): boolean {
  return e instanceof ApiError && e.status === status;
}

/** Fit any layout onto the columns the code has today. */
function normalize(
  state: TableLayoutState,
  ids: string[],
  defaults: TableLayoutDefaults,
): TableLayoutState {
  const first = ids[0];
  const known = state.order.filter((k) => ids.includes(k));
  const added = ids.filter((k) => !known.includes(k));
  let order = [...known, ...added];
  if (first !== undefined) order = [first, ...order.filter((k) => k !== first)];
  const hidden = [
    ...state.hidden.filter((k) => ids.includes(k)),
    ...added.filter((k) => defaults.hidden?.includes(k) ?? false),
  ].filter((k) => k !== first);
  const pins = [
    ...state.pins.filter((k) => ids.includes(k)),
    ...added.filter((k) => defaults.pins?.includes(k) ?? false),
  ].filter((k) => k !== first && !hidden.includes(k));
  return { order, pins: [...new Set(pins)], hidden: [...new Set(hidden)] };
}

function fromSaved(columns: TableLayoutColumn[]): TableLayoutState {
  const sorted = [...columns].sort((a, b) => a.position - b.position);
  return {
    order: sorted.map((c) => c.columnKey),
    pins: sorted.filter((c) => c.pinned).map((c) => c.columnKey),
    hidden: sorted.filter((c) => c.hidden).map((c) => c.columnKey),
  };
}

function toSaveInput(state: TableLayoutState, first: string | undefined): SaveTableLayoutInput {
  return {
    columns: state.order.map((columnKey, position) => {
      const hidden = columnKey !== first && state.hidden.includes(columnKey);
      return {
        columnKey,
        position,
        hidden,
        pinned: !hidden && (columnKey === first || state.pins.includes(columnKey)),
      };
    }),
  };
}

export function useTableLayout(
  tableKey: string | undefined,
  columnIds: string[],
  defaults: TableLayoutDefaults,
): UseTableLayoutResult {
  const qc = useQueryClient();
  const query = useQuery<TableLayout | null>({
    queryKey: tableLayoutQueryKey(tableKey ?? ''),
    enabled: tableKey !== undefined,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      try {
        const parsed = tableLayoutSchema.safeParse(
          await apiFetch<unknown>(layoutPath(tableKey ?? '')),
        );
        return parsed.success ? parsed.data : null;
      } catch {
        // 404 = API side not deployed; anything else = keep the defaults.
        return null;
      }
    },
  });

  const [local, setLocal] = useState<TableLayoutState | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const seq = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<TableLayoutState | null>(null);
  const apiMissing = useRef(false);

  const idsKey = columnIds.join('|');
  const defaultState = useMemo<TableLayoutState>(
    () => ({ order: columnIds, pins: defaults.pins ?? [], hidden: defaults.hidden ?? [] }),
    [idsKey, (defaults.pins ?? []).join('|'), (defaults.hidden ?? []).join('|')],
  );

  // A different table on the same mounted component starts clean.
  useEffect(() => {
    setLocal(null);
    setSaveFailed(false);
  }, [tableKey]);

  const saved = query.data?.columns;
  const state = useMemo(() => {
    const base =
      local ?? (saved !== undefined && saved.length > 0 ? fromSaved(saved) : defaultState);
    return normalize(base, columnIds, defaults);
  }, [local, saved, defaultState, idsKey]);

  const first = columnIds[0];

  const send = useCallback(
    async (next: TableLayoutState, mySeq: number) => {
      if (tableKey === undefined || apiMissing.current) return;
      const body = toSaveInput(next, first);
      const put = () => apiFetch<TableLayout>(layoutPath(tableKey), { method: 'PUT', json: body });
      try {
        try {
          await put();
        } catch (e) {
          if (isStatus(e, 0)) await put();
          else throw e;
        }
        if (mySeq !== seq.current) return;
        setSaveFailed(false);
        qc.setQueryData<TableLayout | null>(tableLayoutQueryKey(tableKey), {
          tableKey,
          columns: body.columns,
          updatedAt: new Date().toISOString(),
        });
      } catch (e) {
        if (isStatus(e, 404)) {
          apiMissing.current = true;
          return;
        }
        if (mySeq === seq.current) setSaveFailed(true);
      }
    },
    [tableKey, first, qc],
  );

  const flush = useCallback(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
    const next = pending.current;
    pending.current = null;
    if (next) void send(next, seq.current);
  }, [send]);

  // Leaving the page mid-debounce still saves the last change.
  useEffect(() => flush, [flush]);

  const setLayout = useCallback(
    (next: TableLayoutState) => {
      seq.current += 1;
      setLocal(next);
      pending.current = next;
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  const reset = useCallback(() => {
    seq.current += 1;
    const mySeq = seq.current;
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
    pending.current = null;
    setLocal(defaultState);
    setSaveFailed(false);
    if (tableKey === undefined || apiMissing.current) return;
    qc.setQueryData<TableLayout | null>(tableLayoutQueryKey(tableKey), {
      tableKey,
      columns: [],
      updatedAt: null,
    });
    apiFetch(layoutPath(tableKey), { method: 'DELETE' }).catch((e: unknown) => {
      if (isStatus(e, 404)) apiMissing.current = true;
      else if (mySeq === seq.current) setSaveFailed(true);
    });
  }, [defaultState, tableKey, qc]);

  const retrySave = useCallback(() => {
    seq.current += 1;
    void send(state, seq.current);
  }, [send, state]);

  return { ...state, setLayout, reset, saveFailed, retrySave };
}
