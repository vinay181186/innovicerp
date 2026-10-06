// Job Card Operations tab — WHICH actions one operation row offers.
//
// The table row has two slots where today's op card had a strip of buttons
// (jc-op-actions.tsx `JcOpFooter` + `OutsourceNextAction`):
//
//   Next Step   the ONE action the strip led with (its primary), or the
//               strip's plain text when there is no action ("✓ Completed",
//               "Waiting", the PR / PO reference of an outsource op);
//   ⋯           every OTHER action the strip showed for that op.
//
// No gate is invented here. jc-op-actions.tsx exports only components, not its
// conditions, so each condition is COPIED VERBATIM from it and the source line
// is cited beside it. A change to a gate there must be made here too.
//
// Navigation targets are the ones the card used (jc-status-view.tsx for the
// three callbacks it passed into JcOpFooter; jc-op-actions.tsx for the links).
//
// Decorative emoji are dropped from the labels (owner decision #9 on the
// approved mock-up); ▶ and ✓ stay.
import type { EffectiveAccess, JcOpEnriched, JcOpsBoardRow } from '@innovic/shared';
import { effectiveFormPerms } from '@/lib/access-control';
import type { IconName } from '@/ui/core/Icon';
import { OUTSOURCE_STATUS_LABEL } from '../lib/jc-op-labels';

/** Where an action goes — the arguments of `navigate()` / `<Link>`. Kept as a
 *  closed union so every target stays a typed route. */
export type OpActionTarget =
  | { to: '/op-entry'; search: { jc: string; op: string; mode: 'start' | 'complete' } }
  | { to: '/qc-call-register'; search: { search: string } }
  | { to: '/qc-call-register'; search: { tab: 'tpi' } }
  | { to: '/nc-register'; search: { search: string } }
  | { to: '/purchase-orders/from-pr'; search: { prId: string } }
  | { to: '/delivery-challans/new'; search: { poId: string } }
  | { to: '/delivery-challans/$id/receive'; params: { id: string } }
  | { to: '/incoming-qc' };

export interface OpAction {
  key: string;
  label: string;
  title: string;
  icon: IconName;
  /** How the button looks in the Next Step cell (mock-up: ▶ / ✓ are primary,
   *  Inspect is the green QC button, the outsource ladder is plain). */
  tone: 'primary' | 'qc' | 'plain';
  target: OpActionTarget;
}

export interface OpActionSet {
  /** The Next Step button, or null. */
  primary: OpAction | null;
  /** Shown in the Next Step cell when there is no primary. */
  text: { label: string; tone: 'done' | 'muted' | 'ref' } | null;
  /** Everything else — the row ⋯ menu. */
  more: OpAction[];
}

/** The outsource ladder (jc-op-actions.tsx `OutsourceNextAction`, L105-207),
 *  in the order the strip drew it — the first one was the primary (L202-203). */
function outsourceLadder(
  eff: EffectiveAccess | undefined,
  row: JcOpsBoardRow | undefined,
  op: JcOpEnriched,
): OpAction[] {
  // L113 — no board row, no ladder.
  if (!row) return [];
  const out: OpAction[] = [];
  // 1. Gen PO — L120: a PR exists, no PO from it yet, po_create.entry.
  if (row.outsourcePrId && !row.outsourcePoId && effectiveFormPerms(eff, 'po_create').entry) {
    out.push({
      key: 'gen-po',
      label: 'Gen PO',
      title: 'Raise the purchase order for this outsourced operation',
      icon: 'plus',
      tone: 'plain',
      target: { to: '/purchase-orders/from-pr', search: { prId: row.outsourcePrId } },
    });
  }
  // 2. Gen DC — L137: a PO exists, pieces ready to send, ospdc_create.entry.
  if (row.outsourcePoId && op.readyToSendQty > 0 && effectiveFormPerms(eff, 'ospdc_create').entry) {
    out.push({
      key: 'gen-dc',
      label: `Gen DC (${op.readyToSendQty})`,
      title: 'Raise the outward delivery challan for the pieces ready to send',
      icon: 'truck',
      tone: 'plain',
      target: { to: '/delivery-challans/new', search: { poId: row.outsourcePoId } },
    });
  }
  // 3. Receive — L155: a challan is still out, ospdc_create.entry.
  if (row.outsourceOpenDcId && effectiveFormPerms(eff, 'ospdc_create').entry) {
    out.push({
      key: 'receive',
      label: `Receive ${row.outsourceOpenDcCode ?? 'challan'}`,
      title: 'Receive this challan back from the vendor (this also books the GRN)',
      icon: 'package',
      tone: 'plain',
      target: { to: '/delivery-challans/$id/receive', params: { id: row.outsourceOpenDcId } },
    });
  }
  // 4. Incoming QC — L176: pieces back and not inspected, qc_incoming.view;
  //    L179: the register when there is a PO code and qc_submit.view, else
  //    the Incoming QC queue (L189).
  if (op.inQcQty > 0 && effectiveFormPerms(eff, 'qc_incoming').view) {
    const poCode = row.outsourcePoCode;
    out.push({
      key: 'iqc',
      label: `Inspect (${op.inQcQty})`,
      title: 'Inspect the pieces back from the vendor',
      icon: 'search',
      tone: 'qc',
      target:
        poCode && effectiveFormPerms(eff, 'qc_submit').view
          ? { to: '/qc-call-register', search: { search: poCode } }
          : { to: '/incoming-qc' },
    });
  }
  return out;
}

/** The reference text an outsource op's strip showed (jc-op-actions.tsx
 *  `OutsourceActionRefs`, L231-239): PR code at `pr_raised`, PO code at
 *  `po_created`, else the outsource status label. */
export function outsourceRefText(op: JcOpEnriched, row: JcOpsBoardRow | undefined): string {
  const status = op.outsourceStatus ?? 'pending';
  if (status === 'pr_raised' && row?.outsourcePrCode) return `PR: ${row.outsourcePrCode}`;
  if (status === 'po_created' && row?.outsourcePoCode) return `PO: ${row.outsourcePoCode}`;
  return OUTSOURCE_STATUS_LABEL[status];
}

export function opActions({
  eff,
  jcCode,
  op,
  hasOspLane,
  row,
  stopped,
}: {
  eff: EffectiveAccess | undefined;
  jcCode: string;
  op: JcOpEnriched;
  /** The op-flow row's `hasOsp` on an IN-HOUSE op (ADR-081 dual lane). */
  hasOspLane: boolean;
  /** The jc-ops board row; only fetched for an op with an outsource lane. */
  row: JcOpsBoardRow | undefined;
  stopped: boolean;
}): OpActionSet {
  const isQc = op.opType === 'qc';
  const isOut = op.opType === 'outsource';

  // jc-op-actions.tsx L295 / L297 / L301-302 — the permission keys.
  const canOpEntry = effectiveFormPerms(eff, 'op_entry').entry;
  const canQc = effectiveFormPerms(eff, 'qc_submit').view;
  const canTpi =
    effectiveFormPerms(eff, 'qc_submit').entry && effectiveFormPerms(eff, 'tpi_submit').entry;

  // ── Outsource op: the ladder, nothing else (L406-407; L243 hides it when stopped).
  if (isOut) {
    const ladder = stopped ? [] : outsourceLadder(eff, row, op);
    const [first, ...rest] = ladder;
    return {
      primary: first ?? null,
      // With no step open the strip showed its reference text. A finished op
      // reads "✓ Completed" like every other finished row (mock-up, "Exact full").
      text: first
        ? null
        : op.computedStatus === 'complete'
          ? { label: '✓ Completed', tone: 'done' }
          : { label: outsourceRefText(op, row), tone: 'ref' },
      more: rest,
    };
  }

  // ── QC op (L408-425 + L445-476).
  if (isQc) {
    // L378 — Inspect.
    const showQcBtn = !stopped && isQc && op.qcPending > 0 && canQc;
    // L381 — the strip's text when nothing is waiting (or the order is stopped).
    const showQcText = isQc && (stopped || op.qcPending === 0);
    // L377 — TPI: a QC op whose name says TPI, with pieces waiting.
    const isTpi =
      !stopped && isQc && op.qcPending > 0 && op.operation.toLowerCase().includes('tpi');
    // L308-309 — NC: the QC op rejected pieces, nc_dispose.view.
    const showNc =
      !stopped && isQc && op.qcRejectedQty > 0 && effectiveFormPerms(eff, 'nc_dispose').view;

    const list: OpAction[] = [];
    if (showQcBtn) {
      list.push({
        key: 'inspect',
        label: `Inspect (${op.qcPending})`,
        title: 'Open the QC Call Register filtered to this job card',
        icon: 'search',
        tone: 'qc',
        // jc-status-view.tsx L348-350.
        target: { to: '/qc-call-register', search: { search: jcCode } },
      });
    }
    if (isTpi && canTpi) {
      list.push({
        key: 'tpi',
        label: 'TPI',
        title: 'Open the TPI tab of the QC Call Register',
        icon: 'check',
        tone: 'plain',
        // jc-op-actions.tsx L446-449.
        target: { to: '/qc-call-register', search: { tab: 'tpi' } },
      });
    }
    const nc: OpAction | null = showNc
      ? {
          key: 'nc',
          label: `NC (${op.qcRejectedQty})`,
          title: 'Open NCs for this job card',
          icon: 'eye',
          tone: 'plain',
          // jc-op-actions.tsx L468-470.
          target: { to: '/nc-register', search: { search: jcCode } },
        }
      : null;
    // NC is the exception path ("last in the strip and quiet", L455-457), so
    // it never takes the Next Step slot — it always sits in ⋯.
    const [first, ...rest] = list;
    return {
      primary: first ?? null,
      text:
        !first && showQcText
          ? op.computedStatus === 'complete'
            ? { label: '✓ QC Completed', tone: 'done' }
            : { label: 'Waiting', tone: 'muted' }
          : null,
      more: nc ? [...rest, nc] : rest,
    };
  }

  // ── In-house process op (L426-440).
  // L352-359 — ✓ Complete: a session is running on this op.
  const showLog =
    !stopped &&
    !isOut &&
    !isQc &&
    canOpEntry &&
    op.available > 0 &&
    op.computedStatus !== 'qc_pending' &&
    op.activeRunningOpId !== null;
  // L360-367 — ▶ Start Operation: nothing running on it.
  const showStart =
    !stopped &&
    !isQc &&
    !isOut &&
    canOpEntry &&
    op.available > 0 &&
    op.computedStatus !== 'qc_pending' &&
    op.activeRunningOpId === null;
  // L368 — the "✓ Completed" text.
  const showDone = !isOut && !isQc && op.computedStatus === 'complete';

  const list: OpAction[] = [];
  if (showLog) {
    list.push({
      key: 'complete',
      label: '✓ Complete',
      title: 'Log production against the running session (Op Entry)',
      icon: 'check',
      tone: 'primary',
      // jc-status-view.tsx L338-343.
      target: { to: '/op-entry', search: { jc: jcCode, op: op.id, mode: 'complete' } },
    });
  } else if (showStart) {
    list.push({
      key: 'start',
      label: '▶ Start Operation',
      title: 'Start this operation on a machine (Op Entry)',
      icon: 'play',
      tone: 'primary',
      // jc-status-view.tsx L332-337.
      target: { to: '/op-entry', search: { jc: jcCode, op: op.id, mode: 'start' } },
    });
  }
  // ADR-081 in-house + OSP: the outsource steps are NOT offered on an in-house
  // op — today's strip never did, and on this lane the ladder is incomplete
  // (Gen DC reads v_osp_wip, which holds outsource ops only). The op keeps its
  // "+ OSP" badge and the split under ▸; the balance's PR / PO / DC are worked
  // from their own registers, as today.
  void hasOspLane;

  // Old strip (L426) checked "✓ Completed" first — keep that order.
  if (showDone) return { primary: null, text: { label: '✓ Completed', tone: 'done' }, more: [] };
  const [first, ...rest] = list;
  return { primary: first ?? null, text: null, more: rest };
}
