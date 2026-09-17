// The QC Call Register "ruled sheet" — the stage strip, the table frame and the
// row shapes the register draws its calls on. Chosen from the user's mockups
// (2c "Ruled sheet"): no fills at all, hairline rules between rows, a stage
// step strip above the column headers, closest to a paper QC register book.
//
// Presentational only. The accept/reject entry forms, their validation,
// mutations and permission gates stay in the row components that were there
// before (routes/index.tsx PendingCall, incoming-qc/components/qc-call-rows.tsx
// IncomingPendingRow); they render their collapsed line through
// `PendingSheetRow` here and hand the expanded form in as children.
//
// Styling is inline on purpose: the shared stylesheet is frozen while other
// agents run, and `.innovic-table` brings the zebra, the filled sticky header
// and the centred columns this sheet is specifically meant not to have.

import type { IncomingQcCompletedRow, QcHistoryLogRow } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { useNavigate } from '@tanstack/react-router';
import type { CSSProperties, ReactNode } from 'react';
import { QcReportLink } from '@/components/shared/qc-report-attach';
import { itemCodeWithRev } from '@/lib/item-code';
import { fmtDate } from '@/lib/print/doc-print';

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
  ...CAPS,
  padding: '8px 12px',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg2)',
  position: 'sticky',
  top: 0,
  zIndex: 2,
};
const TD: CSSProperties = {
  padding: '9px 12px',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'middle',
  fontSize: 13,
  textAlign: 'left',
};
const NOWRAP: CSSProperties = { whiteSpace: 'nowrap' };
const MONO: CSSProperties = { fontFamily: 'var(--mono)' };
const MONO_STRONG: CSSProperties = { ...MONO, fontWeight: 700, color: 'var(--text)' };
const QUIET: CSSProperties = { fontSize: 11, color: 'var(--text3)' };
const TRUNC: CSSProperties = {
  maxWidth: 240,
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
              background: 'none',
              border: 'none',
              borderRight: i < QC_STAGES.length - 1 ? '1px solid var(--border)' : 'none',
              borderBottom: on ? '2px solid var(--text)' : '2px solid transparent',
              padding: '8px 16px 6px',
              textAlign: 'left',
              cursor: 'pointer',
              font: 'inherit',
              color: 'var(--text)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ ...CAPS, color: 'var(--text3)' }}>{s.n}</span>
              <span style={{ ...CAPS, color: on ? 'var(--text)' : 'var(--text2)' }}>{s.label}</span>
              <span style={{ flex: 1 }} />
              <span style={{ ...MONO, fontSize: 20, fontWeight: 700, lineHeight: 1 }}>
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

// ─── table frame ─────────────────────────────────────────────────────────────
const PENDING_COLS: ReadonlyArray<[string, CSSProperties?]> = [
  ['GRN / JC No.'],
  ['Part / Item Code'],
  ['Vendor · GRN / SO · Op'],
  ['Qty', { textAlign: 'center' }],
  ['Called'],
  ['Stage'],
  ['', { textAlign: 'right' }],
];
const COMPLETED_COLS: ReadonlyArray<[string, CSSProperties?]> = [
  ['GRN / JC No.'],
  ['Part / Item Code'],
  ['Vendor · GRN / SO · Op'],
  ['OK', { textAlign: 'center' }],
  ['Rej', { textAlign: 'center' }],
  ['Called → Attended'],
  ['Inspector · Log Ref'],
  ['Verdict', { textAlign: 'right' }],
];
export const PENDING_COL_COUNT = PENDING_COLS.length;

export function QcSheetTable(props: {
  view: QcView;
  children: ReactNode;
  empty: ReactNode | null;
}): React.JSX.Element {
  const cols = props.view === 'pending' ? PENDING_COLS : COMPLETED_COLS;
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--bg2)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {cols.map(([label, st], i) => (
              <th key={i} style={{ ...TH, ...st }}>
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
    <td style={{ ...TD, ...NOWRAP, textAlign: 'center' }}>
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
  return (
    <td style={{ ...TD, ...NOWRAP }}>
      <div style={{ ...MONO, fontSize: 12 }}>
        {called ? fmtDate(called) : '—'} → {attended ? fmtDate(attended) : '—'}
      </div>
      {resp ? <div style={QUIET}>{resp}</div> : null}
    </td>
  );
}

function InspectorCell(props: {
  name: string | null;
  ref: string | null;
  remarks: string | null;
}): React.JSX.Element {
  return (
    <td style={TD}>
      <div style={TRUNC} title={props.name ?? undefined}>
        {props.name ?? '—'}
      </div>
      <div style={{ ...QUIET, ...TRUNC }} title={props.remarks ?? undefined}>
        {props.ref ? <span style={MONO}>{props.ref}</span> : null}
        {props.ref && props.remarks ? ' · ' : ''}
        {props.remarks ?? ''}
      </div>
    </td>
  );
}

type Verdict = 'ACCEPTED' | 'PARTIAL' | 'REJECTED';

function VerdictCell(props: {
  verdict: Verdict;
  reportPath: string | null;
  reportName: string | null;
}): React.JSX.Element {
  const red = props.verdict !== 'ACCEPTED';
  return (
    <td style={{ ...TD, ...NOWRAP, textAlign: 'right' }}>
      {props.reportPath ? (
        <span style={{ marginRight: 8 }} onClick={(e) => e.stopPropagation()}>
          <QcReportLink path={props.reportPath} name={props.reportName} label="📎" />
        </span>
      ) : null}
      <span
        style={{
          ...CAPS,
          display: 'inline-block',
          padding: '3px 10px',
          borderRadius: 4,
          border: `1px solid ${red ? 'var(--red)' : 'var(--border2)'}`,
          color: red ? 'var(--red)' : 'var(--text2)',
        }}
      >
        {props.verdict}
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
      <InspectorCell name={l.inspector} ref={l.logNo} remarks={l.remarks} />
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
      <InspectorCell name={l.qcInspectedBy} ref={null} remarks={l.qcRemarks} />
      <VerdictCell verdict={verdict} reportPath={l.qcReportPath} reportName={l.qcReportName} />
    </tr>
  );
}

// ─── pending row (collapsed line + expanded form slot) ───────────────────────
export function PendingSheetRow(props: {
  /** The document number cell — a Link is fine; clicks inside it don't toggle. */
  code: ReactNode;
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
  open: boolean;
  onToggle: () => void;
  /** Extra className for the collapsed line (the overdue blink). */
  className?: string | undefined;
  /** The expanded entry form; rendered under the line when `open`. */
  children?: ReactNode;
}): React.JSX.Element {
  const stage = QC_STAGES.find((s) => s.key === props.stage);
  const wait =
    props.waitDays == null
      ? null
      : props.waitDays <= 0
        ? 'Today'
        : `${props.waitDays} day${props.waitDays > 1 ? 's' : ''} waiting`;
  return (
    <>
      <tr
        className={props.className}
        style={props.children ? ROW_CLICK : undefined}
        aria-expanded={props.children ? props.open : undefined}
        onClick={props.children ? props.onToggle : undefined}
      >
        <td style={{ ...TD, ...NOWRAP }} onClick={(e) => e.stopPropagation()}>
          <span style={{ ...MONO_STRONG, fontSize: 12 }}>{props.code}</span>
        </td>
        <PartCell name={props.partName} code={props.itemCode} />
        <ContextCell line1={props.context} line2={props.contextLine2} />
        <NumCell value={props.qty} />
        <td style={{ ...TD, ...NOWRAP }}>
          <div style={{ ...MONO, fontSize: 12 }}>
            {props.calledDate ? fmtDate(props.calledDate) : '—'}
          </div>
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
        <td style={{ ...TD, ...NOWRAP, textAlign: 'right' }}>
          {/* No form to open (viewer without `entry`) → say so instead of
              offering an "Inspect ▸" that expands nothing. */}
          {props.children ? (
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--cyan)' }}>
              {props.open ? 'Close ▾' : 'Inspect ▸'}
            </span>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>View only</span>
          )}
        </td>
      </tr>
      {props.open && props.children ? (
        <tr>
          <td colSpan={PENDING_COL_COUNT} style={{ ...TD, padding: 0 }}>
            {props.children}
          </td>
        </tr>
      ) : null}
    </>
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
