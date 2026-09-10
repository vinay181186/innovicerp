// OUTSOURCE slot + footer NEXT ACTION for one JC operation card.
//
// Split out of jc-op-card.tsx (which was already at the 400-line limit) — this
// file owns everything that talks to the jc-ops board and everything that is
// permission-gated for an OSP op.
//
// WHY the buttons exist at all: the card used to END the OSP story in dead
// text. An op sitting at `pr_raised` showed "PR: IN-JWPR-00012" and nothing
// else, so the planner had to remember that the next step is a PO, leave the
// Job Card, find the PR again and convert it. The card now names every step
// that is open right now and links straight to the screen that performs it —
// note EVERY step, not one: an op can need two at once (see
// OutsourceNextAction below).
//
// WHY no "Gen GRN": receiving the outward challan is what books the GRN, so one
// link covers both. GRN also sits in the Store department, which shop-floor
// users rarely hold — one link, one department.
//
// THE RULE every control in this file obeys: a button appears only when its
// action can be PERFORMED RIGHT NOW. Not "is this the next step in theory" —
// is there work behind it this minute. So each one is gated on a QUANTITY or an
// ID, never on a status alone, and each mirrors the server's own refusal:
//
//   ▶ Start / ✚ Log   available > 0        (startOp / submitOpLog refuse at 0)
//   🔬 QC / 📋 TPI     qcPending > 0        (nothing waiting to be inspected)
//   ⚠ NC              qcRejectedQty > 0    (nothing was rejected)
//   🚚 Gen DC         readyToSendQty > 0   (nothing cleared to send)
//   📥 Receive        an open challan exists
//   🔬 Incoming QC    inQcQty > 0          (nothing back awaiting inspection)
//   🧾 Gen PO         a PR exists with no PO raised from it
//
// An op whose upstream has cleared nothing therefore shows NO action strip at
// all — IN-JC-26-00013 op 3 (TPI, `waiting`, input 0) used to offer a TPI link
// that could do nothing, because op 2 still has every piece at the vendor.
// A control the user cannot act on is worse than no control: it reads as work
// available and costs a page load to discover it is not.
import type {
  JcOpEnriched,
  JcOpsBoardRow,
  JobCardListItem,
  OutsourceStatus,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { cloneElement } from 'react';
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

// The NEXT ACTIONS for an outsource op, gated on the form key of the page each
// one OPENS (not on jc_create, the page they sit on) — a button gated on a
// different key than its destination is the "button that only fails on click"
// pattern (purchase-requests/routes/detail.tsx:33-38). Hidden, never disabled,
// when the caller lacks the right; hidden too until the access matrix has
// loaded, which is what every other action button here does (pr-card.tsx:212,
// jc-row-write-actions.tsx:25).
//
// WHY this is a LIST and not a single status-picked button: an OSP op can
// genuinely need two actions at the same moment. Some pieces are at the vendor
// waiting to come back while MORE pieces have since cleared the upstream
// operation and are ready to go out on a NEW challan. Live proof:
// IN-JC-26-00013 op 2 is `sent` with IN-DC-00009 still out AND 15 pcs newly
// cleared upstream — it needs Gen DC and Receive at once. Same for
// IN-JC-26-00002 op 1, IN-JC-26-00009 op 3, IN-JC-26-00011 op 3, and
// IN-JC-26-00008 op 8 (which is `received` yet still has 25 ready to send and
// IN-DC-00007 out). Each button below therefore tests its OWN condition —
// quantities and ids, not `outsource_status` — and every applicable one shows.
//
// Each link also needs its id: no id behind a step (e.g. a `sent` op whose
// challans are all received) simply drops that button, as before.
function OutsourceNextAction({
  row,
  op,
}: {
  row: JcOpsBoardRow | undefined;
  op: JcOpEnriched;
}): React.JSX.Element | null {
  const { data: eff } = useMyAccess();
  if (!row) return null;

  const actions: React.JSX.Element[] = [];

  // 1. Gen PO — a PR exists and nothing has been raised from it yet.
  //    IN-JC-26-00003 op 6 and IN-JC-26-00007 op 6 sit here. Same destination
  //    and same gate as the PR page's own "Create PO" button.
  if (row.outsourcePrId && !row.outsourcePoId && effectiveFormPerms(eff, 'po_create').entry) {
    actions.push(
      <Link
        key="po"
        to="/purchase-orders/from-pr"
        search={{ prId: row.outsourcePrId }}
        title="Raise the purchase order for this outsourced operation"
      >
        🧾 Gen PO
      </Link>,
    );
  }

  // 2. Gen DC — a PO exists and pieces are cleared upstream and not yet sent.
  //    STATUS-INDEPENDENT on purpose: IN-JC-26-00008 op 8 is `received` and
  //    still has 25 pcs waiting to go out. The count is on the label so the
  //    planner sees how many without reading the tile.
  if (row.outsourcePoId && op.readyToSendQty > 0 && effectiveFormPerms(eff, 'ospdc_create').entry) {
    actions.push(
      <Link
        key="dc"
        to="/delivery-challans/new"
        search={{ poId: row.outsourcePoId }}
        title="Raise the outward delivery challan for the pieces ready to send"
      >
        🚚 Gen DC ({op.readyToSendQty})
      </Link>,
    );
  }

  // 3. Receive — a challan is still out at the vendor. Also status-independent.
  //    The server picks the challan (oldest still-issued DC on this op's PO
  //    line), because an op can have several: IN-JC-26-00008 op 8 carries
  //    IN-DC-00002 (received), IN-DC-00006 (cancelled) and IN-DC-00007
  //    (issued) and only the last is receivable.
  if (row.outsourceOpenDcId && effectiveFormPerms(eff, 'ospdc_create').entry) {
    actions.push(
      <Link
        key="recv"
        to="/delivery-challans/$id/receive"
        params={{ id: row.outsourceOpenDcId }}
        title="Receive this challan back from the vendor (this also books the GRN)"
      >
        📥 Receive {row.outsourceOpenDcCode ?? 'challan'}
      </Link>,
    );
  }

  // 4. Incoming QC — pieces are back from the vendor and NOT yet inspected.
  //    Driven by inQcQty, not by `status === 'received'`: IN-JC-26-00008 op 8
  //    is `received` with in_qc = 0, i.e. everything is already inspected, so
  //    there is nothing to inspect and the button must not show.
  if (op.inQcQty > 0 && effectiveFormPerms(eff, 'qc_incoming').view) {
    actions.push(
      <Link key="iqc" to="/incoming-qc" title="Inspect the material received back from the vendor">
        🔬 Incoming QC
      </Link>,
    );
  }

  if (actions.length === 0) return null;

  // One primary per card, so the eye has one place to land: the first
  // applicable step leads, the rest are quiet.
  return (
    <>
      {actions.map((a, i) =>
        cloneElement(a, { className: i === 0 ? 'btn btn-sm btn-primary' : 'btn btn-sm' }),
      )}
    </>
  );
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
  op,
}: {
  jcCode: string;
  op: JcOpEnriched;
}): React.JSX.Element {
  const row = useOutsourceRow(jcCode, op.id);
  // The status still supplies the REFERENCE TEXT (unchanged); it no longer
  // decides which buttons appear — see OutsourceNextAction above.
  const status: OutsourceStatus = op.outsourceStatus ?? 'pending';
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
      <OutsourceNextAction row={row} op={op} />
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
  jc,
  op,
  onStart,
  onLog,
  onQc,
}: {
  /** The whole Job Card row: the OSP ladder needs its code, and the ⚠ NC link
   *  seeds the NC form with the JC + item it is raised against. */
  jc: JobCardListItem;
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
  // It is now shown ONLY on a QC operation that actually rejected something:
  // the QC op is what finds the fault and raises the NC, and with no rejects
  // there is nothing to report. (No QC op in the live data has rejects today,
  // so the button is correctly invisible everywhere right now.)
  const showNc = isQc && op.qcRejectedQty > 0 && effectiveFormPerms(eff, 'nc_dispose').entry;

  // A button only appears when the action behind it can actually be PERFORMED
  // right now. `available` is the op's workable qty (upstream cleared − already
  // done), so `available === 0` means the previous operation has not cleared
  // anything into this one and the shop floor has nothing to do here yet.
  //
  // Both of these mirror the server's own refusals exactly, so the button can
  // no longer be the "button that only fails on click":
  //   startOp      → "No qty available to start for this operation" when
  //                  available <= 0 (op-entry/service.ts).
  //   submitOpLog  → the same availability check, plus a refusal while the op
  //                  is `qc_pending` ("waiting for QC clearance — go to QC
  //                  dashboard"), which is why Log drops out in that state too.
  //
  // IN-JC-26-00013 op 3 is the case that prompted this: `waiting`, input 0, so
  // every control on it was an invitation the server would reject.
  //
  // WHICH of the two shows is a SESSION question, not a status one. It used to
  // be decided from `computedStatus` (`in_progress` / `running` / any completed
  // qty → Log, `available` / `waiting` → Start), and that was wrong from the
  // first booked piece onward: `computedStatus` answers a QUANTITY question —
  // is there work left on this op — so it flips to `in_progress` the moment
  // anything is logged and stays there for the rest of the op's life. It has
  // never been able to say whether a machine is holding the op RIGHT NOW.
  //
  // The result was a card stuck offering Log on an operation nobody was
  // running. Live proof: IN-JC-26-00017 op 1 has 30 of 100 pcs done and 70 still
  // pending, and all three of its sessions are `stopped` — nothing is running on
  // it, yet the card offered ✚ Log. The operator's real next step there is to
  // start the machine again.
  //
  // So we ask `activeRunningOpId` instead (op-entry.ts): it is the running_ops
  // row RUNNING this op, or null when no machine is holding it.
  //   activeRunningOpId !== null → ✚ Log   (add production to work in progress)
  //   activeRunningOpId === null → ▶ Start (nothing running; start before logging)
  // The two are now mutually exclusive by construction — they are branches of
  // one chain below, so exactly one of them can ever render.
  //
  // `qc_pending` still suppresses BOTH, exactly as before: Log was excluded
  // explicitly and Start was excluded implicitly (the old whitelist named only
  // `available` and `waiting`), so the exclusion is now spelled out on each.
  const showLog =
    !isOut &&
    !isQc &&
    canOpEntry &&
    op.available > 0 &&
    op.computedStatus !== 'qc_pending' &&
    op.activeRunningOpId !== null;
  const showStart =
    !isQc &&
    !isOut &&
    canOpEntry &&
    op.available > 0 &&
    op.computedStatus !== 'qc_pending' &&
    op.activeRunningOpId === null;
  const showDone = !isOut && !isQc && op.computedStatus === 'complete';
  // A third-party-inspection op is an ordinary QC op whose operation name says
  // TPI (e.g. "TPI Final Inspection") — the routing carries no separate flag.
  //
  // `qcPending > 0` for the same reason as the 🔬 QC button beside it: with
  // nothing waiting to be inspected there is no inspection to open. Six of the
  // seven TPI ops in the live data are `waiting` with input 0 — including
  // IN-JC-26-00013 op 3, whose upstream op 2 still has all 20 pcs at the
  // vendor. Only IN-JC-26-00011 op 2 (qc_pending 4) has real TPI work.
  const isTpi = isQc && op.qcPending > 0 && op.operation.toLowerCase().includes('tpi');
  const showQcBtn = isQc && op.qcPending > 0 && canQc;
  // The QC branch's plain text ("✓ QC Done" / "Waiting") only ever showed when
  // nothing was pending, exactly as before.
  const showQcText = isQc && op.qcPending === 0;

  const hasFooter =
    isOut ||
    showDone ||
    showLog ||
    showStart ||
    showQcBtn ||
    showQcText ||
    (isTpi && canTpi) ||
    showNc;
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
        <OutsourceActionRefs jcCode={jc.code} op={op} />
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
        /* T33: Log only while a session is actually running on this op. Start
           and Log are the two ends of one chain, so exactly one of them shows —
           an op with pending qty and no running session offers Start, never
           Log. */
        <button type="button" className="btn btn-sm btn-primary" onClick={() => onLog(op.id)}>
          ✚ Log
        </button>
      ) : showStart ? (
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
      {/* Report NC — the QC operation that rejected pieces is where the fault is
          found, so the button only appears there, labelled with the reject
          count like the 🔬 QC (5) button beside it. The link carries the JC,
          the item and the operation into the form, so the inspector lands on a
          part-filled NC instead of a blank one. Last in the strip and quiet: it
          is the exception path, not the next step. */}
      {showNc ? (
        <Link
          to="/nc-register/new"
          search={{
            jobCardId: jc.id,
            itemId: jc.itemId,
            itemCode: jc.itemCode,
            itemName: jc.itemName,
            jcOpId: op.id,
            opSeq: String(op.opSeq),
            operation: op.operation,
            rejectedQty: String(op.qcRejectedQty),
          }}
          className="btn btn-sm btn-ghost"
          title="Report a non-conformance for the pieces this QC operation rejected"
        >
          ⚠ NC ({op.qcRejectedQty})
        </Link>
      ) : null}
    </div>
  );
}
