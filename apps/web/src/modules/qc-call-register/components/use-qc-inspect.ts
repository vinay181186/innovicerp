// QC Call Register — the Inspect popup target: which pending call (if any) the
// accept/reject popup is open on, the ?line= / ?op= deep-link that opens it, and
// the auto-close when its row leaves the feed. Split out of routes/index.tsx so
// that file stays under the 400-line ceiling.

import type {
  IncomingQcPendingRow,
  IncomingQcResponse,
  QcHistoryPendingRow,
  QcHistoryResponse,
} from '@innovic/shared';
import { useEffect, useRef, useState } from 'react';

// Only the id is kept — the row itself is always read fresh off the feed, so a
// refetch cannot leave the box on stale figures.
export type InspectTarget =
  | { kind: 'op'; jcOpId: string }
  | { kind: 'inc'; grnLineId: string }
  | null;

export function useQcInspect(args: {
  /** Whole pending feeds (unfiltered) — the popup + deep-link read them. */
  allPending: QcHistoryPendingRow[];
  incPending: IncomingQcPendingRow[];
  data: QcHistoryResponse | undefined;
  incomingData: IncomingQcResponse | undefined;
  lineParam: string | undefined;
  opParam: string | undefined;
  /** Strip a consumed deep-link param from the URL (replace). */
  stripParam: (key: 'line' | 'op') => void;
}): {
  inspect: InspectTarget;
  setInspect: (t: InspectTarget) => void;
  inspectOp: QcHistoryPendingRow | null;
  inspectInc: IncomingQcPendingRow | null;
} {
  const { allPending, incPending, data, incomingData, lineParam, opParam, stripParam } = args;
  const [inspect, setInspect] = useState<InspectTarget>(null);

  // The popup's row, read fresh off the WHOLE feed (not the searched subset, so
  // typing in the search box while the box is up does not close it).
  const inspectOp =
    inspect?.kind === 'op' ? (allPending.find((o) => o.jcOpId === inspect.jcOpId) ?? null) : null;
  const inspectInc =
    inspect?.kind === 'inc'
      ? (incPending.find((o) => o.grnLineId === inspect.grnLineId) ?? null)
      : null;

  // DEEP LINK — ?line= / ?op= open the popup once the matching feed has loaded
  // and the call is in it. Acted on once per id, then the param is stripped (so
  // a refresh does not throw the box up again) — the op-entry pattern. A call
  // not in the queue opens nothing; the param is still consumed.
  const autoOpenedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!lineParam || !incomingData || autoOpenedRef.current === `inc:${lineParam}`) return;
    autoOpenedRef.current = `inc:${lineParam}`;
    if (incPending.some((o) => o.grnLineId === lineParam)) {
      setInspect({ kind: 'inc', grnLineId: lineParam });
    }
    stripParam('line');
  }, [lineParam, incomingData, incPending, stripParam]);
  useEffect(() => {
    if (!opParam || !data || autoOpenedRef.current === `op:${opParam}`) return;
    autoOpenedRef.current = `op:${opParam}`;
    if (allPending.some((o) => o.jcOpId === opParam)) setInspect({ kind: 'op', jcOpId: opParam });
    stripParam('op');
  }, [opParam, data, allPending, stripParam]);

  // The row vanished after a refetch — fully inspected elsewhere, or the call
  // was withdrawn — so close rather than keep a form up for a call that no
  // longer needs one. Only once its feed has loaded, or the box would shut on
  // the poll's first empty render.
  useEffect(() => {
    if (inspect?.kind === 'op' && data && !allPending.some((o) => o.jcOpId === inspect.jcOpId)) {
      setInspect(null);
    }
    if (
      inspect?.kind === 'inc' &&
      incomingData &&
      !incPending.some((o) => o.grnLineId === inspect.grnLineId)
    ) {
      setInspect(null);
    }
  }, [inspect, data, allPending, incomingData, incPending]);

  return { inspect, setInspect, inspectOp, inspectInc };
}
