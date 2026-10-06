// Job Card Operations tab — the NC notes line and the "Job Card check"
// footer under the operations table.
//
// The WORDING and every figure are today's Op Qty Flow notes
// (flow-views/components/jc-flow-panels.tsx `OpFlowNotes`, L223-302, and
// `checkText`, L67-71). That file exports neither, and it is not ours to edit,
// so the text is copied here verbatim; change both together. Every number is
// the server's (GET /flow-views/job-cards/:id/op-flow) — nothing is added up
// on this screen.
//
// Layout follows the approved mock-up: the per-op notes and the column legend
// run as one line under the table; the Job Card check is the footer.
import { fmtOpSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import type { OpFlowResponse, OpFlowRow } from '@/modules/flow-views/types';

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
          <b>{op}</b>: rework loop — sent {o.vendorSentQty - o.returnedToVendorQty},{' '}
          {o.vendorRejectedQty} deviated at incoming QC, {o.returnedToVendorQty} re-sent to the
          vendor, {o.reReceivedQty} re-received · total sent {o.vendorSentQty}, received{' '}
          {o.vendorReceivedQty}, accepted {o.acceptedQty}.
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
}): React.JSX.Element {
  if (error) {
    return <div className="jc-ops-notes jc-ops-bad">{error}</div>;
  }
  const notes = opNotes(ops);
  return (
    <div className="jc-ops-notes">
      {notes}
      {/* jc-flow-panels.tsx L295-297 — the column legend. */}
      <span className="jc-ops-note">
        <b>Deviated</b> = failed inspection, sent to an NC for a decision · <b>Reworked</b> = the NC
        recovered it and it was accepted · <b>Rejected</b> = the final NC decision. Hover ✓ for the
        row&apos;s sum.
      </span>
    </div>
  );
}

/** jc-flow-panels.tsx L281-293 — the Job Card check sentence, now the footer. */
export function JcOpsTableCheck({
  check,
}: {
  check: OpFlowResponse['jobCardCheck'] | undefined;
}): React.JSX.Element | null {
  if (!check) return null;
  return (
    <div className="jc-ops-check">
      <b>Job Card check:</b> {check.ordered} ordered ={' '}
      <b className="jc-ops-good">{check.finished} finished</b> + {check.pending} pending +{' '}
      {check.inQc} in QC + {check.atVendor} at vendor + {check.deviatedOpen} deviated (NC open) +{' '}
      {check.rejected} rejected{' '}
      {check.unaccounted === 0 ? (
        <b className="jc-ops-good">✓</b>
      ) : (
        <b className="jc-ops-bad">⚠ {check.unaccounted} not accounted for</b>
      )}
    </div>
  );
}
