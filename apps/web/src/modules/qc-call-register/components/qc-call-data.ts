// QC Call Register — data derivation (search / stage / Mine filtering, the stage
// counts and the register totals). Split out of routes/index.tsx so that file
// stays under the 400-line ceiling. Pure read logic over the two feeds the page
// loads (process QC from qc-history, incoming QC from incoming-qc); no writes.

import type {
  IncomingQcCompletedRow,
  IncomingQcPendingRow,
  IncomingQcResponse,
  QcHistoryLogRow,
  QcHistoryPendingRow,
  QcHistoryResponse,
} from '@innovic/shared';
import { useMemo } from 'react';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { type QcStage, type QcView, type StageStat, processStage } from './qc-sheet';

// The endpoint caps the completed log at 500 rows, so a browser-side count that
// lands exactly on the cap is a floor, not a total.
const LOG_SERVER_CAP = 500;
// How many completed entries the register lists (the /qc-history page shows the
// full capped feed; this screen is the working queue, not the archive).
const LOG_SHOWN = 30;

function emptyStat(): StageStat {
  return { count: 0, pcsPending: 0, done: 0, doneCapped: false };
}

export interface QcCallData {
  /** Whole process-QC pending feed (unfiltered) — the popup + deep-link read it. */
  allPending: QcHistoryPendingRow[];
  /** Whole incoming-QC pending feed (unfiltered). */
  incPending: IncomingQcPendingRow[];
  /** Filtered (search · stage · Mine) process-QC pending rows. */
  pending: QcHistoryPendingRow[];
  /** Filtered completed process-QC log rows (then cut to LOG_SHOWN). */
  logs: QcHistoryLogRow[];
  /** Filtered incoming-QC pending rows. */
  incPendingF: IncomingQcPendingRow[];
  /** Filtered incoming-QC completed rows. */
  incCompletedF: IncomingQcCompletedRow[];
  /** Stage counts over the WHOLE register, for the stage dropdown. */
  stageStats: Record<QcStage, StageStat>;
  pendingCount: number;
  completeCount: number;
  pcsPending: number;
}

export function useQcCallData(args: {
  data: QcHistoryResponse | undefined;
  incoming: IncomingQcResponse | undefined;
  view: QcView;
  stage: QcStage | null;
  search: string;
  mineOnly: boolean;
  /** The signed-in user's full name + short form, lower-cased, for "Mine". */
  myNames: ReadonlySet<string>;
}): QcCallData {
  const { data, incoming, view, stage, search, mineOnly, myNames } = args;

  const allPending = useMemo(() => data?.pending ?? [], [data]);
  const allLogsFull = useMemo(() => data?.logs ?? [], [data]);
  const incPending = useMemo(() => incoming?.pending ?? [], [incoming]);
  const incCompleted = useMemo(() => incoming?.completed ?? [], [incoming]);

  // Server-owned count (op_log COUNT(*) where log_type='qc'). `data.logs` is
  // capped at LIMIT 500 by the endpoint, so counting it in the browser silently
  // under-reports past 500 entries.
  const completeCount = (data?.stats.totalEntries ?? 0) + incCompleted.length;
  const pendingCount = (data?.stats.pendingOps ?? 0) + incPending.length;
  const pcsPending =
    allPending.reduce((n, o) => n + o.qcPending, 0) +
    incPending.reduce((n, o) => n + o.pendingQty, 0);

  // Stage counts — over the whole register, not the searched subset, so the
  // dropdown reads as the register's totals and picking a stage does not zero
  // its neighbours. "done" for the two process stages is counted over the capped
  // 500-row log, so it shows as a floor ("500+") once the cap is hit.
  const stageStats = useMemo(() => {
    const st: Record<QcStage, StageStat> = {
      incoming: emptyStat(),
      inprocess: emptyStat(),
      final: emptyStat(),
    };
    for (const o of incPending) st.incoming.pcsPending += o.pendingQty;
    for (const o of allPending) st[processStage(o.isLastOp)].pcsPending += o.qcPending;
    st.incoming.done = incCompleted.length;
    for (const l of allLogsFull) st[processStage(l.isLastOp)].done += 1;
    const capped = allLogsFull.length >= LOG_SERVER_CAP;
    st.inprocess.doneCapped = capped;
    st.final.doneCapped = capped;
    if (view === 'pending') {
      st.incoming.count = incPending.length;
      for (const o of allPending) st[processStage(o.isLastOp)].count += 1;
    } else {
      st.incoming.count = incCompleted.length;
      for (const l of allLogsFull) st[processStage(l.isLastOp)].count += 1;
    }
    return st;
  }, [view, incPending, allPending, incCompleted, allLogsFull]);

  // Search covers every column the row shows (the revision is part of the item
  // code; the part name searches on the same footing as the code). These filters
  // run over rows already loaded, so widening them cannot hide anything the
  // server did send.
  const matchP = (o: QcHistoryPendingRow): boolean =>
    matchesSearchTerm(
      [o.jcCode, o.soCode, o.clientPoLineNo, o.itemCode, o.itemRevision, o.itemName, o.operation],
      search,
    );
  const matchC = (l: QcHistoryLogRow): boolean =>
    matchesSearchTerm(
      [l.jcCode, l.soCode, l.clientPoLineNo, l.itemCode, l.itemRevision, l.itemName, l.operation],
      search,
    );
  const matchIncP = (o: IncomingQcPendingRow): boolean =>
    matchesSearchTerm(
      [o.grnNo, o.clientPoLineNo, o.itemCode, o.itemRevision, o.itemName, o.vendorName, o.poCode],
      search,
    );
  const matchIncC = (l: IncomingQcCompletedRow): boolean =>
    matchesSearchTerm(
      [l.grnNo, l.clientPoLineNo, l.itemCode, l.itemRevision, l.itemName, l.vendorName],
      search,
    );
  const inStage = (s: QcStage): boolean => stage === null || stage === s;
  const isMine = (o: QcHistoryPendingRow): boolean =>
    !!o.assignedTo && myNames.has(o.assignedTo.trim().toLowerCase());

  const pending = allPending.filter(
    (o) => inStage(processStage(o.isLastOp)) && matchP(o) && (!mineOnly || isMine(o)),
  );
  // Search + stage run over EVERY log the server sent (up to 500), and only then
  // is the list cut to LOG_SHOWN — so a card inspected 40 entries ago is still
  // found by its number instead of silently reading "no entries".
  const logs = allLogsFull
    .filter((l) => inStage(processStage(l.isLastOp)) && matchC(l))
    .slice(0, LOG_SHOWN);
  // Incoming (GRN) calls carry no QC Command assignment, so "Mine" hides them.
  const incPendingF = inStage('incoming') && !mineOnly ? incPending.filter(matchIncP) : [];
  const incCompletedF = inStage('incoming') ? incCompleted.filter(matchIncC) : [];

  return {
    allPending,
    incPending,
    pending,
    logs,
    incPendingF,
    incCompletedF,
    stageStats,
    pendingCount,
    completeCount,
    pcsPending,
  };
}
