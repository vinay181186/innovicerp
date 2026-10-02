// QC Call Register — the Inspect popup target: which pending call (if any) the
// accept/reject popup is open on, the ?line= / ?op= deep-link that opens it, and
// the auto-close when its row leaves the queue. Split out of routes/index.tsx so
// that file stays under the 400-line ceiling.
//
// ADR-201: the register holds only one page, so the popup's call is read on
// its own (GET /qc-history/register with jcOpId / grnLineId, one row) — a deep
// link to a call on page 3 still opens, and the row is always fresh.

import type {
  IncomingQcPendingRow,
  QcHistoryPendingRow,
  QcRegisterPendingItem,
} from '@innovic/shared';
import { useEffect, useRef, useState } from 'react';
import { useQcRegister } from '@/modules/qc-history/api';

// Only the id is kept — the row itself is always read fresh off the server, so
// a refetch cannot leave the box on stale figures.
export type InspectTarget =
  | { kind: 'op'; jcOpId: string }
  | { kind: 'inc'; grnLineId: string }
  | null;

export function useQcInspect(args: {
  /** The page on screen — the popup opens on its row at once while the
   *  one-row read loads. */
  pageRows: QcRegisterPendingItem[];
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
  const { pageRows, lineParam, opParam, stripParam } = args;
  const [inspect, setInspect] = useState<InspectTarget>(null);

  // The call to read: the open popup's, else a deep link not yet consumed.
  const target: InspectTarget =
    inspect ??
    (opParam
      ? { kind: 'op', jcOpId: opParam }
      : lineParam
        ? { kind: 'inc', grnLineId: lineParam }
        : null);
  const lookup = useQcRegister(
    {
      view: 'pending',
      jcOpId: target?.kind === 'op' ? target.jcOpId : undefined,
      grnLineId: target?.kind === 'inc' ? target.grnLineId : undefined,
      limit: 1,
      offset: 0,
    },
    target !== null,
    false,
  );
  // A pending-view read, so its row is a pending call.
  const fresh = lookup.data?.items[0] as QcRegisterPendingItem | undefined;

  const findOp = (id: string): QcHistoryPendingRow | null => {
    if (fresh?.kind === 'op' && fresh.row.jcOpId === id) return fresh.row;
    if (lookup.data) return null;
    const p = pageRows.find((r) => r.kind === 'op' && r.row.jcOpId === id);
    return p?.kind === 'op' ? p.row : null;
  };
  const findInc = (id: string): IncomingQcPendingRow | null => {
    if (fresh?.kind === 'inc' && fresh.row.grnLineId === id) return fresh.row;
    if (lookup.data) return null;
    const p = pageRows.find((r) => r.kind === 'inc' && r.row.grnLineId === id);
    return p?.kind === 'inc' ? p.row : null;
  };
  const inspectOp = inspect?.kind === 'op' ? findOp(inspect.jcOpId) : null;
  const inspectInc = inspect?.kind === 'inc' ? findInc(inspect.grnLineId) : null;

  // DEEP LINK — ?line= / ?op= open the popup once the call has been read and is
  // still waiting. Acted on once per id, then the param is stripped (so a
  // refresh does not throw the box up again). A call not in the queue opens
  // nothing; the param is still consumed.
  const autoOpenedRef = useRef<string | null>(null);
  useEffect(() => {
    if (inspect || !lookup.data) return;
    if (opParam && autoOpenedRef.current !== `op:${opParam}`) {
      autoOpenedRef.current = `op:${opParam}`;
      if (fresh?.kind === 'op' && fresh.row.jcOpId === opParam) {
        setInspect({ kind: 'op', jcOpId: opParam });
      }
      stripParam('op');
    } else if (!opParam && lineParam && autoOpenedRef.current !== `inc:${lineParam}`) {
      autoOpenedRef.current = `inc:${lineParam}`;
      if (fresh?.kind === 'inc' && fresh.row.grnLineId === lineParam) {
        setInspect({ kind: 'inc', grnLineId: lineParam });
      }
      stripParam('line');
    }
  }, [inspect, lookup.data, fresh, opParam, lineParam, stripParam]);

  // The call vanished after a refetch — fully inspected elsewhere, or
  // withdrawn — so close rather than keep a form up for a call that no longer
  // needs one. Only once its read has come back.
  useEffect(() => {
    if (inspect && lookup.data && lookup.data.items.length === 0) setInspect(null);
  }, [inspect, lookup.data]);

  return { inspect, setInspect, inspectOp, inspectInc };
}
