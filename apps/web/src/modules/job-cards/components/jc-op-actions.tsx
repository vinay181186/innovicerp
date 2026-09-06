// OUTSOURCE slot + footer NEXT ACTION for one JC operation card.
//
// Split out of jc-op-card.tsx (which was already at the 400-line limit) — this
// file owns everything that talks to the jc-ops board and everything that is
// permission-gated for an OSP op.
//
// WHY the buttons exist at all: the card used to END the OSP story in dead
// text. An op sitting at `pr_raised` showed "PR: IN-JWPR-00012" and nothing
// else, so the planner had to remember that the next step is a PO, leave the
// Job Card, find the PR again and convert it. Each status now names its own
// next step and links straight to the screen that performs it.
//
// WHY no "Gen GRN": receiving the outward challan is what books the GRN, so one
// link covers both. GRN also sits in the Store department, which shop-floor
// users rarely hold — one link, one department.
import type { JcOpEnriched, JcOpsBoardRow, OutsourceStatus } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useJcOpsBoard } from '@/modules/jc-ops/api';
import { OUTSOURCE_STATUS_LABEL } from '../lib/jc-op-labels';

// Outsource vendor/PR/PO details for a JC op. Wired from the existing jc-ops
// board endpoint (useJcOpsBoard, jc-ops/api.ts:31), whose row already carries
// outsourceVendorName / outsourcePrCode / outsourcePoCode (jc-ops.ts:39-41,
// populated in jc-ops/service.ts:70-72) — fields the op-entry enriched op shape
// omits. Legacy renders these at L11043 (vendor name) and L11070-74 (PR/PO).
// The same row now also carries the PKs the next-action links need
// (outsourcePrId / outsourcePoId / outsourceOpenDcId).
function useOutsourceRow(jcCode: string, jcOpId: string): JcOpsBoardRow | undefined {
  const { data } = useJcOpsBoard({ jcCode, limit: 500, offset: 0 });
  return data?.items.find((r) => r.jcOpId === jcOpId);
}

// OUTSOURCE block for an outsource op (was the Machine cell, legacy L11043):
// label + resolved vendor name + status.
export function OutsourceInfo({
  jcCode,
  jcOpId,
  status,
}: {
  jcCode: string;
  jcOpId: string;
  status: OutsourceStatus;
}): React.JSX.Element {
  const row = useOutsourceRow(jcCode, jcOpId);
  return (
    <>
      <div style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 700 }}>🏭 Outsource</div>
      {row?.outsourceVendorName ? (
        <div style={{ fontSize: 10, color: 'var(--text2)' }}>{row.outsourceVendorName}</div>
      ) : null}
      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{OUTSOURCE_STATUS_LABEL[status]}</div>
    </>
  );
}

// The NEXT ACTION for an outsource op, gated on the form key of the page it
// OPENS (not on jc_create, the page it sits on) — a button gated on a different
// key than its destination is the "button that only fails on click" pattern
// (purchase-requests/routes/detail.tsx:33-38). Hidden, never disabled, when the
// caller lacks the right; hidden too until the access matrix has loaded, which
// is what every other action button here does (pr-card.tsx:212,
// jc-row-write-actions.tsx:25).
//
// Each link also needs its id: a status with no id behind it (e.g. `sent` with
// every challan already received) renders text only, as before.
function OutsourceNextAction({
  row,
  status,
}: {
  row: JcOpsBoardRow | undefined;
  status: OutsourceStatus;
}): React.JSX.Element | null {
  const { data: eff } = useMyAccess();
  if (!row) return null;

  // pr_raised → raise the PO from that PR. Same destination and same gate as
  // the PR page's own "Create PO" button.
  if (status === 'pr_raised' && row.outsourcePrId && effectiveFormPerms(eff, 'po_create').entry) {
    return (
      <Link
        to="/purchase-orders/from-pr"
        search={{ prId: row.outsourcePrId }}
        className="btn btn-sm btn-primary"
        title="Raise the purchase order for this outsourced operation"
      >
        🧾 Gen PO
      </Link>
    );
  }

  // po_created → send the material out on an outward challan against that PO.
  if (status === 'po_created' && row.outsourcePoId && effectiveFormPerms(eff, 'ospdc_create').entry) {
    return (
      <Link
        to="/delivery-challans/new"
        search={{ poId: row.outsourcePoId }}
        className="btn btn-sm btn-primary"
        title="Raise the outward delivery challan for this purchase order"
      >
        🚚 Gen DC
      </Link>
    );
  }

  // sent → receive the ONE challan still out at the vendor. The server picks it
  // (oldest still-issued DC on this op's PO line), because an op can have
  // several: IN-JC-26-00008 op 8 carries IN-DC-00002 (received), IN-DC-00006
  // (cancelled) and IN-DC-00007 (issued) and only the last is receivable.
  // IN-JC-26-00011 op 3 is the plain case — `sent`, with IN-DC-00005 open.
  if (
    status === 'sent' &&
    row.outsourceOpenDcId &&
    effectiveFormPerms(eff, 'ospdc_create').entry
  ) {
    return (
      <Link
        to="/delivery-challans/$id/receive"
        params={{ id: row.outsourceOpenDcId }}
        className="btn btn-sm btn-primary"
        title="Receive this challan back from the vendor (this also books the GRN)"
      >
        📥 Receive {row.outsourceOpenDcCode ?? 'challan'}
      </Link>
    );
  }

  // received → the material is back and waiting to be inspected.
  if (status === 'received' && effectiveFormPerms(eff, 'qc_incoming').view) {
    return (
      <Link
        to="/incoming-qc"
        className="btn btn-sm btn-primary"
        title="Inspect the material received back from the vendor"
      >
        🔬 Incoming QC
      </Link>
    );
  }

  return null;
}

// Footer strip for an outsource op (legacy L11070-74): the reference — PR code
// when a PR is raised, PO code when a PO is created, otherwise the status — and
// beside it the button that carries that reference forward.
//
// The reference text is NOT permission-gated: it is information, and the whole
// Job Card page is already gated on jc_create.view by its route. Only the
// button is gated.
export function OutsourceActionRefs({
  jcCode,
  jcOpId,
  status,
}: {
  jcCode: string;
  jcOpId: string;
  status: OutsourceStatus;
}): React.JSX.Element {
  const row = useOutsourceRow(jcCode, jcOpId);
  const ref =
    status === 'pr_raised' && row?.outsourcePrCode ? (
      <span style={{ fontSize: 11, color: 'var(--blue)' }}>PR: {row.outsourcePrCode}</span>
    ) : status === 'po_created' && row?.outsourcePoCode ? (
      <span style={{ fontSize: 11, color: 'var(--cyan)' }}>PO: {row.outsourcePoCode}</span>
    ) : (
      <span style={{ fontSize: 11, color: 'var(--purple)' }}>{OUTSOURCE_STATUS_LABEL[status]}</span>
    );
  return (
    <>
      {ref}
      <OutsourceNextAction row={row} status={status} />
    </>
  );
}

// ── The card's FOOTER strip: the table's old Action cell, now the operation's
//    NEXT ACTION — and the one place on this card where anything is
//    permission-gated.
//
// Every button is gated on the form key of the page it OPENS, never on
// jc_create (the page it sits on): a button gated on a different key than its
// destination is the "button that only fails on click" pattern
// (purchase-requests/routes/detail.tsx:33-38).
//
// Buttons HIDE when the right is missing — this codebase never disables on a
// permission failure — and stay hidden until the access matrix has loaded,
// which is what the other action buttons do (jc-row-write-actions.tsx:25,
// pr-card.tsx:212). Text (quantities, "Sent", "PR: IN-JWPR-00012") is NOT
// gated: it is information, and the route already gates the page on
// jc_create.view.
//
// Returns null — no strip, no top border — when a fully gated-out user would
// otherwise be shown an empty ruled-off band.
export function JcOpFooter({
  jcCode,
  op,
  onStart,
  onLog,
  onQc,
}: {
  jcCode: string;
  op: JcOpEnriched;
  onStart: (opId: string) => void;
  onLog: (opId: string) => void;
  onQc: () => void;
}): React.JSX.Element | null {
  const { data: eff } = useMyAccess();
  const isQc = op.opType === 'qc';
  const isOut = op.opType === 'outsource';

  // ▶ Start and ✚ Log both write op entries, which guard on op_entry.entry.
  const canOpEntry = effectiveFormPerms(eff, 'op_entry').entry;
  // 🔬 QC opens the QC Call Register (read of the pending list) → qc_submit.view.
  const canQc = effectiveFormPerms(eff, 'qc_submit').view;
  // 📋 TPI opens the same screen's TPI tab, whose submit enforces BOTH keys
  // (tpi/components/tpi-view.tsx:317-319) — mirror that so the link hides
  // exactly when the server would refuse the entry.
  const canTpi =
    effectiveFormPerms(eff, 'qc_submit').entry && effectiveFormPerms(eff, 'tpi_submit').entry;
  // ⚠ NC opens /nc-register/new, which guards on nc_dispose.entry.
  const canNc = effectiveFormPerms(eff, 'nc_dispose').entry;

  const showLog =
    !isOut &&
    !isQc &&
    canOpEntry &&
    (op.computedStatus === 'in_progress' ||
      op.computedStatus === 'running' ||
      op.completedQty > 0);
  const showStart =
    !isQc &&
    !isOut &&
    canOpEntry &&
    (op.computedStatus === 'available' || op.computedStatus === 'waiting');
  const showDone = !isOut && !isQc && op.computedStatus === 'complete';
  // A third-party-inspection op is an ordinary QC op whose operation name says
  // TPI (e.g. "TPI Final Inspection") — the routing carries no separate flag.
  const isTpi = isQc && op.operation.toLowerCase().includes('tpi');
  const showQcBtn = isQc && op.qcPending > 0 && canQc;
  // The QC branch's plain text ("✓ QC Done" / "Waiting") only ever showed when
  // nothing was pending, exactly as before.
  const showQcText = isQc && op.qcPending === 0;

  const hasFooter =
    isOut || showDone || showLog || showStart || showQcBtn || showQcText || (isTpi && canTpi) || canNc;
  if (!hasFooter) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        marginTop: 10,
        paddingTop: 8,
        borderTop: '1px solid var(--border)',
      }}
    >
      {isOut ? (
        <OutsourceActionRefs
          jcCode={jcCode}
          jcOpId={op.id}
          status={op.outsourceStatus ?? 'pending'}
        />
      ) : isQc ? (
        showQcBtn ? (
          <button
            type="button"
            className="btn btn-sm"
            style={{ color: 'var(--green)' }}
            onClick={onQc}
          >
            🔬 QC ({op.qcPending})
          </button>
        ) : showQcText ? (
          op.computedStatus === 'complete' ? (
            <span style={{ color: 'var(--green)', fontSize: 12 }}>✓ QC Done</span>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>Waiting</span>
          )
        ) : null
      ) : showDone ? (
        <span style={{ color: 'var(--green)', fontSize: 12 }}>✓ Done</span>
      ) : showLog ? (
        /* T33: Log only once the op is started; otherwise the Start button
           below is the only action shown. */
        <button type="button" className="btn btn-sm btn-primary" onClick={() => onLog(op.id)}>
          ✚ Log
        </button>
      ) : null}
      {showStart ? (
        <button type="button" className="btn btn-sm" onClick={() => onStart(op.id)}>
          ▶ Start
        </button>
      ) : null}
      {/* Third-party inspection lives on the QC Call Register's TPI tab (the old
          /tpi page was folded in as a tab). ?tab=tpi lands there directly
          instead of on the process-QC list the inspector then switches away
          from. */}
      {isTpi && canTpi ? (
        <Link
          to="/qc-call-register"
          search={{ tab: 'tpi' }}
          className="btn btn-sm"
          title="Open the TPI tab of the QC Call Register"
        >
          📋 TPI
        </Link>
      ) : null}
      {/* A fault can be found at ANY operation — process, QC or at the vendor —
          so Report NC sits on every card. Last in the strip and quiet: it is the
          exception path, not the next step. */}
      {canNc ? (
        <Link
          to="/nc-register/new"
          className="btn btn-sm btn-ghost"
          title="Report a non-conformance found at this operation"
        >
          ⚠ NC
        </Link>
      ) : null}
    </div>
  );
}
