// The QC Call Register "ruled sheet" — the stage strip, the table frame and the
// row shapes the register draws its calls on. Chosen from the user's mockups
// (2c "Ruled sheet"): no fills at all, hairline rules between rows, a stage
// step strip above the column headers, closest to a paper QC register book.
//
// Presentational only. The accept/reject entry forms, their validation,
// mutations and permission gates live in the popups the register opens
// (components/qc-call-inspect-modal.tsx for a job-card op,
// incoming-qc/components/incoming-qc-inspect-modal.tsx for a GRN line). The
// row components (routes/index.tsx PendingCall, incoming-qc/components/
// qc-call-rows.tsx IncomingPendingRow) draw their line through
// `PendingSheetRow` here and say whether the caller may open that popup.
//
// The frame is the app's ruled sheet (`.innovic-table.tbl-grid`, the same
// one the Plans, Job Card and Incoming QC lists wear — user, 2026-09-21):
// bold blue column names, gridlines, cream / white rows, centred columns.
// The inline TH / TD constants below carry only what the class does not —
// the sticky header, the cell overflow — so the two never fight.

import type { IncomingQcCompletedRow, QcHistoryLogRow } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { useNavigate } from '@tanstack/react-router';
import type { CSSProperties, ReactNode } from 'react';
import { QcReportLink } from '@/components/shared/qc-report-attach';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';

export type QcStage = 'incoming' | 'inprocess' | 'final';
export type QcView = 'pending' | 'completed';

export const QC_STAGES: ReadonlyArray<{ key: QcStage; n: number; label: string }> = [
  { key: 'incoming', n: 1, label: 'Incoming' },
  { key: 'inprocess', n: 2, label: 'In-Process' },
  { key: 'final', n: 3, label: 'Final Inspection' },
];

/** Where a process-QC (job-card op) call files on the strip. The last live op
 *  of a card is its Final Inspection gate (ADR-069); every other QC op is
 *  in-process. Incoming GRN lines never come through here — they are always
 *  stage 1. */
export function processStage(isLastOp: boolean): QcStage {
  return isLastOp ? 'final' : 'inprocess';
}

export interface StageStat {
  /** Calls in this stage for the CURRENT view (pending or completed). */
  count: number;
  /** Σ pending pieces over this stage's open calls. */
  pcsPending: number;
  /** Completed calls in this stage, over the rows the browser has. */
  done: number;
  /** True when the completed list hit the server's cap, so `done` is a floor. */
  doneCapped: boolean;
}

// ─── shared type styles ──────────────────────────────────────────────────────
const CAPS: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text2)',
};
const TH: CSSProperties = {
  whiteSpace: 'nowrap',
  position: 'sticky',
  top: 0,
  zIndex: 2,
};
const TD: CSSProperties = {
  verticalAlign: 'middle',
  overflow: 'hidden',
};
const NOWRAP: CSSProperties = { whiteSpace: 'nowrap' };
const MONO: CSSProperties = { fontFamily: 'var(--mono)' };
const MONO_STRONG: CSSProperties = { ...MONO, fontWeight: 700, color: 'var(--text)' };
const QUIET: CSSProperties = { fontSize: 11, color: 'var(--text3)' };
const TRUNC: CSSProperties = {
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

// ─── stage strip ─────────────────────────────────────────────────────────────
export function QcStageStrip(props: {
  stats: Record<QcStage, StageStat>;
  selected: QcStage | null;
  onSelect: (s: QcStage | null) => void;
}): React.JSX.Element {
  const { stats, selected, onSelect } = props;
  return (
    <div
      role="tablist"
      aria-label="QC stage"
      style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}
    >
      {QC_STAGES.map((s, i) => {
        const st = stats[s.key];
        const on = selected === s.key;
        return (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={on}
            title={on ? 'Show all stages' : `Show only ${s.label}`}
            onClick={() => onSelect(on ? null : s.key)}
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              borderRight: i < QC_STAGES.length - 1 ? '1px solid var(--border)' : 'none',
              borderBottom: on ? '2px solid var(--blue)' : '2px solid transparent',
              background: on ? 'var(--blue3)' : 'none',
              padding: '8px 16px 6px',
              textAlign: 'left',
              cursor: 'pointer',
              font: 'inherit',
              color: 'var(--text)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ ...CAPS, color: on ? 'var(--blue)' : 'var(--text3)' }}>{s.n}</span>
              <span style={{ ...CAPS, color: on ? 'var(--blue)' : 'var(--text2)' }}>{s.label}</span>
              <span style={{ flex: 1 }} />
              <span
                style={{
                  ...MONO,
                  fontSize: 20,
                  fontWeight: 700,
                  lineHeight: 1,
                  color: on ? 'var(--blue)' : undefined,
                }}
              >
                {st.count}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
              <span style={QUIET}>{st.pcsPending} pcs pending</span>
              <span style={QUIET}>
                {st.done}
                {st.doneCapped ? '+' : ''} done
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** "16 Sep" — day + short month for a date pair that must fit one line. */
function fmtDayMonth(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return fmtDate(iso);
  return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en-IN', { month: 'short' })}`;
}

// ─── table frame ─────────────────────────────────────────────────────────────
// [label, width %, header style]. Widths are fixed (table-layout: fixed) so a
// long vendor name or log number truncates inside its own column instead of
// pushing Verdict / Inspect off the right edge of the sheet.
// POL is the CUSTOMER's own purchase-order line number and sits immediately
// before the item column, as it does on every other document. It used to be
// buried in the context line; it is a column of its own now. The width comes
// out of the context column so the set still totals exactly 100.
const PENDING_COLS: ReadonlyArray<[string, number, CSSProperties?]> = [
  ['Doc No.', 13],
  ['POL', 5, { color: 'var(--purple)' }],
  ['Item Code', 17],
  ['Details', 21],
  ['QC Pending', 6],
  ['Called', 14],
  ['Stage', 14],
  ['Action', 10],
];
const COMPLETED_COLS: ReadonlyArray<[string, number, CSSProperties?]> = [
  ['Doc No.', 13],
  ['POL', 5, { color: 'var(--purple)' }],
  ['Item Code', 15],
  ['Details', 15],
  ['Accepted', 5],
  ['Rejected', 5],
  ['Called → Attended', 14],
  ['Inspected By · Log Ref', 18],
  ['Verdict', 10],
];
// Quantity columns read right-aligned, header and cells alike.
const NUM_COLS = new Set(['QC Pending', 'Accepted', 'Rejected']);
export function QcSheetTable(props: {
  view: QcView;
  children: ReactNode;
  empty: ReactNode | null;
}): React.JSX.Element {
  const cols = props.view === 'pending' ? PENDING_COLS : COMPLETED_COLS;
  return (
    <div className="tbl-wrap" style={{ background: 'var(--bg2)' }}>
      <table className="innovic-table tbl-grid">
        <colgroup>
          {cols.map(([, w], i) => (
            <col key={i} style={{ width: `${w}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {cols.map(([label, , st], i) => (
              <th
                key={i}
                className={NUM_COLS.has(label) ? 'th-num' : undefined}
                style={{ ...TH, ...st }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{props.children}</tbody>
      </table>
      {props.empty}
    </div>
  );
}

// ─── cells ───────────────────────────────────────────────────────────────────
/** Part name bold on line 1, item code mono strong on line 2. The code is what
 *  identifies the batch on the inspector's table, so it is never the faint
 *  token. */
function PartCell({ name, code }: { name: string | null; code: string }): React.JSX.Element {
  return (
    <td style={TD}>
      <div className="fw-700" style={TRUNC} title={name ?? undefined}>
        {name ?? '—'}
      </div>
      <div style={{ ...MONO_STRONG, fontSize: 12 }}>{code}</div>
    </td>
  );
}

/** POL — the customer's own PO line number. Purple mono, an em dash when the
 *  row has no sales order behind it (a raw-material receipt). */
function PolCell({ value }: { value: string | null }): React.JSX.Element {
  return (
    <td style={{ ...TD, ...NOWRAP }}>
      <span style={{ ...MONO_STRONG, fontSize: 12, color: 'var(--purple)' }}>{value ?? '—'}</span>
    </td>
  );
}

function CodeCell({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <td style={{ ...TD, ...NOWRAP }}>
      <span style={{ ...MONO_STRONG, fontSize: 12 }}>{children}</span>
    </td>
  );
}

function ContextCell({ line1, line2 }: { line1: ReactNode; line2?: ReactNode }): React.JSX.Element {
  return (
    <td style={TD}>
      <div className="text2" style={TRUNC}>
        {line1}
      </div>
      {line2 ? <div style={{ ...QUIET, ...TRUNC }}>{line2}</div> : null}
    </td>
  );
}

function NumCell({ value, red }: { value: number; red?: boolean }): React.JSX.Element {
  return (
    <td className="td-num" style={{ ...TD, ...NOWRAP }}>
      <span
        style={{
          ...MONO,
          fontWeight: 700,
          color: red && value > 0 ? 'var(--red)' : value === 0 ? 'var(--text3)' : 'var(--text)',
        }}
      >
        {value}
      </span>
    </td>
  );
}

/** "Called → Attended" on line 1, the response time on line 2. */
function CalledAttendedCell(props: {
  called: string | null;
  attended: string | null;
  respDays: number | null;
}): React.JSX.Element {
  const { called, attended, respDays } = props;
  const resp = respDays == null ? null : respDays <= 0 ? 'Same day' : `${respDays} days`;
  // Two dates share one line, so each is "16 Sep" (the mockup's form); the
  // full DD-MMM-YYYY pair is on hover.
  const full = `${called ? fmtDate(called) : '—'} → ${attended ? fmtDate(attended) : '—'}`;
  return (
    <td style={{ ...TD, ...NOWRAP }}>
      <div style={{ ...MONO, fontSize: 12 }} title={full}>
        {called ? fmtDayMonth(called) : '—'} → {attended ? fmtDayMonth(attended) : '—'}
      </div>
      {resp ? <div style={QUIET}>{resp}</div> : null}
    </td>
  );
}

function InspectorCell(props: {
  name: string | null;
  /** The log number. Not `ref` — that name is reserved by React, and a string
   *  in it throws (#290) the moment a completed row renders. */
  logRef: string | null;
  remarks: string | null;
}): React.JSX.Element {
  return (
    <td style={TD}>
      <div style={TRUNC} title={props.name ?? undefined}>
        {props.name ?? '—'}
      </div>
      <div style={{ ...QUIET, ...TRUNC }} title={props.remarks ?? undefined}>
        {props.logRef ? <span style={MONO}>{props.logRef}</span> : null}
        {props.logRef && props.remarks ? ' · ' : ''}
        {props.remarks ?? ''}
      </div>
    </td>
  );
}

type Verdict = 'ACCEPTED' | 'PARTIAL' | 'REJECTED';

const VERDICT_LABEL: Record<Verdict, string> = {
  ACCEPTED: 'Accepted',
  PARTIAL: 'Partly Accepted',
  REJECTED: 'Rejected',
};

function VerdictCell(props: {
  verdict: Verdict;
  reportPath: string | null;
  reportName: string | null;
}): React.JSX.Element {
  const red = props.verdict !== 'ACCEPTED';
  return (
    <td style={{ ...TD, ...NOWRAP }}>
      {props.reportPath ? (
        <span style={{ marginRight: 8 }} onClick={(e) => e.stopPropagation()}>
          <QcReportLink path={props.reportPath} name={props.reportName} label="📎" />
        </span>
      ) : null}
      <span
        style={{
          ...CAPS,
          // The verdict shows its Title Case label as written, not in caps.
          textTransform: 'none',
          letterSpacing: 0,
          display: 'inline-block',
          padding: '3px 10px',
          borderRadius: 4,
          border: `1px solid ${red ? 'var(--red)' : 'var(--border2)'}`,
          color: red ? 'var(--red)' : 'var(--text2)',
        }}
      >
        {VERDICT_LABEL[props.verdict]}
      </span>
    </td>
  );
}

const ROW_CLICK: CSSProperties = { cursor: 'pointer' };

// ─── completed rows ──────────────────────────────────────────────────────────
/** Process-QC (job-card op) completed entry. Click → the Job Cards list opened
 *  on that card; the log row carries the card's code, not its id, so the list
 *  search is the honest hop to the JC status page. */
export function CompletedProcessSheetRow({ l }: { l: QcHistoryLogRow }): React.JSX.Element {
  const navigate = useNavigate();
  const verdict: Verdict = l.rejected > 0 ? (l.accepted > 0 ? 'PARTIAL' : 'REJECTED') : 'ACCEPTED';
  const resp = l.qcCallDate ? dayDiff(l.qcCallDate, l.logDate) : null;
  return (
    <tr
      style={ROW_CLICK}
      title="Open this job card"
      onClick={() =>
        void (l.jobCardId
          ? navigate({ to: '/job-cards/$id', params: { id: l.jobCardId } })
          : navigate({ to: '/job-cards', search: { search: l.jcCode, page: 1 } }))
      }
    >
      <CodeCell>{l.jcCode}</CodeCell>
      <PolCell value={l.clientPoLineNo} />
      <PartCell name={l.itemName} code={itemCodeWithRev(l.itemCode, l.itemRevision)} />
      <ContextCell
        line1={
          <>
            <span style={MONO}>{l.soCode ?? '—'}</span> · Op{opSrNo(l.opSeq)} {l.operation}
          </>
        }
      />
      <NumCell value={l.accepted} />
      <NumCell value={l.rejected} red />
      <CalledAttendedCell called={l.qcCallDate} attended={l.logDate} respDays={resp} />
      <InspectorCell name={l.inspector} logRef={l.logNo} remarks={l.remarks} />
      <VerdictCell verdict={verdict} reportPath={l.qcReportPath} reportName={l.qcReportName} />
    </tr>
  );
}

/** Incoming-material (GRN line) completed inspection. Click → the GRN. */
export function CompletedIncomingSheetRow({ l }: { l: IncomingQcCompletedRow }): React.JSX.Element {
  const navigate = useNavigate();
  const verdict: Verdict =
    l.disposition === 'Rejected'
      ? 'REJECTED'
      : l.disposition === 'Partial Accept'
        ? 'PARTIAL'
        : 'ACCEPTED';
  return (
    <tr
      style={ROW_CLICK}
      title="Open this GRN"
      onClick={() => void navigate({ to: '/goods-receipt-notes/$id', params: { id: l.grnId } })}
    >
      <CodeCell>{l.grnNo}</CodeCell>
      <PolCell value={l.clientPoLineNo} />
      <PartCell name={l.itemName} code={itemCodeWithRev(l.itemCode, l.itemRevision)} />
      <ContextCell
        line1={
          <>
            {l.vendorName ?? '—'} · GRN <span style={MONO}>{l.grnNo}</span>
          </>
        }
      />
      <NumCell value={l.acceptedQty} />
      <NumCell value={l.rejectedQty} red />
      <CalledAttendedCell called={l.grnDate} attended={l.qcDate} respDays={l.respDays} />
      <InspectorCell name={l.qcInspectedBy} logRef={null} remarks={l.qcRemarks} />
      <VerdictCell verdict={verdict} reportPath={l.qcReportPath} reportName={l.qcReportName} />
    </tr>
  );
}

// ─── pending row (one line; click opens the entry popup) ─────────────────────
export function PendingSheetRow(props: {
  /** The document number cell — a Link is fine; clicks inside it don't open. */
  code: ReactNode;
  /** The customer's PO line number for this call, or null. */
  clientPoLineNo: string | null;
  partName: string | null;
  itemCode: string;
  context: ReactNode;
  contextLine2?: ReactNode;
  qty: number;
  /** YYYY-MM-DD the call was raised (GRN date / QC pend-since). */
  calledDate: string | null;
  waitDays: number | null;
  overdue: boolean;
  stage: QcStage;
  /** Whether the caller may record an inspection. False → the line reads
   *  "View only" and does not open anything. */
  canInspect: boolean;
  /** Open the entry popup for this call. */
  onInspect: () => void;
  /** Extra className for the line (the overdue blink). */
  className?: string | undefined;
}): React.JSX.Element {
  const stage = QC_STAGES.find((s) => s.key === props.stage);
  const wait =
    props.waitDays == null
      ? null
      : props.waitDays <= 0
        ? 'Today'
        : `${props.waitDays} day${props.waitDays > 1 ? 's' : ''} waiting`;
  return (
    <tr
      className={props.className}
      style={props.canInspect ? ROW_CLICK : undefined}
      onClick={props.canInspect ? props.onInspect : undefined}
    >
      <td style={{ ...TD, ...NOWRAP }} onClick={(e) => e.stopPropagation()}>
        <span style={{ ...MONO_STRONG, fontSize: 12 }}>{props.code}</span>
      </td>
      <PolCell value={props.clientPoLineNo} />
      <PartCell name={props.partName} code={props.itemCode} />
      <ContextCell line1={props.context} line2={props.contextLine2} />
      <NumCell value={props.qty} />
      <td style={{ ...TD, ...NOWRAP }}>
        <div style={{ ...MONO, fontSize: 12 }}>{fmtDate(props.calledDate)}</div>
        {wait ? (
          <div
            style={{
              ...QUIET,
              color: props.overdue ? 'var(--red)' : 'var(--text3)',
              fontWeight: props.overdue ? 700 : 400,
            }}
          >
            {wait}
            {props.overdue ? ' · overdue' : ''}
          </div>
        ) : null}
      </td>
      <td style={{ ...TD, ...NOWRAP }}>
        <span style={CAPS}>
          {stage?.n} {stage?.label}
        </span>
      </td>
      <td style={{ ...TD, ...NOWRAP }}>
        {/* No form to open (viewer without `entry`) → say so instead of
            offering an "Inspect ▸" that opens nothing. */}
        {props.canInspect ? (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--cyan)' }}>Inspect ▸</span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>View only</span>
        )}
      </td>
    </tr>
  );
}

// Whole-day diff between two YYYY-MM-DD dates (legacy /864e5 round). Parsed at
// UTC midnight so the result is timezone-independent.
export function dayDiff(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 864e5);
}
