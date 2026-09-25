// Operations Details — per-op CARD (read-only / VIEW mode).
//
// Laid out to the approved 2026-09-21 restyle (JC-Detail-Restyle-Mockup.html):
// a bordered row with a 4 px status rail on its header bar, then EITHER one
// collapsed row (`#n OP30 [CNC-2] Turning Center - Second Setup … 0 / 8
// PENDING ›`) OR the expanded body —
//
//   bar     #n · OPnn · kind chip · operation · tags · status badge
//           … Start : … End : … Cycle : …
//   chips   Order Qty / Completed / Pending / QC Pending / Rejected /
//           At Vendor [+ RM Avail on the first op; Ready to Send / In QC on
//           an OSP op]
//   fields  Machine · Operator · Program No. · Tool · Setup Time · Last Entry
//           on a process op; Inspector · QC Date · Result on a QC op; vendor
//           + status on an OSP op
//   actions the NEXT ACTION strip (jc-op-actions.tsx — every button in it is
//           permission-gated on the screen it opens)
//   logs    Recent Logs strip — the same latest-3 entries, one toggle
//
// Responsive without a stylesheet: the chip and field rows are auto-fit grids
// (six across when there is room, three / two on a narrow screen).
//
// Every value, badge, button, condition and destination is the one the card
// showed before the re-layout. No quantity, badge or calculation changed; the
// outsource vendor/PR/PO lookups keep their original shape (the jc-ops board
// is fetched ONLY from inside an outsource op's sub-components, so a JC with
// no outsource ops still issues no board request).
//
// NOT here, on purpose (nothing behind them): Put on Hold, Report NC (a QC
// reject raises its NC itself), View Drawing / Process Sheet / Tool List /
// View QC Report / View All Logs / ⋮. "Due :" on a row needs
// jc_ops.planned_end, which the op-entry contract does not carry yet.
import type { JcOpEnriched, JobCardListItem, JobCardRmAvailable, OpLog } from '@innovic/shared';
import { fmtOpSrNo, opSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { machineSplitTitle, resolveActualMachine } from '@/components/shared/machine-split';
import { OP_STATUS } from '../lib/jc-op-labels';
import { fmtJcStamp } from '../lib/fmt-jc-date';
import { JcOpFooter, OutsourceInfo } from './jc-op-actions';
import { QtyChip } from './jc-op-card-parts';

// §6 of docs/QC-NC-HANDLING-DESIGN.md: an op that rejected pieces shows a
// QUANTITY BREAKUP, not one overall status — 10 inspected, 8 accepted, 2
// rejected → "8 accepted" in the COMPLETED tile AND "NC raised 2" here, at the
// same time. Every figure comes from v_nc_op_breakup (op.ncBreakup); the card
// adds nothing up itself. Order and wording are the design's, so the strip
// reads the same as the NC register's status column. Amber = still ours to
// fix, blue = at/back from the vendor, red = lost, text3 = finished.
const NC_BREAKUP_ROWS: ReadonlyArray<{
  key: keyof JcOpEnriched['ncBreakup'];
  label: string;
  color: string;
}> = [
  { key: 'ncRaisedQty', label: 'NC raised', color: 'var(--amber)' },
  { key: 'underReworkQty', label: 'Under rework', color: 'var(--amber)' },
  { key: 'underRepairQty', label: 'Under repair', color: 'var(--amber)' },
  { key: 'rtvAwaitingChallanQty', label: 'Return challan pending', color: 'var(--amber)' },
  { key: 'sentToVendorQty', label: 'Sent to vendor', color: 'var(--blue)' },
  { key: 'receivedQcPendingQty', label: 'Received – QC pending', color: 'var(--blue)' },
  { key: 'scrapQty', label: 'Scrap', color: 'var(--red)' },
  { key: 'ncClosedQty', label: 'NC closed', color: 'var(--text3)' },
];

/** One-line strip under the header. Renders nothing while the op has no NC
 *  history at all, so the ordinary card carries no empty band. */
function NcBreakupStrip({
  nc,
  jcCode,
}: {
  nc: JcOpEnriched['ncBreakup'];
  jcCode?: string | null;
}): React.JSX.Element | null {
  if (!(nc.openNcCount > 0 || nc.scrapQty > 0 || nc.ncClosedQty > 0)) return null;
  const rows = NC_BREAKUP_ROWS.filter((r) => nc[r.key] > 0);
  if (rows.length === 0) return null;
  const open = nc.openNcCount > 0;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '2px 6px',
        marginBottom: 10,
        padding: '3px 8px',
        fontSize: 11,
        background: open ? 'var(--amber3)' : 'var(--bg3)',
        border: `1px solid ${open ? 'var(--amber)' : 'var(--border)'}`,
        borderRadius: 6,
      }}
      title={
        open
          ? `${nc.openNcCount} open non-conformance(s) on this operation — ${nc.ncOpenQty} piece(s) still to be recovered, scrapped or closed.`
          : 'Every non-conformance on this operation is closed.'
      }
    >
      {/* The band carried the numbers but went nowhere — ADR-183 makes it the
          way into the register, filtered to this card (the NC list searches
          jc.code). Plain text when we have no code to filter on. */}
      {jcCode ? (
        <Link
          to="/nc-register"
          search={{ search: jcCode }}
          className="fw-700"
          style={{ color: open ? 'var(--amber2)' : 'var(--text3)' }}
          title={`Open the NC register for ${jcCode}`}
        >
          ⚠ NC
        </Link>
      ) : (
        <span className="fw-700" style={{ color: open ? 'var(--amber2)' : 'var(--text3)' }}>
          ⚠ NC
        </span>
      )}
      {rows.map((r, i) => (
        <span key={r.key} style={{ color: r.color, whiteSpace: 'nowrap' }}>
          {i > 0 ? <span style={{ color: 'var(--text3)', marginRight: 6 }}>·</span> : null}
          {r.label} <b className="mono">{nc[r.key]}</b>
        </span>
      ))}
    </div>
  );
}

/** The `#n` ordinal box at the left of both the collapsed row and the
 *  expanded header (position in the route, not the op number). */
function OrdinalBox({ n }: { n: number }): React.JSX.Element {
  return (
    <span
      className="mono fw-700"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 24,
        height: 24,
        padding: '0 5px',
        borderRadius: 6,
        background: 'var(--bg4)',
        border: '1px solid var(--border)',
        fontSize: 12,
        color: 'var(--text)',
        flexShrink: 0,
      }}
    >
      {n}
    </span>
  );
}

/** The kind chip beside the op number: the PLANNED machine code on a process
 *  op (ADR-164 — where the remaining qty is routed; the ACTUAL machine is named
 *  in the info block), `QC` on an inspection op, `OUTSOURCE` on an OSP op. */
function KindChip({ op }: { op: JcOpEnriched }): React.JSX.Element {
  const isQc = op.opType === 'qc';
  const isOut = op.opType === 'outsource';
  // Blue for a machine, green for QC, amber for OUTSOURCE (restyle 2026-09-21).
  const bg = isQc ? 'var(--green3)' : isOut ? 'var(--amber3)' : 'var(--blue3)';
  const color = isQc ? 'var(--green2)' : isOut ? 'var(--amber2)' : 'var(--blue2)';
  const text = isQc ? 'QC' : isOut ? 'OUTSOURCE' : (op.machineCode ?? op.machineCodeText ?? '—');
  return (
    <span className="tag" style={{ background: bg, color }}>
      {text}
    </span>
  );
}

/** One cell of the field row: tiny uppercase caption over a strong value. */
function InfoCell({
  label,
  children,
  title,
}: {
  label: string;
  children: React.ReactNode;
  title?: string | undefined;
}): React.JSX.Element {
  return (
    <div title={title} style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text3)',
          textTransform: 'uppercase',
          letterSpacing: '.04em',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
      <div
        className="fw-700"
        style={{
          fontSize: 13,
          color: 'var(--text)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          marginTop: 2,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** A ~8px caption under a tile figure (QC accepted / rejected / rework). */
function Sub({
  color,
  children,
  title,
}: {
  color: string;
  children: React.ReactNode;
  title?: string;
}): React.JSX.Element {
  return (
    <div style={{ fontSize: 8, color }} title={title}>
      {children}
    </div>
  );
}

export function JcOpCard({
  jc,
  op,
  index,
  expanded,
  onToggle,
  machineName,
  toolDetails,
  rmAvailable,
  logs,
  stopped = false,
  onStart,
  onLog,
  onQc,
}: {
  jc: JobCardListItem;
  op: JcOpEnriched;
  /** 1-based position in the route (the `#n` box). */
  index: number;
  /** Expanded card vs one collapsed row. Owned by the page (Expand All /
   *  Show All Operations Expanded live there). */
  expanded: boolean;
  onToggle: () => void;
  /** Server-resolved machine name (extras.opExtras) — the enriched op omits it. */
  machineName: string | null;
  /** Server-resolved tool details (extras.opExtras). */
  toolDetails: string | null;
  /** ADR-103 — client material still workable on this JWSO Job Card
   *  (issued − already produced). The caller passes it ONLY for the first op —
   *  the operation client material actually feeds and the only one the gate
   *  applies to — and null everywhere else. */
  rmAvailable: JobCardRmAvailable | null;
  /** EVERY loaded log of this op, latest first. The strip shows the latest 3
   *  (as the table always did); Operator / Last Entry / Inspector / QC Date
   *  read the latest entry, the Start / End stamps the earliest and latest. */
  logs: OpLog[];
  /** ADR-182 — this card's Production Order was short closed, so the operation
   *  takes no more work: the footer offers none of its next actions (the
   *  server refuses them all). Everything the card SHOWS stays exactly as it
   *  was — the figures are the record of what happened before the order was
   *  stopped. */
  stopped?: boolean;
  onStart: (opId: string) => void;
  onLog: (opId: string) => void;
  onQc: () => void;
}): React.JSX.Element {
  const [logsOpen, setLogsOpen] = useState(true);

  const st = OP_STATUS[op.computedStatus] ?? { label: op.computedStatus, cls: 'b-grey' };
  const isQc = op.opType === 'qc';
  const isOut = op.opType === 'outsource';
  // Canonical per-op quantities. Completed = this op's done qty (QC →
  // accepted; process/outsource → completedQty, which for outsource is
  // accepted-back per 0068).
  //
  // Pending comes STRAIGHT from the server (v_jc_op_status.pending_qty, 0087).
  // This card used to compute `inputAvail − done` itself, which for a QC op
  // subtracted what QC accepted but not what it REJECTED — so 5 pins rejected
  // at Op2 of IN-JC-26-00085 and sent back to Op1 for rework showed as 5 still
  // awaiting inspection at Op2, i.e. the same 5 pieces counted in two places.
  // The number is business logic (CLAUDE.md §6 rule 1) and now has exactly one
  // definition, shared with the Op Entry table and the QC dashboards.
  const doneQty = isQc ? op.qcAcceptedQty : op.completedQty;
  const pendingQty = op.pendingQty;
  // Collapsed row's `done / reached` — the same figure the flow chip prints
  // (what this op released over what actually reached it; see JcOpFlowChips).
  const flowDenom = op.inputAvail || jc.orderQty;

  // What became of THIS op's rejects (0090). `reworkPendingQty` lights the op
  // that has to redo the work; this lights the op that found the fault, which
  // otherwise showed a bare "✗5 rej" and no sign of the disposition. Suppressed
  // when the rework came back to this same op — the ♻ tag in the header already
  // says so and two markers for one decision reads as two decisions.
  // reworkRaisedToOps arrives as stored seqs ("1, 3"); shown in tens (display
  // rule, see opSrNo).
  const reworkOutSrNos = (op.reworkRaisedToOps ?? '')
    .split(',')
    .filter((n) => n.trim() !== '')
    .map((n) => fmtOpSrNo(Number(n.trim())))
    .join(', ');
  const reworkOutTo =
    op.reworkRaisedToOps && op.reworkRaisedToOps !== String(op.opSeq)
      ? ` → Op${reworkOutSrNos}`
      : '';
  const reworkOut = op.reworkRaisedQty > 0 && reworkOutTo !== '';
  const reworkOutTitle = `${op.reworkRaisedQty} piece(s) rejected here and sent back to Op${reworkOutSrNos} for rework. Clears when the NC is closed.`;

  // Start / End stamps. The DATES are the server's (op.firstLogDate = earliest
  // entry of any kind, op.lastLogDate = latest completion / QC entry — the same
  // two the printed traveller shows). The TIME is read off the loaded log that
  // carries that date, when the 300-entry page reaches back that far; a date
  // with no loaded entry shows the date alone rather than a guessed time.
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
  // The column is `jc_ops.cycle_time_min` — MINUTES (the create form and the
  // Excel export say "Cycle (min)" too).
  const cycleMin = Number(op.cycleTimeMin) || null;

  // Latest entries, for the info block. `logs` is latest-first.
  const lastLog = logs[0] ?? null;
  const lastQcLog = logs.find((l) => l.logType === 'qc') ?? null;

  // ADR-164 — planned vs actual machine on a process op. The chip in row 1
  // names the PLAN; this names where the pieces were actually made when that
  // differs (open session, else the machine(s) that made the DONE qty).
  const plannedMachine = op.machineCode ?? op.machineCodeText ?? null;
  const actual = resolveActualMachine({
    planned: plannedMachine,
    activeRunningMachineCode: op.activeRunningMachineCode,
    machines: op.machines,
  });

  const recent = logs.slice(0, 3);
  // The 4 px left rail says how far the op has got (restyle 2026-09-21):
  //   complete → green
  //   current  → amber: started / partly through, pieces waiting at QC, or
  //              an OSP op with pieces in flight (PR raised … incoming QC)
  //   waiting  → red, matching the red "Waiting" badge
  //   pending / available → plain grey
  const cs = op.computedStatus;
  const inFlight =
    cs === 'in_progress' ||
    cs === 'running' ||
    cs === 'qc_pending' ||
    cs === 'pr_raised' ||
    cs === 'po_created' ||
    cs === 'at_vendor' ||
    cs === 'received';
  const rail =
    cs === 'complete'
      ? 'var(--green)'
      : inFlight || doneQty > 0
        ? 'var(--amber)'
        : cs === 'waiting'
          ? 'var(--red)'
          : 'var(--border3)';
  const rowStyle: React.CSSProperties = {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 9,
    overflow: 'hidden',
    margin: '10px 16px',
  };
  /** The header bar of both the collapsed row and the expanded card. */
  const barStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    padding: '10px 12px',
    borderLeft: `4px solid ${rail}`,
    background: 'var(--bg2)',
  };

  // ── COLLAPSED: one clickable row ──
  if (!expanded) {
    return (
      <div style={rowStyle}>
        <button
          type="button"
          onClick={onToggle}
          title="Show this operation's quantities, actions and recent entries"
          style={{
            ...barStyle,
            width: '100%',
            minWidth: 0,
            flexWrap: 'nowrap',
            cursor: 'pointer',
            textAlign: 'left',
            font: 'inherit',
            color: 'inherit',
            borderTop: 'none',
            borderRight: 'none',
            borderBottom: 'none',
          }}
        >
          <OrdinalBox n={index} />
          <span className="mono fw-700" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
            Op{opSrNo(op.opSeq)}
          </span>
          <KindChip op={op} />
          <span
            style={{
              fontSize: 13,
              color: 'var(--text)',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={op.operation}
          >
            {op.operation}
          </span>
          {op.reworkPendingQty > 0 ? (
            <span
              className="tag"
              style={{ background: 'var(--amber3)', color: 'var(--amber2)' }}
              title={`${op.reworkPendingQty} piece(s) sent back to this operation for rework.`}
            >
              ♻ {op.reworkPendingQty}
            </span>
          ) : null}
          <span style={{ flex: 1 }} />
          <span className="mono fw-700" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
            {doneQty} / {flowDenom}
          </span>
          <span className={`badge ${st.cls}`}>{st.label}</span>
          {/* The mockup's "Due : dd-MMM-yyyy" goes here once jc_ops.planned_end
              reaches the op-entry contract; until then nothing is shown rather
              than borrowing the job card's due date. */}
          <span style={{ color: 'var(--text3)', fontSize: 14 }}>›</span>
        </button>
      </div>
    );
  }

  // ── EXPANDED card ──
  return (
    <div style={rowStyle}>
      {/* ── BAR: #n · OPnn · kind chip · operation · tags · badge … stamps ── */}
      <div style={barStyle}>
        <button
          type="button"
          onClick={onToggle}
          title="Collapse this operation to one row"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            font: 'inherit',
            color: 'inherit',
          }}
        >
          <OrdinalBox n={index} />
          <span className="mono fw-700" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
            Op{opSrNo(op.opSeq)}
          </span>
        </button>
        <KindChip op={op} />
        {machineName && !isQc && !isOut ? (
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{machineName}</span>
        ) : null}
        <span className="fw-700" style={{ fontSize: 13, color: 'var(--text)' }}>
          {op.operation}
        </span>
        {!isQc && op.qcRequired ? (
          <span className="tag" style={{ background: 'var(--green3)', color: 'var(--green2)' }}>
            QC YES
          </span>
        ) : null}
        {/* Rework owed here — pieces an NC sent BACK to this op (same ♻N
            marker the Op Entry table shows beside the operation). */}
        {op.reworkPendingQty > 0 ? (
          <span
            className="tag"
            style={{ background: 'var(--amber3)', color: 'var(--amber2)' }}
            title={`${op.reworkPendingQty} piece(s) sent back to this operation for rework. Clears when the NC is closed (NC Register → Close Rework).`}
          >
            ♻ {op.reworkPendingQty}
          </span>
        ) : null}
        <span className={`badge ${st.cls}`}>{st.label}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
          Start : <b style={{ color: 'var(--text)' }}>{startStamp}</b>
        </span>
        <span style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
          End : <b style={{ color: 'var(--text)' }}>{endStamp}</b>
        </span>
        <span style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
          Cycle Time :{' '}
          <b style={{ color: 'var(--text)' }}>{cycleMin != null ? `${cycleMin} min` : '—'}</b>
        </span>
      </div>

      {/* ── BODY ── */}
      <div style={{ borderTop: '1px solid var(--border)', padding: 12, background: 'var(--bg3)' }}>
        {/* ── NC BREAKUP (§6): where this op's rejected pieces are right now ── */}
        <NcBreakupStrip nc={op.ncBreakup} jcCode={jc.code} />

        {/* ── CHIPS: Order Qty · Completed · Pending · QC Pending · Rejected
            · At Vendor, then the op-specific extras (RM Avail on the first op;
            Ready to Send / In QC on an OSP op). auto-fit: six across when there
            is room, fewer on a narrow screen. ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
            gap: 8,
            marginBottom: 10,
          }}
        >
          <QtyChip label="Order Qty" value={jc.orderQty} color="var(--text)" />
          <QtyChip
            label="Completed"
            value={doneQty}
            color="var(--green)"
            sub={
              isQc ? (
                <Sub color="var(--green)">✓ accepted</Sub>
              ) : op.qcRequired ? (
                <Sub color="var(--green)">✓{op.qcAcceptedQty} accepted</Sub>
              ) : null
            }
          />
          <QtyChip
            label="Pending"
            value={pendingQty}
            color={pendingQty > 0 ? 'var(--amber)' : 'var(--text3)'}
            highlight={pendingQty > 0}
          />
          {/* QC PENDING = pieces waiting to be inspected (v_jc_op_status
              qc_pending) — the ⏳ figure the DONE tile used to carry. */}
          <QtyChip
            label="QC Pending"
            value={op.qcPending}
            color={op.qcPending > 0 ? 'var(--amber)' : 'var(--text3)'}
            highlight={op.qcPending > 0}
          />
          {/* REJECTED (NC) = pieces this op's QC rejected (qc_rejected_qty),
              with what became of them underneath — the ✗ / ♻ lines the
              DONE tile used to carry. */}
          <QtyChip
            label="Rejected"
            value={op.qcRejectedQty}
            color={op.qcRejectedQty > 0 ? 'var(--red)' : 'var(--text3)'}
            sub={
              reworkOut ? (
                <Sub color="var(--amber)" title={reworkOutTitle}>
                  ♻{op.reworkRaisedQty} rework{reworkOutTo}
                </Sub>
              ) : null
            }
          />
          <QtyChip
            label="At Vendor"
            value={isOut ? op.atVendorQty : '—'}
            color={isOut && op.atVendorQty > 0 ? 'var(--blue)' : 'var(--text3)'}
          />
          {/* ADR-103 — only on the FIRST op: that is the operation client
              material feeds, and the only one the gate applies to. */}
          {rmAvailable ? (
            <QtyChip
              label="RM Available"
              value={rmAvailable.availableQty}
              color={rmAvailable.availableQty > 0 ? 'var(--cyan)' : 'var(--red)'}
              title={
                `Client material issued to this job card: ${rmAvailable.issuedQty}. ` +
                `Already produced on this operation: ${rmAvailable.consumedQty}. ` +
                (rmAvailable.availableQty > 0
                  ? `${rmAvailable.availableQty} can still be worked.`
                  : 'Issue more client material from Party Material Issue to continue.')
              }
              sub={
                <div style={{ fontSize: 8, color: 'var(--text3)' }}>
                  {rmAvailable.issuedQty} issued
                  {rmAvailable.availableQty === 0 ? (
                    <div style={{ color: 'var(--red)' }}>issue material</div>
                  ) : null}
                </div>
              }
            />
          ) : null}
          {/* OSP-only chips. PENDING above is the whole un-done balance and
              COUNTS the pieces already sitting at the vendor. READY TO SEND
              is what may go out today: upstream cleared − done in-house −
              already sent, read from v_osp_wip so the card, the OSP
              register and the outward-challan guard share ONE formula.
              JC-9 op 3: cleared 11, sent 10 → 1. */}
          {isOut ? (
            <>
              <QtyChip
                label="Ready to Send"
                value={op.readyToSendQty}
                color={op.readyToSendQty > 0 ? 'var(--purple)' : 'var(--text3)'}
                highlight={op.readyToSendQty > 0}
              />
              <QtyChip
                label="In QC"
                value={op.inQcQty}
                color={op.inQcQty > 0 ? 'var(--cyan)' : 'var(--text3)'}
              />
            </>
          ) : null}
        </div>

        {/* ── FIELDS — what kind of op decides which facts matter. ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: 10,
            borderTop: '1px dashed var(--border)',
            paddingTop: 10,
          }}
        >
          {isOut ? (
            /* Vendor + vendor-side status, resolved from the jc-ops board
               (OutsourceInfo carries its own caption). */
            <div>
              <OutsourceInfo
                jcCode={jc.code}
                jcOpId={op.id}
                status={op.outsourceStatus ?? 'pending'}
              />
            </div>
          ) : isQc ? (
            <>
              <InfoCell label="Inspector">{lastQcLog?.operatorName ?? '—'}</InfoCell>
              <InfoCell label="QC Date">
                {lastQcLog ? fmtJcStamp(lastQcLog.logDate, lastQcLog.startTime) : '—'}
              </InfoCell>
              <InfoCell label="Result">
                {/* Read off the op's own QC figures: accepted → green,
                    rejected → red (both when the batch split), nothing
                    inspected yet → pending / a dash. */}
                {op.qcAcceptedQty === 0 && op.qcRejectedQty === 0 ? (
                  op.qcPending > 0 ? (
                    <span className="badge b-amber">Pending</span>
                  ) : (
                    '—'
                  )
                ) : (
                  <span style={{ display: 'inline-flex', gap: 4 }}>
                    {op.qcAcceptedQty > 0 ? (
                      <span className="badge b-green">Accepted {op.qcAcceptedQty}</span>
                    ) : null}
                    {op.qcRejectedQty > 0 ? (
                      <span className="badge b-red">Rejected {op.qcRejectedQty}</span>
                    ) : null}
                  </span>
                )}
              </InfoCell>
            </>
          ) : (
            <>
              <InfoCell
                label="Machine"
                title={
                  actual.differs
                    ? actual.split.length
                      ? machineSplitTitle(actual.split)
                      : `Planned ${plannedMachine ?? '—'} — actually made on ${actual.label}`
                    : undefined
                }
              >
                <span className="mono">{plannedMachine ?? '—'}</span>
                {/* ADR-164 — where the pieces are ACTUALLY being made, when
                    that is not the planned machine. */}
                {actual.differs ? (
                  <span className="mono" style={{ color: 'var(--amber)' }}>
                    {' '}
                    → {actual.label}
                  </span>
                ) : null}
                {/* ADR-126 — when 2+ machines made the DONE qty, each
                    machine's share is printed, not only tooltipped. */}
                {actual.split.map((m) => (
                  <div
                    key={m.machineCode}
                    style={{ fontSize: 9, color: 'var(--text3)', fontWeight: 400 }}
                  >
                    {m.machineCode}: <b>{m.qty}</b> pcs
                  </div>
                ))}
              </InfoCell>
              <InfoCell label="Operator">{lastLog?.operatorName ?? '—'}</InfoCell>
              <InfoCell label="Program No.">
                <span className="mono">{op.program || '—'}</span>
              </InfoCell>
              <InfoCell label="Tool" title={toolDetails ?? undefined}>
                <span className="mono">{op.toolNo || '—'}</span>
                {toolDetails ? (
                  <span style={{ color: 'var(--text3)', fontWeight: 400 }}> · {toolDetails}</span>
                ) : null}
              </InfoCell>
              {/* No setup-time field exists on an operation yet; the slot
                  is the mockup's and reads as a dash until one does. */}
              <InfoCell label="Setup Time" title="No setup-time field on the operation yet">
                —
              </InfoCell>
              <InfoCell label="Last Entry">
                {lastLog ? fmtJcStamp(lastLog.logDate, lastLog.startTime) : '—'}
              </InfoCell>
            </>
          )}
          {/* A QC / OSP op rarely carries a program or tool, but when the
              routing recorded one it is still shown (the process block
              above has its own cells for these). */}
          {(isQc || isOut) && op.program ? (
            <InfoCell label="Program No.">
              <span className="mono">{op.program}</span>
            </InfoCell>
          ) : null}
          {(isQc || isOut) && (op.toolNo || toolDetails) ? (
            <InfoCell label="Tool" title={toolDetails ?? undefined}>
              <span className="mono">{op.toolNo || '—'}</span>
              {toolDetails ? (
                <span style={{ color: 'var(--text3)', fontWeight: 400 }}> · {toolDetails}</span>
              ) : null}
            </InfoCell>
          ) : null}
        </div>

        {/* ── ACTIONS: the operation's NEXT ACTION. Lives in jc-op-actions.tsx
            with the OSP ladder, because every button in it is permission-
            gated on the screen it opens and that gating belongs in one place. ── */}
        <JcOpFooter jc={jc} op={op} stopped={stopped} onStart={onStart} onLog={onLog} onQc={onQc} />

        {/* ── RECENT LOGS — the same latest-3 the table showed ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap',
            marginTop: 10,
            paddingTop: 8,
            borderTop: '1px dashed var(--border)',
            fontSize: 12,
            color: 'var(--text3)',
          }}
        >
          <span className="fw-700" style={{ color: 'var(--text2)', whiteSpace: 'nowrap' }}>
            Recent Logs
          </span>
          {recent.length === 0 ? (
            <span style={{ color: 'var(--text3)' }}>No entries</span>
          ) : (
            <>
              {logsOpen
                ? recent.map((l) => (
                    <span
                      key={l.id}
                      style={{ color: 'var(--text2)', whiteSpace: 'nowrap' }}
                      title={l.remarks ?? undefined}
                    >
                      <span className="mono" style={{ color: 'var(--text3)' }}>
                        {fmtJcStamp(l.logDate, l.startTime)}
                      </span>
                      {' · '}
                      {l.shift}
                      {' · Qty '}
                      <b style={{ color: 'var(--green)' }}>+{l.qty}</b>
                      {/* The reject was on the wire all along and never shown —
                          an entry that failed 9 of 10 read as "Qty +1" and
                          looked like an ordinary good day (ADR-183). */}
                      {l.rejectQty > 0 ? (
                        <>
                          {' · Rej '}
                          <b style={{ color: 'var(--red)' }}>{l.rejectQty}</b>
                        </>
                      ) : null}
                      {' · Operator '}
                      <b style={{ color: 'var(--text)' }}>{l.operatorName ?? '—'}</b>
                      {/* The NC the reject raised, with its status, straight to
                          the record. More than one only after a partial
                          disposition split it. */}
                      {l.ncs.length > 0 ? (
                        <>
                          {' · '}
                          <Link
                            to="/nc-register/$id"
                            params={{ id: l.ncs[0]!.id }}
                            className="mono"
                            style={{ color: 'var(--amber)', fontWeight: 700 }}
                            title={`Open ${l.ncs[0]!.code} — ${l.ncs[0]!.status}`}
                          >
                            {l.ncs[0]!.code}
                          </Link>{' '}
                          <span style={{ color: 'var(--text3)' }}>{l.ncs[0]!.status}</span>
                          {l.ncs.length > 1 ? (
                            <span style={{ color: 'var(--text3)' }}> +{l.ncs.length - 1} more</span>
                          ) : null}
                        </>
                      ) : null}
                    </span>
                  ))
                : null}
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => setLogsOpen((v) => !v)}
                aria-label={logsOpen ? 'Hide recent logs' : 'Show recent logs'}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontSize: 11,
                  color: 'var(--blue)',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {logsOpen
                  ? '▲ hide'
                  : `▼ latest ${recent.length} ${recent.length === 1 ? 'entry' : 'entries'}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
