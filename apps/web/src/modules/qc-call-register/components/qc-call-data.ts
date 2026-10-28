// QC Call Register — the register's data (ADR-201). One page of 25 calls from
// GET /qc-history/register: incoming (GRN line) and process (job-card op)
// calls paged TOGETHER on the server, with search, the stage and "Mine"
// applied there over EVERY call. The stage counts and the register totals are
// the server's whole-register summary — never counted from the loaded page.

import {
  INCOMING_QC_GRN_TYPES,
  type QcGrnType,
  type QcRegisterCompletedItem,
  type QcRegisterPendingItem,
  type QcRegisterQuery,
  type QcRegisterSummary,
} from '@innovic/shared';
import { useMemo, useRef } from 'react';
import { LIST_PAGE_SIZE, pageOffset } from '@/lib/list-paging';
import { useQcRegister } from '@/modules/qc-history/api';
import { type ServerSortFilter, useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import type { QcStage, QcView, StageStat } from './qc-sheet';

export interface QcCallData {
  /** The register query (without paging) — the export reuses it. */
  query: Omit<QcRegisterQuery, 'limit' | 'offset'>;
  /** This page's pending calls (view = pending). */
  pendingRows: QcRegisterPendingItem[];
  /** This page's completed entries (view = completed), newest first. */
  completedRows: QcRegisterCompletedItem[];
  /** Calls matching view + stage + search + Mine + Sort & Filter, over all pages. */
  total: number;
  /** Stage figures over the WHOLE register, for the stage dropdown. */
  stageStats: Record<QcStage, StageStat>;
  /** ADR-251: the Incoming stage split by GRN Type, for the GRN Type dropdown. */
  grnTypeStats: Record<QcGrnType, StageStat>;
  pendingCount: number;
  completeCount: number;
  pcsPending: number;
  /** ADR-251: the same three totals over the Incoming QC screen's GRN Types
   *  (Direct Purchase + Party GRN) only — that screen's summary line. */
  incomingTotals: { pendingCount: number; completeCount: number; pcsPending: number };
  loaded: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
}

function stageStatsOf(s: QcRegisterSummary | undefined, view: QcView): Record<QcStage, StageStat> {
  const one = (k: QcStage): StageStat => {
    const st = s?.stages[k];
    return {
      count: (view === 'pending' ? st?.pendingCount : st?.doneCount) ?? 0,
      pcsPending: st?.pcsPending ?? 0,
      done: st?.doneCount ?? 0,
      doneCapped: false,
    };
  };
  return { incoming: one('incoming'), inprocess: one('inprocess'), final: one('final') };
}

function grnTypeStatsOf(
  s: QcRegisterSummary | undefined,
  view: QcView,
): Record<QcGrnType, StageStat> {
  const one = (k: QcGrnType): StageStat => {
    // `?.` on grnTypes: an API build older than ADR-251 does not send it.
    const st = s?.grnTypes?.[k];
    return {
      count: (view === 'pending' ? st?.pendingCount : st?.doneCount) ?? 0,
      pcsPending: st?.pcsPending ?? 0,
      done: st?.doneCount ?? 0,
      doneCapped: false,
    };
  };
  return {
    purchase: one('purchase'),
    party_grn: one('party_grn'),
    job_work_return: one('job_work_return'),
    nc_return: one('nc_return'),
  };
}

export function useQcCallData(args: {
  view: QcView;
  stage: QcStage | null;
  /** Debounced search term ('' = none). */
  search: string;
  mineOnly: boolean;
  /** ADR-251: only incoming calls of these GRN Types; undefined = no narrowing. */
  grnType: readonly QcGrnType[] | undefined;
  /** ADR-200 Sort & Filter param of the table on show (useServerSortFilter). */
  sf: string | undefined;
  /** 1-based page. */
  page: number;
}): QcCallData {
  const { view, stage, search, mineOnly, grnType, sf, page } = args;
  // A stable key for the memo below — the caller may build a fresh array.
  const grnTypeKey = grnType?.join(',') ?? '';
  const query = useMemo(
    (): Omit<QcRegisterQuery, 'limit' | 'offset'> => ({
      view,
      stage: stage ?? undefined,
      search: search || undefined,
      // "Mine" is a pending-queue filter: QC Command assigns open calls only.
      mine: view === 'pending' && mineOnly ? 'true' : undefined,
      grnType: grnTypeKey ? (grnTypeKey.split(',') as QcGrnType[]) : undefined,
      // In the query (not only the page read) so Export gets the same rows.
      sf,
    }),
    [view, stage, search, mineOnly, grnTypeKey, sf],
  );
  const res = useQcRegister({ ...query, limit: LIST_PAGE_SIZE, offset: pageOffset(page) });
  const data = res.data;
  // While a switched view loads, the previous page stays up as a placeholder —
  // but a pending page must never be drawn with the completed columns (or the
  // reverse), so rows from the other view are held back.
  const dataView = useRef<QcView>(view);
  if (data && !res.isPlaceholderData) dataView.current = view;
  const items = dataView.current === view ? (data?.items ?? []) : [];
  const summary = data?.summary;
  const stageStats = useMemo(() => stageStatsOf(summary, view), [summary, view]);
  const grnTypeStats = useMemo(() => grnTypeStatsOf(summary, view), [summary, view]);
  const incomingTotals = useMemo(() => {
    let pendingCount = 0;
    let completeCount = 0;
    let pcsPending = 0;
    for (const t of INCOMING_QC_GRN_TYPES) {
      const st = summary?.grnTypes?.[t];
      pendingCount += st?.pendingCount ?? 0;
      completeCount += st?.doneCount ?? 0;
      pcsPending += st?.pcsPending ?? 0;
    }
    return { pendingCount, completeCount, pcsPending };
  }, [summary]);

  return {
    query,
    pendingRows: view === 'pending' ? (items as QcRegisterPendingItem[]) : [],
    completedRows: view === 'completed' ? (items as QcRegisterCompletedItem[]) : [],
    total: data?.total ?? 0,
    stageStats,
    grnTypeStats,
    pendingCount: summary?.pendingCount ?? 0,
    completeCount: summary?.completeCount ?? 0,
    pcsPending: summary?.pcsPending ?? 0,
    incomingTotals,
    loaded: data !== undefined,
    isLoading: res.isLoading,
    isFetching: res.isFetching,
    error: res.error,
  };
}

/** ADR-200 server Sort & Filter: one state per table (Pending / Completed, and
 *  their own keys on Incoming QC). `sf` is the one on show; a change goes to page 1. */
export function useQcTableSf(
  incoming: boolean,
  view: QcView,
  gotoPage: (p: number) => void,
): {
  pendKey: string;
  compKey: string;
  pendSf: ServerSortFilter;
  compSf: ServerSortFilter;
  sf: ServerSortFilter;
} {
  const pendKey = incoming ? TABLE_KEYS.incomingQcCallPending : TABLE_KEYS.qcCallPending;
  const compKey = incoming ? TABLE_KEYS.incomingQcCallCompleted : TABLE_KEYS.qcCallCompleted;
  const pendSf = useServerSortFilter(pendKey, () => gotoPage(1));
  const compSf = useServerSortFilter(compKey, () => gotoPage(1));
  return { pendKey, compKey, pendSf, compSf, sf: view === 'pending' ? pendSf : compSf };
}
