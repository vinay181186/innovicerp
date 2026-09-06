// Operations Detail — per-op CARD (read-only / VIEW mode).
//
// DESIGN-ONLY port of the JC Status "Operations Detail" table row
// (jc-status-content.tsx, view branch). Every value, badge, button, condition
// and destination is copied from that table unchanged — the table's 13 columns
// are re-laid-out as a card:
//
//   table column          → card slot
//   ─────────────────────────────────────────────────────────────────
//   Op / Machine / Operation → header line (seq chip, machine, operation, tags)
//   Status                   → header-right badge (+ left accent bar)
//   Order/Completed/Pending/At Vendor/In QC → QUANTITIES tile row
//   Cycle / Prog+Tool        → SETUP chip row
//   (outsource machine cell) → OUTSOURCE block
//   Recent Logs              → collapsible RECENT LOGS strip
//   Action                   → footer strip
//
// No quantity, badge or calculation changed. The outsource vendor/PR/PO lookups
// keep their original shape: the jc-ops board is fetched ONLY from inside an
// outsource op's sub-components (now jc-op-actions.tsx), so a JC with no
// outsource ops still issues no board request (identical query key → TanStack
// Query dedupes).
//
// The footer strip is the one thing that has grown: it is the NEXT ACTION for
// this operation, not a dead end — Gen PO / Gen DC / Receive / Incoming QC for
// an OSP op, TPI for a third-party inspection, Report NC on every op — and
// every button in it is permission-gated. That strip and its gating live in
// jc-op-actions.tsx (JcOpFooter), so this file stays layout only.
import type {
  JcOpEnriched,
  JobCardListItem,
  JobCardRmAvailable,
  OpLog,
} from '@innovic/shared';
import { useState } from 'react';
import { MachineChip, MachineSplitLines } from '@/components/shared/machine-split';
import { OP_STATUS, opAccentColor } from '../lib/jc-op-labels';
import { JcOpFooter, OutsourceInfo } from './jc-op-actions';
import { QtyTile, SetupChip, secLabel } from './jc-op-card-parts';

export function JcOpCard({
  jc,
  op,
  machineName,
  toolDetails,
  rmAvailable,
  logs,
  onStart,
  onLog,
  onQc,
}: {
  jc: JobCardListItem;
  op: JcOpEnriched;
  /** Server-resolved machine name (extras.opExtras) — the enriched op omits it. */
  machineName: string | null;
  /** Server-resolved tool details (extras.opExtras). */
  toolDetails: string | null;
  /** ADR-103 — client material still workable on this JWSO Job Card
   *  (issued − already produced). The caller passes it ONLY for the first op —
   *  the operation client material actually feeds and the only one the gate
   *  applies to — and null everywhere else. */
  rmAvailable: JobCardRmAvailable | null;
  /** Already sliced to the latest 3 by the caller, exactly as the table did. */
  logs: OpLog[];
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

  // What became of THIS op's rejects (0090). `reworkPendingQty` above lights the
  // op that has to redo the work; this lights the op that found the fault, which
  // otherwise showed a bare "✗5 rej" and no sign of the disposition. Suppressed
  // when the rework came back to this same op — the ♻ tag in the header already
  // says so and two markers for one decision reads as two decisions.
  const reworkOutTo =
    op.reworkRaisedToOps && op.reworkRaisedToOps !== String(op.opSeq)
      ? ` → Op${op.reworkRaisedToOps}`
      : '';
  const reworkOut = op.reworkRaisedQty > 0 && reworkOutTo !== '';
  const reworkOutTitle = `${op.reworkRaisedQty} piece(s) rejected here and sent back to Op${op.reworkRaisedToOps ?? ''} for rework. Clears when the NC is closed.`;

  return (
    <div
      style={{
        display: 'flex',
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
        marginBottom: 10,
      }}
    >
      {/* Left accent bar — same colour family as the status badge. */}
      <div style={{ width: 4, flexShrink: 0, background: opAccentColor(st.cls) }} />
      <div style={{ flex: 1, minWidth: 0, padding: '10px 14px' }}>
        {/* ── HEADER: seq · machine · operation · tags — status badge ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 10,
          }}
        >
          <span
            className="mono fw-700"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 24,
              height: 24,
              padding: '0 6px',
              borderRadius: 6,
              background: 'var(--bg4)',
              border: '1px solid var(--border2)',
              fontSize: 12,
              color: 'var(--text2)',
            }}
          >
            {op.opSeq}
          </span>
          <span className="fw-700" style={{ fontSize: 14 }}>
            {isQc ? 'QC' : isOut ? 'OSP' : (op.machineCode ?? op.machineCodeText ?? '—')}
            {/* ADR-126 — the label above is the machine the REMAINING qty runs
                on. Once an op has run on more than one machine it stops matching
                the DONE tile below, so say so rather than implying the current
                machine made everything. One machine (the norm) renders exactly
                as before — MachineChip returns null. */}
            <MachineChip machines={op.machines} />
          </span>
          {machineName && !isQc && !isOut ? (
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{machineName}</span>
          ) : null}
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>{op.operation}</span>
          {isOut ? <span className="tag" style={{ background: 'var(--amber3)', color: 'var(--amber2)' }}>OSP</span> : null}
          {isQc ? <span className="tag" style={{ background: 'var(--green3)', color: 'var(--green2)' }}>QC</span> : null}
          {!isQc && op.qcRequired ? (
            <span className="tag" style={{ background: 'var(--green3)', color: 'var(--green2)' }}>QC YES</span>
          ) : null}
          {/* Rework owed here — pieces an NC sent BACK to this op. The Op Entry
              table has always shown this (♻N beside the operation); this card
              did not, so on IN-JC-26-00085 Op1 read a bare "Complete" while it
              still owed 5 re-cut pins. Same marker, same place. */}
          {op.reworkPendingQty > 0 ? (
            <span
              className="tag"
              style={{ background: 'var(--amber3)', color: 'var(--amber2)' }}
              title={`${op.reworkPendingQty} piece(s) sent back to this operation for rework. Clears when the NC is closed (NC Register → Close Rework).`}
            >
              ♻ {op.reworkPendingQty}
            </span>
          ) : null}
          <span style={{ flex: 1 }} />
          <span className={`badge ${st.cls}`}>{st.label}</span>
        </div>

        {/* ── BODY: quantities · setup · outsource ── */}
        <div
          style={{
            display: 'flex',
            gap: 22,
            flexWrap: 'wrap',
            alignItems: 'flex-start',
            // Was `logs.length > 0 || hasFooter`, but `hasFooter` was deleted
            // along with the conditional wrapper when the footer became
            // unconditional (f438b86) — and this one use of it survived, which
            // is what stopped the app compiling. The footer's own visibility
            // now lives inside JcOpFooter, where this file cannot see it, so
            // the gap is fixed rather than guessed at.
            marginBottom: 10,
          }}
        >
          <div>
            <div style={secLabel}>Quantities</div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <QtyTile label="ORDER" value={jc.orderQty} color="var(--text)" />
              {/* ADR-103 — only on the FIRST op: that is the operation client
                  material feeds, and the only one the gate applies to. */}
              {rmAvailable ? (
                <QtyTile
                  label="RM AVAIL"
                  value={rmAvailable.availableQty}
                  color={rmAvailable.availableQty > 0 ? 'var(--cyan)' : 'var(--red)'}
                  sub={
                    <div
                      style={{ fontSize: 8, color: 'var(--text3)' }}
                      title={
                        `Client material issued to this job card: ${rmAvailable.issuedQty}. ` +
                        `Already produced on this operation: ${rmAvailable.consumedQty}. ` +
                        (rmAvailable.availableQty > 0
                          ? `${rmAvailable.availableQty} can still be worked.`
                          : 'Issue more client material from Party Material Issue to continue.')
                      }
                    >
                      {rmAvailable.issuedQty} issued
                      {rmAvailable.availableQty === 0 ? (
                        <div style={{ color: 'var(--red)' }}>issue material</div>
                      ) : null}
                    </div>
                  }
                />
              ) : null}
              <QtyTile
                label="DONE"
                value={doneQty}
                color="var(--green)"
                sub={
                  <>
                    {isQc ? (
                    <>
                      <div style={{ fontSize: 8, color: 'var(--green)' }}>✓ accepted</div>
                      {op.qcRejectedQty > 0 ? (
                        <div style={{ fontSize: 8, color: 'var(--red)' }}>✗{op.qcRejectedQty} rej</div>
                      ) : null}
                      {reworkOut ? (
                        <div style={{ fontSize: 8, color: 'var(--amber)' }} title={reworkOutTitle}>
                          ♻{op.reworkRaisedQty} rework{reworkOutTo}
                        </div>
                      ) : null}
                      {op.qcPending > 0 ? (
                        <div style={{ fontSize: 8, color: 'var(--amber)' }}>⏳{op.qcPending} pending</div>
                      ) : null}
                    </>
                  ) : op.qcRequired ? (
                    <>
                      <div style={{ fontSize: 8, color: 'var(--green)' }}>✓{op.qcAcceptedQty} acc</div>
                      {op.qcRejectedQty > 0 ? (
                        <div style={{ fontSize: 8, color: 'var(--red)' }}>✗{op.qcRejectedQty} rej</div>
                      ) : null}
                      {reworkOut ? (
                        <div style={{ fontSize: 8, color: 'var(--amber)' }} title={reworkOutTitle}>
                          ♻{op.reworkRaisedQty} rework{reworkOutTo}
                        </div>
                      ) : null}
                      {op.qcPending > 0 ? (
                        <div style={{ fontSize: 8, color: 'var(--amber)' }}>⏳{op.qcPending} pend</div>
                      ) : null}
                    </>
                    ) : null}
                    {/* The per-machine breakdown of this DONE figure (ADR-126).
                        Renders nothing unless the op ran on more than one
                        machine. Skipped on a QC op: the split describes
                        MACHINED production, and DONE there is the inspection's
                        accepted count (doneQty above), which no machine made. */}
                    {isQc ? null : <MachineSplitLines machines={op.machines} />}
                  </>
                }
              />
              <QtyTile
                label="PENDING"
                value={pendingQty}
                color={pendingQty > 0 ? 'var(--amber)' : 'var(--text3)'}
                highlight={pendingQty > 0}
              />
              {/* PENDING above is the whole un-done balance and COUNTS the pieces
                  already sitting at the vendor. This is what may go out today:
                  upstream cleared − done in-house − already sent, read from
                  v_osp_wip so the card, the OSP register and the outward-challan
                  guard share ONE formula. JC-9 op 3: cleared 11, sent 10 → 1. */}
              <QtyTile
                label="READY TO SEND"
                value={isOut ? op.readyToSendQty : '—'}
                color={isOut && op.readyToSendQty > 0 ? 'var(--purple)' : 'var(--text3)'}
                highlight={isOut && op.readyToSendQty > 0}
              />
              <QtyTile
                label="AT VENDOR"
                value={isOut ? op.atVendorQty : '—'}
                color={isOut && op.atVendorQty > 0 ? 'var(--blue)' : 'var(--text3)'}
              />
              <QtyTile
                label="IN QC"
                value={isOut ? op.inQcQty : '—'}
                color={isOut && op.inQcQty > 0 ? 'var(--cyan)' : 'var(--text3)'}
              />
            </div>
          </div>

          <div style={{ minWidth: 140 }}>
            <div style={secLabel}>Setup</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', rowGap: 3 }}>
              {/* The column is `jc_ops.cycle_time_min` — MINUTES. Legacy's
                  "Cycle(h)" header (and the port that inherited it) mislabelled
                  the unit; the create form and the Excel export already say
                  "Cycle (min)". Corrected here so all four agree. */}
              <SetupChip
                label="Cycle (min)"
                value={Number(op.cycleTimeMin) || '—'}
                color="var(--text2)"
              />
              {op.program ? (
                <SetupChip label="Prog" value={op.program} color="var(--blue)" />
              ) : null}
              {op.toolNo ? <SetupChip label="Tool" value={op.toolNo} color="var(--cyan)" /> : null}
              {toolDetails ? (
                <SetupChip label="Details" value={toolDetails} color="var(--text3)" />
              ) : null}
              {/* The table showed a single "—" for an empty Prog/Tool cell;
                  in the card that dash needs its own caption so it does not
                  read as a second value on the Cycle chip. */}
              {!op.program && !op.toolNo && !toolDetails ? (
                <SetupChip label="Prog/Tool" value="—" color="var(--text3)" />
              ) : null}
            </div>
          </div>

          <div style={{ minWidth: 120, marginLeft: 'auto' }}>
            <div style={{ ...secLabel, textAlign: 'right' }}>Outsource</div>
            <div style={{ textAlign: 'right' }}>
              {isOut ? (
                <OutsourceInfo
                  jcCode={jc.code}
                  jcOpId={op.id}
                  status={op.outsourceStatus ?? 'pending'}
                />
              ) : (
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>Not outsourced</span>
              )}
            </div>
          </div>
        </div>

        {/* ── RECENT LOGS — same latest-3 the table showed, now collapsible ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ ...secLabel, marginBottom: 0 }}>Recent Logs</span>
          {logs.length === 0 ? (
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>No entries</span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setLogsOpen((v) => !v)}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontSize: 11,
                  color: 'var(--blue)',
                  fontWeight: 600,
                }}
              >
                {`latest ${logs.length} log ${logs.length === 1 ? 'entry' : 'entries'}`}
              </button>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                onClick={() => setLogsOpen((v) => !v)}
                aria-label={logsOpen ? 'Collapse logs' : 'Expand logs'}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontSize: 11,
                  color: 'var(--text3)',
                }}
              >
                {logsOpen ? '▲' : '▼'}
              </button>
            </>
          )}
        </div>
        {logs.length > 0 && logsOpen ? (
          <div
            style={{
              marginTop: 6,
              padding: '6px 10px',
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
          >
            {logs.map((l) => (
              <div key={l.id} style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.9 }}>
                <span className="mono" style={{ color: 'var(--text3)' }}>
                  {l.logDate}
                </span>{' '}
                · {l.shift} · <b style={{ color: 'var(--green)' }}>+{l.qty}</b> ·{' '}
                {l.operatorName ?? ''}
              </div>
            ))}
          </div>
        ) : null}

        {/* ── FOOTER: the operation's NEXT ACTION. Lives in jc-op-actions.tsx
            with the OSP ladder, because every button in it is permission-gated
            on the screen it opens and that gating belongs in one place. ── */}
        <JcOpFooter
          jcCode={jc.code}
          op={op}
          onStart={onStart}
          onLog={onLog}
          onQc={onQc}
        />
      </div>
    </div>
  );
}
