// QC Call Register — the register's data (ADR-201). One page of 25 calls from
// GET /qc-history/register: incoming (GRN line) and process (job-card op)
// calls paged TOGETHER on the server, with search, the stage and "Mine"
// applied there over EVERY call. The stage counts and the register totals are
// the server's whole-register summary — never counted from the loaded page.

import type {
  QcRegisterCompletedItem,
  QcRegisterPendingItem,
  QcRegisterQuery,
  QcRegisterSummary,
} from '@innovic/shared';
import { useMemo, useRef } from 'react';
import { LIST_PAGE_SIZE, pageOffset } from '@/lib/list-paging';
import { useQcRegister } from '@/modules/qc-history/api';
import type { QcStage, QcView, StageStat } from './qc-sheet';

export interface QcCallData {
  /** The register query (without paging) — the export reuses it. */
  query: Omit<QcRegisterQuery, 'limit' | 'offset'>;
  /** This page's pending calls (view = pending). */
  pendingRows: QcRegisterPendingItem[];
  /** This page's completed entries (view = completed), newest first. */
  completedRows: QcRegisterCompletedItem[];
  /** Calls matching view + stage + search + Mine, over all pages. */
  total: number;
  /** Stage figures over the WHOLE register, for the stage dropdown. */
  stageStats: Record<QcStage, StageStat>;
  pendingCount: number;
  completeCount: number;
  pcsPending: number;
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

export function useQcCallData(args: {
  view: QcView;
  stage: QcStage | null;
  /** Debounced search term ('' = none). */
  search: string;
  mineOnly: boolean;
  /** 1-based page. */
  page: number;
}): QcCallData {
  const { view, stage, search, mineOnly, page } = args;
  const query = useMemo(
    (): Omit<QcRegisterQuery, 'limit' | 'offset'> => ({
      view,
      stage: stage ?? undefined,
      search: search || undefined,
      // "Mine" is a pending-queue filter: QC Command assigns open calls only.
      mine: view === 'pending' && mineOnly ? 'true' : undefined,
    }),
    [view, stage, search, mineOnly],
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

  return {
    query,
    pendingRows: view === 'pending' ? (items as QcRegisterPendingItem[]) : [],
    completedRows: view === 'completed' ? (items as QcRegisterCompletedItem[]) : [],
    total: data?.total ?? 0,
    stageStats,
    pendingCount: summary?.pendingCount ?? 0,
    completeCount: summary?.completeCount ?? 0,
    pcsPending: summary?.pcsPending ?? 0,
    loaded: data !== undefined,
    isLoading: res.isLoading,
    isFetching: res.isFetching,
    error: res.error,
  };
}
