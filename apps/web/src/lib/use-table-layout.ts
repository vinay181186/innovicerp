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
// flag for the toolbar. Nothing is written until the saved layout has been
// READ: changes made while it loads queue and are saved after; if the read
// fails nothing is saved (the toolbar offers Retry). A 404 on the read (API
// side not deployed) is silent — the layout then lives in memory only.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  tableLayoutSchema,
  type SaveTableLayoutInput,
  type TableLayout,
  type TableLayoutColumn,
} from '@innovic/shared';

import { ApiError, apiFetch } from './api';
import { useSession } from './session';
import { applyLayoutOp, type LayoutOp } from './table-layout-ops';

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
  /** One Columns-menu action (move / hide / show / pin / unpin / reset). */
  apply: (op: LayoutOp) => void;
  /** The last save failed (after its one retry). */
  saveFailed: boolean;
  retrySave: () => void;
  /** The saved layout could not be read: defaults are shown and nothing is saved. */
  loadFailed: boolean;
  /** Read the saved layout again. */
  retryLoad: () => void;
}

const SAVE_DELAY_MS = 600;

export const tableLayoutQueryKey = (userId: string, tableKey: string) =>
  ['me', 'table-layout', userId, tableKey] as const;

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

type Pending = { kind: 'put'; state: TableLayoutState } | { kind: 'delete' };

export function useTableLayout(
  tableKey: string | undefined,
  columnIds: string[],
  defaults: TableLayoutDefaults,
): UseTableLayoutResult {
  const qc = useQueryClient();
  // Keyed by the logged-in user: on a shared PC the next person never sees
  // (or overwrites) the previous person's layout. Cleared on sign-out.
  const userId = useSession().data?.id;
  const enabled = tableKey !== undefined && userId !== undefined;
  const queryKey = tableLayoutQueryKey(userId ?? '', tableKey ?? '');
  const query = useQuery<TableLayout | null>({
    queryKey,
    enabled,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      let body: unknown;
      try {
        body = await apiFetch<unknown>(layoutPath(tableKey ?? ''));
      } catch (e) {
        // 404 = the API side is not deployed: work in memory, silently.
        if (isStatus(e, 404)) return null;
        // Network / server errors: load-failed (nothing is saved).
        throw e;
      }
      const parsed = tableLayoutSchema.safeParse(body);
      // A saved layout this code cannot read is treated as "never saved":
      // defaults on screen, and the next change saves a good one over it.
      return parsed.success
        ? parsed.data
        : { tableKey: tableKey ?? '', columns: [], updatedAt: null };
    },
  });

  // NEVER write before the saved layout has been read: a PUT built from the
  // defaults would wipe what the user saved. Until the read succeeds, changes
  // stay local and queue; on a failed read nothing is saved at all.
  const canSave = query.isSuccess && query.data !== null;
  const canSaveRef = useRef(canSave);
  canSaveRef.current = canSave;

  const [local, setLocal] = useState<TableLayoutState | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const seq = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<Pending | null>(null);
  // Changes made before the read finished, as operations to replay on top of
  // the SAVED layout once it arrives (never a defaults-based state).
  const queued = useRef<LayoutOp[]>([]);

  const idsKey = columnIds.join('|');
  const defaultState = useMemo<TableLayoutState>(
    () => ({ order: columnIds, pins: defaults.pins ?? [], hidden: defaults.hidden ?? [] }),
    [idsKey, (defaults.pins ?? []).join('|'), (defaults.hidden ?? []).join('|')],
  );

  // A different table / user on the same mounted component starts clean.
  useEffect(() => {
    setLocal(null);
    setSaveFailed(false);
    pending.current = null;
    queued.current = [];
  }, [tableKey, userId]);

  const saved = query.data?.columns;
  const state = useMemo(() => {
    const base =
      local ?? (saved !== undefined && saved.length > 0 ? fromSaved(saved) : defaultState);
    return normalize(base, columnIds, defaults);
  }, [local, saved, defaultState, idsKey]);

  const first = columnIds[0];
  const stateRef = useRef(state);
  stateRef.current = state;
  const loaded = query.isSuccess;
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  const send = useCallback(
    async (job: Pending, mySeq: number) => {
      if (tableKey === undefined || !canSaveRef.current) return;
      const path = layoutPath(tableKey);
      const body = job.kind === 'put' ? toSaveInput(job.state, first) : null;
      const call = () =>
        body
          ? apiFetch<TableLayout>(path, { method: 'PUT', json: body })
          : apiFetch(path, { method: 'DELETE' });
      try {
        try {
          await call();
        } catch (e) {
          if (isStatus(e, 0)) await call();
          else throw e;
        }
        if (mySeq !== seq.current) return;
        setSaveFailed(false);
        qc.setQueryData<TableLayout | null>(queryKey, {
          tableKey,
          columns: body ? body.columns : [],
          updatedAt: body ? new Date().toISOString() : null,
        });
      } catch {
        if (mySeq === seq.current) setSaveFailed(true);
      }
    },
    // queryKey is derived from userId + tableKey.
    [tableKey, userId, first, qc],
  );

  const flush = useCallback(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
    // Not readable yet (or the read failed): keep the change queued.
    if (!canSaveRef.current) return;
    const job = pending.current;
    pending.current = null;
    if (job) void send(job, seq.current);
  }, [send]);

  // The read just succeeded: replay what the user did while it loaded on top
  // of the SAVED layout, show that, and save it.
  useEffect(() => {
    if (!loaded || queued.current.length === 0) return;
    const ops = queued.current;
    queued.current = [];
    const base = saved !== undefined && saved.length > 0 ? fromSaved(saved) : defaultState;
    const replayed = normalize(
      ops.reduce((st, op) => applyLayoutOp(st, op, first, defaultState), base),
      columnIds,
      defaults,
    );
    const resetLast = ops[ops.length - 1]?.type === 'reset';
    seq.current += 1;
    setLocal(replayed);
    pending.current = resetLast ? { kind: 'delete' } : { kind: 'put', state: replayed };
    flush();
  }, [loaded, saved, defaultState, first, idsKey, flush]);

  useEffect(() => {
    if (canSave && pending.current && queued.current.length === 0) flush();
  }, [canSave, flush]);

  // Leaving the page mid-debounce still saves the last change.
  useEffect(() => flush, [flush]);

  const apply = useCallback(
    (op: LayoutOp) => {
      seq.current += 1;
      if (!loadedRef.current) queued.current.push(op);
      const next = normalize(
        applyLayoutOp(stateRef.current, op, first, defaultState),
        columnIds,
        defaults,
      );
      setLocal(next);
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      timer.current = undefined;
      if (op.type === 'reset') {
        setSaveFailed(false);
        pending.current = { kind: 'delete' };
        flush();
        return;
      }
      pending.current = { kind: 'put', state: next };
      timer.current = window.setTimeout(flush, SAVE_DELAY_MS);
    },
    [first, defaultState, idsKey, flush],
  );

  const retrySave = useCallback(() => {
    seq.current += 1;
    void send({ kind: 'put', state }, seq.current);
  }, [send, state]);

  const { refetch } = query;
  const retryLoad = useCallback(() => void refetch(), [refetch]);

  return {
    ...state,
    apply,
    saveFailed,
    retrySave,
    loadFailed: query.isError,
    retryLoad,
  };
}
