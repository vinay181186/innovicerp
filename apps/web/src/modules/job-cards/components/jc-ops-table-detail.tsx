// Job Card Operations tab — the ▸ detail under one operation row.
//
// What today's expanded op card body shows (jc-op-card.tsx), minus the
// quantity chips, which are now the row's own columns:
//
//   process op   Planned → Actual Machine, Operator, Program No., Tool, Start,
//                End, Cycle Time, Last Entry
//   QC op        Inspected By, QC Date, Result (+ Program / Tool when set)
//   outsource op Vendor, Outsource Status (with the PR / PO reference),
//                PR · PO, Open DC, Ready to Send, Back from Vendor
//   in-house op with an outsource lane (ADR-081, mock-up frame 3) — the split:
//                Sent to Vendor + vendor, PR · PO, Open DC, Received Back,
//                Accepted Back, At Vendor, Completed
//   every op     NC breakup, rework markers, Customer Material on the first
//                op of a JW card, and the latest three log entries
//
// Every value is read straight off the loaded records; nothing is added up.
// The NC breakup rows and the log line wording are copied from jc-op-card.tsx
// (not exported there) — cited per block.
import type {
  JcOpEnriched,
  JcOpsBoardRow,
  JobCardListItem,
  JobCardRmAvailable,
  OpLog,
} from '@innovic/shared';
import { fmtOpSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { machineSplitTitle, resolveActualMachine } from '@/components/shared/machine-split';
import type { OpFlowRow } from '@/modules/flow-views/types';
import { fmtJcStamp } from '../lib/fmt-jc-date';
import { outsourceRefText } from './jc-ops-table-actions';
import { JcOpsTableLogs } from './jc-ops-table-logs';
import { doneLabel } from './jc-ops-table-notes';

// jc-op-card.tsx L50-63 — the NC breakup, in the design's order and colours.
const NC_BREAKUP_ROWS: ReadonlyArray<{
  key: keyof JcOpEnriched['ncBreakup'];
  label: string;
  cls: string;
}> = [
  { key: 'ncRaisedQty', label: 'NC Raised', cls: 'jc-ops-warn' },
  { key: 'underReworkQty', label: 'Under Rework', cls: 'jc-ops-warn' },
  { key: 'underRepairQty', label: 'Under Repair', cls: 'jc-ops-warn' },
  { key: 'rtvAwaitingChallanQty', label: 'Return Challan Pending', cls: 'jc-ops-warn' },
  { key: 'sentToVendorQty', label: 'Sent to Vendor', cls: 'jc-ops-info' },
  { key: 'receivedQcPendingQty', label: 'Received – QC Pending', cls: 'jc-ops-info' },
  { key: 'scrapQty', label: 'Scrap', cls: 'jc-ops-bad' },
  { key: 'ncClosedQty', label: 'NC Closed', cls: 'text3' },
];

function F({
  k,
  children,
  title,
  code = false,
}: {
  k: string;
  children: React.ReactNode;
  title?: string | undefined;
  code?: boolean;
}): React.JSX.Element {
  return (
    <div className="jc-ops-f" title={title}>
      <span className="jc-ops-k">{k}</span>
      <span className={code ? 'jc-ops-v mono' : 'jc-ops-v'}>{children}</span>
    </div>
  );
}

export function JcOpsTableDetail({
  jc,
  op,
  flow,
  row,
  hasOspLane,
  logs,
  machineName,
  toolDetails,
  rmAvailable,
}: {
  jc: JobCardListItem;
  op: JcOpEnriched;
  flow: OpFlowRow | undefined;
  row: JcOpsBoardRow | undefined;
  hasOspLane: boolean;
  /** Every loaded log of this op, latest first (jc-status-view.tsx logsByOp). */
  logs: OpLog[];
  machineName: string | null;
  toolDetails: string | null;
  /** ADR-103 — only passed for the FIRST op (jc-status-view.tsx L330). */
  rmAvailable: JobCardRmAvailable | null;
}): React.JSX.Element {
  const isQc = op.opType === 'qc';
  const isOut = op.opType === 'outsource';

  // jc-op-card.tsx L314-332 — Start / End stamps: the server's dates, with
  // the time of a loaded entry on that date when there is one.
  const timeOn = (
    date: string | null,
    pick: (l: OpLog) => boolean,
    earliest: boolean,
  ): string | null => {
    if (!date) return null;
    const onDay = logs.filter((l) => l.logDate === date && pick(l) && l.startTime);
    if (onDay.length === 0) return null;
    const sorted = [...onDay].sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? ''));
    return (earliest ? sorted[0] : sorted[sorted.length - 1])?.startTime ?? null;
  };
  const startStamp = fmtJcStamp(
    op.firstLogDate,
    timeOn(op.firstLogDate, () => true, true),
  );
  const endStamp = fmtJcStamp(
    op.lastLogDate,
    timeOn(op.lastLogDate, (l) => l.logType === 'complete' || l.logType === 'qc', false),
  );
  // jc-op-card.tsx L335 — jc_ops.cycle_time_min, minutes.
  const cycleMin = Number(op.cycleTimeMin) || null;
  const lastLog = logs[0] ?? null;
  const lastQcLog = logs.find((l) => l.logType === 'qc') ?? null;

  // jc-op-card.tsx L344-349 — ADR-164 planned vs actual machine.
  const plannedMachine = op.machineCode ?? op.machineCodeText ?? null;
  const actual = resolveActualMachine({
    planned: plannedMachine,
    activeRunningMachineCode: op.activeRunningMachineCode,
    machines: op.machines,
  });

  // jc-op-card.tsx L297-307 — where THIS op's rejects went for rework.
  const reworkOutSrNos = (op.reworkRaisedToOps ?? '')
    .split(',')
    .filter((n) => n.trim() !== '')
    .map((n) => fmtOpSrNo(Number(n.trim())))
    .join(', ');
  const reworkOut =
    op.reworkRaisedQty > 0 &&
    Boolean(op.reworkRaisedToOps) &&
    op.reworkRaisedToOps !== String(op.opSeq);

  const tool = (
    <F k="Tool" code title={toolDetails ?? undefined}>
      {op.toolNo || '—'}
      {toolDetails ? <span className="jc-ops-sub"> · {toolDetails}</span> : null}
    </F>
  );
  const prPo =
    row && (row.outsourcePrCode || row.outsourcePoCode) ? (
      <F k="PR · PO" code>
        {row.outsourcePrCode ?? '—'} · {row.outsourcePoCode ?? '—'}
      </F>
    ) : null;
  const openDc = row?.outsourceOpenDcCode ? (
    <F k="Open DC" code>
      {row.outsourceOpenDcCode}
    </F>
  ) : null;
  const vendor = row?.outsourceVendorCode ?? row?.outsourceVendorName ?? null;

  const nc = op.ncBreakup;
  const ncRows =
    nc.openNcCount > 0 || nc.scrapQty > 0 || nc.ncClosedQty > 0
      ? NC_BREAKUP_ROWS.filter((r) => nc[r.key] > 0)
      : [];

  return (
    <>
      <div className="jc-ops-detg">
        {isOut ? (
          <>
            {/* jc-op-actions.tsx OutsourceInfo L63-82 + OutsourceActionRefs L231-239 */}
            <F k="Vendor" title={row?.outsourceVendorName ?? undefined}>
              {row?.outsourceVendorCode ? (
                <span className="mono">{row.outsourceVendorCode} </span>
              ) : null}
              {row?.outsourceVendorName ?? (row?.outsourceVendorCode ? null : '—')}
            </F>
            <F k="Outsource Status">{outsourceRefText(op, row)}</F>
            {prPo}
            {openDc}
            {/* jc-op-card.tsx L634-645 — the two OSP-only chips. */}
            <F k="Ready to Send" code>
              {op.readyToSendQty}
            </F>
            <F
              k="Back from Vendor"
              code
              title="Pieces back from the vendor, waiting for incoming inspection"
            >
              {op.inQcQty}
            </F>
          </>
        ) : isQc ? (
          <>
            {/* jc-op-card.tsx L672-696 */}
            <F k="Inspected By">{lastQcLog?.operatorName ?? '—'}</F>
            <F k="QC Date">
              {lastQcLog ? fmtJcStamp(lastQcLog.logDate, lastQcLog.startTime) : '—'}
            </F>
            <F k="Result">
              {op.qcAcceptedQty === 0 && op.qcRejectedQty === 0 ? (
                op.qcPending > 0 ? (
                  <span className="badge b-amber">Pending</span>
                ) : (
                  '—'
                )
              ) : (
                <>
                  {op.qcAcceptedQty > 0 ? (
                    <span className="badge b-green">Accepted {op.qcAcceptedQty}</span>
                  ) : null}{' '}
                  {op.qcRejectedQty > 0 ? (
                    <span className="badge b-red">Deviated {op.qcRejectedQty}</span>
                  ) : null}
                </>
              )}
            </F>
          </>
        ) : (
          <>
            {/* jc-op-card.tsx L700-743 */}
            <F
              k={actual.differs ? 'Planned Machine → Actual Machine' : 'Planned Machine'}
              code
              title={
                actual.differs
                  ? actual.split.length
                    ? machineSplitTitle(actual.split)
                    : `Planned ${plannedMachine ?? '—'} — actually made on ${actual.label}`
                  : (machineName ?? undefined)
              }
            >
              {plannedMachine ?? '—'}
              {actual.differs ? <span className="jc-ops-warn"> → {actual.label}</span> : null}
              {actual.split.map((m) => (
                <span key={m.machineCode} className="jc-ops-sub">
                  {' '}
                  · {m.machineCode}: <b>{m.qty}</b> pcs
                </span>
              ))}
            </F>
            <F k="Operator">{lastLog?.operatorName ?? '—'}</F>
            <F k="Program No." code>
              {op.program || '—'}
            </F>
            {tool}
          </>
        )}
        {(isQc || isOut) && op.program ? (
          <F k="Program No." code>
            {op.program}
          </F>
        ) : null}
        {(isQc || isOut) && (op.toolNo || toolDetails) ? tool : null}
        <F k="Start" code>
          {startStamp}
        </F>
        <F k="End" code>
          {endStamp}
        </F>
        <F k="Cycle Time" code>
          {cycleMin != null ? `${cycleMin} min` : '—'}
        </F>
        {!isQc ? (
          <F k="Last Entry" code>
            {lastLog ? fmtJcStamp(lastLog.logDate, lastLog.startTime) : '—'}
          </F>
        ) : null}

        {/* ADR-081 — the split of an in-house op whose balance went to a
            vendor (mock-up frame 3). Server figures only. */}
        {hasOspLane && !isOut ? (
          <>
            <F k="Sent to Vendor" code>
              {flow ? flow.vendorSentQty : '—'}
              {vendor ? <span className="jc-ops-sub"> to {vendor}</span> : null}
            </F>
            {prPo}
            {openDc}
            <F
              k="Received Back"
              code
              title={flow && flow.inQcQty > 0 ? `${flow.inQcQty} waiting incoming QC` : undefined}
            >
              {flow ? flow.vendorReceivedQty : '—'}
              {flow && flow.inQcQty > 0 ? (
                <span className="jc-ops-sub"> · {flow.inQcQty} in incoming QC</span>
              ) : null}
            </F>
            <F k="Accepted Back" code>
              {flow ? flow.vendorAcceptedQty : '—'}
            </F>
            <F k="At Vendor" code>
              {flow ? flow.atVendorQty : '—'}
            </F>
            <F k="Completed" code title="v_jc_op_status completed — in-house + accepted back">
              {flow ? flow.completedQty : '—'}
              <span className="jc-ops-sub"> in-house + accepted back</span>
            </F>
            <F k="Done" code title={flow ? doneLabel(flow) : undefined}>
              {flow ? flow.doneQty : '—'}
              {flow ? <span className="jc-ops-sub"> {doneLabel(flow)}</span> : null}
            </F>
          </>
        ) : null}

        {/* ADR-103 — first op of a JW card (jc-op-card.tsx L586-625). */}
        {rmAvailable ? (
          <F
            k="Customer Material"
            code
            title={`Customer material issued to this job card: ${rmAvailable.issuedQty}. Already taken up by this operation — made here, or sent out to the vendor: ${rmAvailable.consumedQty}.`}
          >
            {rmAvailable.availableQty}
            <span className="jc-ops-sub"> of {rmAvailable.issuedQty} issued</span>
            {rmAvailable.availableQty === 0 && rmAvailable.issuedQty === 0 ? (
              <span className="jc-ops-bad"> · issue material</span>
            ) : null}
          </F>
        ) : null}
      </div>

      {/* Markers the card carried in its header bar. */}
      {(!isQc && op.qcRequired) || op.reworkPendingQty > 0 || reworkOut || ncRows.length > 0 ? (
        <div className="jc-ops-tags">
          {!isQc && op.qcRequired ? <span className="badge b-green">QC Required</span> : null}
          {op.reworkPendingQty > 0 ? (
            <span
              className="badge b-amber"
              title={`${op.reworkPendingQty} piece(s) sent back to this operation for rework. Clears when the NC is closed (NC Register → Close Rework).`}
            >
              ♻ {op.reworkPendingQty} rework owed here
            </span>
          ) : null}
          {reworkOut ? (
            <span
              className="badge b-amber"
              title={`${op.reworkRaisedQty} piece(s) deviated here and sent back to Op ${reworkOutSrNos} for rework. Clears when the NC is closed.`}
            >
              ♻ {op.reworkRaisedQty} rework → Op {reworkOutSrNos}
            </span>
          ) : null}
          {/* jc-op-card.tsx L67-124 — NC breakup, linked to the register. */}
          {ncRows.length > 0 ? (
            <span className="jc-ops-ncb">
              <Link
                to="/nc-register"
                search={{ search: jc.code }}
                className="fw-700 jc-ops-link"
                title={`Open the NC register for ${jc.code}`}
              >
                NC
              </Link>
              {ncRows.map((r) => (
                <span key={r.key} className={r.cls}>
                  {' · '}
                  {r.label} <b className="mono">{nc[r.key]}</b>
                </span>
              ))}
            </span>
          ) : null}
        </div>
      ) : null}

      <JcOpsTableLogs logs={logs} />
    </>
  );
}
