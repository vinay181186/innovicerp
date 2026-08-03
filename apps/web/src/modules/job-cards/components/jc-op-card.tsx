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
// No logic, no calculation and no API call changed. The outsource vendor/PR/PO
// lookups keep their original shape: the jc-ops board is fetched ONLY from
// inside an outsource op's sub-components, so a JC with no outsource ops still
// issues no board request (identical query key → TanStack Query dedupes).
import type {
  JcOpEnriched,
  JcOpsBoardRow,
  JobCardListItem,
  OpLog,
  OutsourceStatus,
} from '@innovic/shared';
import { useState } from 'react';
import { useJcOpsBoard } from '@/modules/jc-ops/api';
import { OP_STATUS, OUTSOURCE_STATUS_LABEL, opAccentColor } from '../lib/jc-op-labels';
import { QtyTile, SetupChip, secLabel } from './jc-op-card-parts';

// Outsource vendor/PR/PO details for a JC op. Wired from the existing jc-ops
// board endpoint (useJcOpsBoard, jc-ops/api.ts:31), whose row already carries
// outsourceVendorName / outsourcePrCode / outsourcePoCode (jc-ops.ts:39-41,
// populated in jc-ops/service.ts:70-72) — fields the op-entry enriched op shape
// omits. Legacy renders these at L11043 (vendor name) and L11070-74 (PR/PO).
function useOutsourceRow(jcCode: string, jcOpId: string): JcOpsBoardRow | undefined {
  const { data } = useJcOpsBoard({ jcCode, limit: 500, offset: 0 });
  return data?.items.find((r) => r.jcOpId === jcOpId);
}

// OUTSOURCE block for an outsource op (was the Machine cell, legacy L11043):
// label + resolved vendor name + status.
function OutsourceInfo({
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

// Footer refs for an outsource op (legacy L11070-74): PR ref when a PR is
// raised, PO ref when a PO is created, otherwise the raw status. Legacy's
// "Create PR" branch (L11070) is an OSP action that lives in Op Entry
// (useGenerateOspPr), not on this read-oriented status page — so only the
// resulting references are surfaced here.
function OutsourceActionRefs({
  jcCode,
  jcOpId,
  status,
}: {
  jcCode: string;
  jcOpId: string;
  status: OutsourceStatus;
}): React.JSX.Element {
  const row = useOutsourceRow(jcCode, jcOpId);
  if (status === 'pr_raised' && row?.outsourcePrCode) {
    return <span style={{ fontSize: 11, color: 'var(--blue)' }}>PR: {row.outsourcePrCode}</span>;
  }
  if (status === 'po_created' && row?.outsourcePoCode) {
    return <span style={{ fontSize: 11, color: 'var(--cyan)' }}>PO: {row.outsourcePoCode}</span>;
  }
  return <span style={{ fontSize: 11, color: 'var(--purple)' }}>{OUTSOURCE_STATUS_LABEL[status]}</span>;
}

export function JcOpCard({
  jc,
  op,
  machineName,
  toolDetails,
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
  // Canonical per-op quantities — copied verbatim from the table:
  // Completed = this op's done qty (QC → accepted; process/outsource →
  // completedQty, which for outsource is accepted-back per 0068),
  // Pending = Order − Completed.
  const doneQty = isQc ? op.qcAcceptedQty : op.completedQty;
  const pendingQty = Math.max(0, jc.orderQty - doneQty);

  // Footer action ladder — the table's Action cell, condition-for-condition.
  const showLog =
    !isOut &&
    !isQc &&
    (op.computedStatus === 'in_progress' ||
      op.computedStatus === 'running' ||
      op.completedQty > 0);
  const showStart =
    !isQc && !isOut && (op.computedStatus === 'available' || op.computedStatus === 'waiting');
  const showDone = !isOut && !isQc && op.computedStatus === 'complete';
  const hasFooter = isOut || isQc || showDone || showLog || showStart;

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
            marginBottom: logs.length > 0 || hasFooter ? 10 : 0,
          }}
        >
          <div>
            <div style={secLabel}>Quantities</div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              <QtyTile label="ORDER" value={jc.orderQty} color="var(--text)" />
              <QtyTile
                label="DONE"
                value={doneQty}
                color="var(--green)"
                sub={
                  isQc ? (
                    <>
                      <div style={{ fontSize: 8, color: 'var(--green)' }}>✓ accepted</div>
                      {op.qcRejectedQty > 0 ? (
                        <div style={{ fontSize: 8, color: 'var(--red)' }}>✗{op.qcRejectedQty} rej</div>
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
                      {op.qcPending > 0 ? (
                        <div style={{ fontSize: 8, color: 'var(--amber)' }}>⏳{op.qcPending} pend</div>
                      ) : null}
                    </>
                  ) : null
                }
              />
              <QtyTile
                label="PENDING"
                value={pendingQty}
                color={pendingQty > 0 ? 'var(--amber)' : 'var(--text3)'}
                highlight={pendingQty > 0}
              />
              <QtyTile
                label="VENDOR"
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

        {/* ── FOOTER: the table's Action cell, unchanged ── */}
        {hasFooter ? (
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
                jcCode={jc.code}
                jcOpId={op.id}
                status={op.outsourceStatus ?? 'pending'}
              />
            ) : isQc ? (
              op.qcPending > 0 ? (
                <button type="button" className="btn btn-sm" style={{ color: 'var(--green)' }} onClick={onQc}>
                  🔬 QC ({op.qcPending})
                </button>
              ) : op.computedStatus === 'complete' ? (
                <span style={{ color: 'var(--green)', fontSize: 12 }}>✓ QC Done</span>
              ) : (
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>Waiting</span>
              )
            ) : showDone ? (
              <span style={{ color: 'var(--green)', fontSize: 12 }}>✓ Done</span>
            ) : showLog ? (
              /* T33: Log only once the op is started; otherwise the Start
                 button below is the only action shown. */
              <button type="button" className="btn btn-sm btn-primary" onClick={() => onLog(op.id)}>
                ✚ Log
              </button>
            ) : null}
            {showStart ? (
              <button type="button" className="btn btn-sm" onClick={() => onStart(op.id)}>
                ▶ Start
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
