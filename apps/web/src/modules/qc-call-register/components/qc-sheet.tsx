// QC Call Register — shared stage model + the pending-call row drawn on the old
// ruled sheet. Since the register moved onto the shared FIT table (ADR-199), the
// table frame and the completed-row shapes that lived here are gone; what remains
// is the stage vocabulary (QC_STAGES / processStage / QcStage / QcView /
// StageStat), the day-diff helper, and `PendingSheetRow` — still used by the
// incoming-qc module's IncomingPendingRow. Presentational only.

import type { CSSProperties, ReactNode } from 'react';
import { fmtDate } from '@/lib/date';

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
// Small bold caption, Title Case as written (no ALL-CAPS).
const CAPTION: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--text2)',
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
              <span style={{ ...CAPTION, color: on ? 'var(--blue)' : 'var(--text2)' }}>
                {s.label}
              </span>
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
              <span style={QUIET}>{st.pcsPending} pcs QC Pending</span>
              <span style={QUIET}>
                {st.done}
                {st.doneCapped ? '+' : ''} completed
              </span>
            </div>
          </button>
        );
      })}
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

const ROW_CLICK: CSSProperties = { cursor: 'pointer' };

// ─── pending row (one line; click opens the entry popup) ─────────────────────
// Still drawn by the incoming-qc module's IncomingPendingRow inside its own
// <table> there; the QC Call Register itself now uses the shared FIT table.
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
  /** Whether the caller may record an inspection. False → the line does not
   *  open anything and its Action cell is a dash. */
  canInspect: boolean;
  /** False when the table dropped its Action column (viewer can inspect
   *  nothing) — the row then draws no Action cell. Defaults to true. */
  showAction?: boolean | undefined;
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
        : `${props.waitDays} day${props.waitDays > 1 ? 's' : ''}`;
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
        <span style={CAPTION}>{stage?.label}</span>
      </td>
      {props.showAction === false ? null : (
        <td style={{ ...TD, ...NOWRAP }}>
          {/* No form to open (viewer without `entry` for this kind of call) →
              a dash instead of an "Inspect ▸" that opens nothing. */}
          {props.canInspect ? (
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--cyan)' }}>Inspect ▸</span>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>—</span>
          )}
        </td>
      )}
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
