// Job Card Operations tab — the per-op NC notes line under the operations
// table. The column legend and the "Job Card check" footer were removed by the
// owner (2026-11-02); the same figures stay on the Check fact's hover and in
// each row's ✓ hover.
//
// The WORDING and every figure are today's Op Qty Flow notes
// (flow-views/components/jc-flow-panels.tsx `OpFlowNotes`, L223-302, and
// `checkText`, L67-71). That file exports neither, and it is not ours to edit,
// so the text is copied here verbatim; change both together. Every number is
// the server's (GET /flow-views/job-cards/:id/op-flow) — nothing is added up
// on this screen.

import { fmtOpSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import type { OpFlowRow } from '@/modules/flow-views/types';

/** jc-flow-panels.tsx L59-64 — what "Done" means on this kind of op. */
export const doneLabel = (o: OpFlowRow): string =>
  o.opType === 'qc'
    ? 'Done = inspected'
    : o.opType === 'outsource'
      ? 'Done = received back'
      : 'Done = made';

/** jc-flow-panels.tsx L67-71 — the row's sum, shown on hover over ✓. */
export const checkText = (o: OpFlowRow): string =>
  `${o.inputQty} in = ${o.acceptedQty} accepted + ${o.rejectedFinalQty} rejected + ` +
  `${o.deviatedOpenQty} deviated, NC open + ${o.atVendorQty} at vendor + ` +
  `${o.inQcQty} in QC + ${o.pendingQty} pending` +
  (o.unaccountedQty === 0 ? ' ✓' : ` — ${o.unaccountedQty} not accounted for`);

function NcLink({ id, code }: { id: string; code: string }): React.JSX.Element {
  return (
    <Link to="/nc-register/$id" params={{ id }} className="mono fw-700 jc-ops-link">
      {code}
    </Link>
  );
}

/** One note per fact, per op (jc-flow-panels.tsx L231-278). */
function opNotes(ops: OpFlowRow[]): React.ReactNode[] {
  const notes: React.ReactNode[] = [];
  for (const o of ops) {
    const op = `Op ${fmtOpSrNo(o.opSeq)}`;
    if (o.reworkedBackQty !== 0) {
      notes.push(
        <span key={`rw-${o.jcOpId}`} className="jc-ops-note">
          <b>{op}</b>: {o.reworkedBackQty} pcs came back from rework{' '}
          {o.reworkedBackFrom.map((c, i) => (
            <span key={c} className="mono fw-700">
              {i > 0 ? ', ' : ''}
              {c}
            </span>
          ))}{' '}
          (entry LOG-NC-…) — counted in Done and Accepted.
        </span>,
      );
    }
    if (o.returnedToVendorQty > 0) {
      notes.push(
        <span key={`rtv-${o.jcOpId}`} className="jc-ops-note">
          <b>{op}</b>: rework loop — {o.vendorRejectedQty} deviated at incoming QC,{' '}
          {o.returnedToVendorQty} returned to the vendor, {o.reReceivedQty} re-received, accepted{' '}
          {o.acceptedQty}.
        </span>,
      );
    }
    if (o.ncs.length > 0) {
      notes.push(
        <span key={`nc-${o.jcOpId}`} className="jc-ops-note">
          <b>{op}</b>: NC{' '}
          {o.ncs.map((n, i) => (
            <span key={n.id}>
              {i > 0 ? ', ' : ''}
              <NcLink id={n.id} code={n.code} /> <span className="mono">({n.qty})</span>
            </span>
          ))}
        </span>,
      );
    }
    if (o.reversedEntries > 0) {
      notes.push(
        <span key={`rv-${o.jcOpId}`} className="jc-ops-note">
          <b>{op}</b>: {o.reversedEntries} reversed {o.reversedEntries === 1 ? 'entry' : 'entries'}{' '}
          — already taken out of every figure above.
        </span>,
      );
    }
  }
  return notes;
}

export function JcOpsTableNotes({
  ops,
  error,
}: {
  ops: OpFlowRow[];
  /** The op-flow request failed: say so here instead of the notes. */
  error: string | null;
}): React.JSX.Element | null {
  if (error) {
    return <div className="jc-ops-notes jc-ops-bad">{error}</div>;
  }
  const notes = opNotes(ops);
  // Nothing to say on a card with no NC / rework / reversal: no empty band.
  return notes.length > 0 ? <div className="jc-ops-notes">{notes}</div> : null;
}
