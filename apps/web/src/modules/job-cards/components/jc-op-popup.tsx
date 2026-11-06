// Job Card Operations tab — the operation POPUP (owner-approved mock-up,
// 2026-11-02: "no ▸ arrow, click on the operation, a popup shows the details").
//
// Opens on a click anywhere on an operation row except its Next Step button
// and ⋯ menu. It shows the row's own quantities as one line, then exactly
// what the old ▸ detail row showed (jc-ops-table-detail.tsx — machine,
// operator, times, NC breakup, outsource split, recent logs), then the row's
// Next Step action. ‹ › and ↑ ↓ move to the previous / next operation; the
// shared Modal owns Escape, click-outside and the focus trap. Nothing is
// computed here: every figure is the same OpFlowRow cell the row prints.
import type {
  JcOpEnriched,
  JcOpsBoardRow,
  JobCardListItem,
  JobCardRmAvailable,
  OpLog,
} from '@innovic/shared';
import { fmtOpSrNo } from '@innovic/shared';
import { useEffect } from 'react';
import type { OpFlowRow } from '@/modules/flow-views/types';
import { Modal } from '@/ui/feedback';
import { JcOpsTableDetail } from './jc-ops-table-detail';

function Chip({
  k,
  v,
  tone = '',
}: {
  k: string;
  v: number | undefined;
  tone?: string;
}): React.JSX.Element {
  return (
    <span className="jc-pop-chip">
      {k}
      <b className={v ? tone : 'jc-ops-q0'}>{v ?? '—'}</b>
    </span>
  );
}

export function JcOpPopup({
  jc,
  op,
  flow,
  row,
  hasOspLane,
  logs,
  machineName,
  toolDetails,
  rmAvailable,
  title,
  statusBadge,
  action,
  onClose,
  onStep,
}: {
  jc: JobCardListItem;
  op: JcOpEnriched;
  flow: OpFlowRow | undefined;
  row: JcOpsBoardRow | undefined;
  hasOspLane: boolean;
  logs: OpLog[];
  machineName: string | null;
  toolDetails: string | null;
  rmAvailable: JobCardRmAvailable | null;
  /** "Turning · CNC-03" — the row's Operation · Machine / Vendor text. */
  title: string;
  statusBadge: React.ReactNode;
  /** The row's Next Step (button or text); null when there is none. */
  action: React.ReactNode;
  onClose: () => void;
  /** -1 = previous operation, +1 = next. */
  onStep: (dir: -1 | 1) => void;
}): React.JSX.Element {
  // ↑ ↓ step through the operations, like the ‹ › buttons.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      onStep(e.key === 'ArrowDown' ? 1 : -1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onStep]);

  const hasOsp = flow?.hasOsp ?? op.opType === 'outsource';

  return (
    <Modal
      size="lg"
      onClose={onClose}
      confirmExit={false}
      title={
        <span className="jc-pop-title">
          <span className="mono jc-ops-opn">Op {fmtOpSrNo(op.opSeq)}</span>
          <b>{title}</b>
          {statusBadge}
        </span>
      }
      headerActions={
        <>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            title="Previous operation (↑)"
            aria-label="Previous operation"
            onClick={() => onStep(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            title="Next operation (↓)"
            aria-label="Next operation"
            onClick={() => onStep(1)}
          >
            ›
          </button>
        </>
      }
      footer={
        <>
          {action}
          <button type="button" className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="jc-pop-chips">
        <Chip k="Input" v={flow?.inputQty} />
        <Chip k="Done" v={flow?.doneQty} />
        <Chip k="Accepted" v={flow?.acceptedQty} tone="jc-ops-q-good" />
        <Chip k="Deviated (NC)" v={flow?.deviatedQty} tone="jc-ops-q-warn" />
        <Chip k="Reworked" v={flow?.reworkedQty} tone="jc-ops-q-rw" />
        <Chip k="Rejected" v={flow?.rejectedFinalQty} tone="jc-ops-q-bad" />
        <Chip k="Pending" v={flow?.pendingQty} tone="jc-ops-q-warn" />
        {hasOsp ? (
          <>
            <Chip k="Sent to Vendor" v={flow?.sentToVendorQty} />
            <Chip k="Received" v={flow?.vendorReceivedQty} />
            <Chip k="Returned to Vendor" v={flow?.returnedToVendorQty} />
            <Chip k="Re-received" v={flow?.reReceivedQty} />
            <Chip k="At Vendor" v={flow?.atVendorQty} />
          </>
        ) : null}
      </div>
      <JcOpsTableDetail
        jc={jc}
        op={op}
        flow={flow}
        row={row}
        hasOspLane={hasOspLane}
        logs={logs}
        machineName={machineName}
        toolDetails={toolDetails}
        rmAvailable={rmAvailable}
      />
    </Modal>
  );
}
