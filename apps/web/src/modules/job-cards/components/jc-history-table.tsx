// Job Card detail — the History tab body (owner-approved mock-up
// jobcard-detail-mockup.html, frame 2; decision #8: "History floor feed
// becomes a table, and Document changes moves behind a toggle").
//
//   [ Floor entries (n) | Document changes (n) ]   Ops, NCs, OSP — newest first
//   ┌ .tbl-wrap ───────────────────────────────────────────────────────────┐
//   │ Log Date · Log Time · Op · Action · Machine · User / Operator ·      │
//   │ Shift · Activity Qty · Detail                                        │
//   └──────────────────────────────────────────────────────────────────────┘
//   Showing latest N of M entries
//
// Floor entries = the same server-merged completion log the old icon feed
// read (op_log ∪ NC ∪ NC disposition ∪ OSP activity), same events, same
// order (the server sorts latest-first), same texts — only split into
// columns. Machine, Operator and Shift move out of the one joined detail line
// into their own columns; the emoji icons become the Action word in colour.
// A negative op_log row is a reversal and reads "… Reversed" with a red minus
// figure, never "Completed" with a minus number.
//
// Document changes = today's <DocumentHistory> for the JobCard (ADR-197),
// unchanged.
//
// Data: the SAME queries the page already runs — useJobCard (for the code the
// history query is keyed on), useJobCardStatusExtras (the completion log) and
// useDocumentHistory (via DocumentHistory and for the toggle count). No new
// endpoint; every hook shares its cache entry with the rest of the page.
//
// Returns a fragment so `.tbl-wrap` is a direct child of a `<Panel fill>`
// body (the "LIST FILL" chain in innovic-theme.css), as po-close-ledger does.
import type { JobCardCompletionEvent } from '@innovic/shared';
import {
  fmtOpSrNo,
  NC_DISPOSITION_LABELS,
  NC_REASON_CATEGORY_LABELS,
  SHIFT_LABELS,
} from '@innovic/shared';
import { useMemo, useState } from 'react';
import { DocumentHistory } from '@/components/shared/document-history';
import { useDocumentHistory } from '@/modules/activity-log/api';
import { useJobCard, useJobCardStatusExtras } from '../api';
import { fmtJcDate } from '../lib/fmt-jc-date';

type View = 'floor' | 'doc';

/** Badge class per action — the old feed's icon colours, as existing badges:
 *  completed green, started orange (was --amber), QC blue, reversal red,
 *  NC orange, OSP purple. A disposition keeps its old per-decision colour. */
const DISPOSITION_BADGE: Record<string, string> = {
  rework: 'b-cyan',
  scrap: 'b-red',
  use_as_is: 'b-green',
  return_to_vendor: 'b-purple',
  make_fresh: 'b-purple',
};

// Codes on the feed (shift, disposition, NC reason) read through the shared
// label maps; an unknown code falls back to itself.
function labelOf(map: Record<string, string>, code: string): string {
  return map[code] ?? code;
}

type QtyKind = 'none' | 'plus' | 'minus';

interface HistoryRow {
  id: string;
  date: string;
  time: string | null;
  opNo: string;
  operation: string;
  action: string;
  badge: string;
  machine: string;
  user: string;
  shift: string;
  qtyKind: QtyKind;
  /** Always the absolute figure; the sign comes from `qtyKind`. */
  qty: number;
  detail: string;
  remarks: string;
}

const opNoOf = (seq: number | null): string => (seq != null ? fmtOpSrNo(seq) : '');

/** One completion-log event → one table row. Texts follow the old feed's
 *  mapEvent (jc-view-tabs.tsx) word for word; only the layout changes. */
function toRow(e: JobCardCompletionEvent): HistoryRow {
  const base = {
    id: e.id,
    date: e.date,
    time: e.time,
    opNo: opNoOf(e.opSeq),
    operation: '',
    machine: '',
    user: '',
    shift: '',
    remarks: '',
  };

  if (e.kind === 'op') {
    // A reversal (POST /op-entry/op-log/:id/reverse) is an opposite op_log row:
    // negative qty / reject qty, same logType as the entry it cancels.
    const reversal = e.logType !== 'start' && ((e.qty ?? 0) < 0 || (e.rejectQty ?? 0) < 0);
    const action = reversal
      ? e.logType === 'qc'
        ? 'QC Entry Reversed'
        : 'Completion Reversed'
      : e.logType === 'start'
        ? 'Started'
        : e.logType === 'qc'
          ? 'QC Entry'
          : 'Completed';
    // ADR-164 — machineCode is the machine ACTUALLY used; plannedMachineCode is
    // the op's plan. Name the plan only when the two differ.
    const planned = e.plannedMachineCode?.trim() ?? '';
    const machine =
      e.machineCode && planned && planned.toLowerCase() !== e.machineCode.trim().toLowerCase()
        ? `${e.machineCode} (planned ${planned})`
        : (e.machineCode ?? '');
    const qty = e.qty ?? 0;
    return {
      ...base,
      operation: e.operation ?? '',
      action,
      badge: reversal
        ? 'b-red'
        : e.logType === 'start'
          ? 'b-amber'
          : e.logType === 'qc'
            ? 'b-blue'
            : 'b-green',
      machine,
      user: e.operatorName ?? '',
      shift: e.shift ? labelOf(SHIFT_LABELS, e.shift) : '',
      qtyKind: e.logType === 'start' ? 'none' : reversal || qty < 0 ? 'minus' : 'plus',
      qty: Math.abs(qty),
      detail: e.logType === 'qc' && (e.rejectQty ?? 0) !== 0 ? `${e.rejectQty} deviated` : '',
      remarks: e.remarks ?? '',
    };
  }

  if (e.kind === 'nc') {
    const category = e.reasonCategory ? labelOf(NC_REASON_CATEGORY_LABELS, e.reasonCategory) : 'NC';
    return {
      ...base,
      action: e.ncNo ?? 'NC',
      badge: 'b-orange',
      user: e.operatorText ?? '',
      qtyKind: 'minus',
      qty: Math.abs(e.rejectedQty ?? 0),
      detail:
        [category, `${e.rejectedQty ?? 0} pcs deviated`, e.reason ?? '']
          .filter(Boolean)
          .join(' — ') +
        (e.disposition ? ` • Disposition: ${labelOf(NC_DISPOSITION_LABELS, e.disposition)}` : ''),
    };
  }

  if (e.kind === 'nc-disposition') {
    return {
      ...base,
      action: `NC Disposed: ${e.disposition ? labelOf(NC_DISPOSITION_LABELS, e.disposition) : ''}`,
      badge: DISPOSITION_BADGE[e.disposition ?? ''] ?? 'b-purple',
      user: e.dispositionBy ?? '',
      qtyKind: 'none',
      qty: 0,
      detail:
        `${e.ncNo ?? 'NC'} — ${e.rejectedQty ?? 0} pcs` +
        (e.disposition === 'rework'
          ? ` → back to Op ${e.reworkOpSeq != null ? fmtOpSrNo(e.reworkOpSeq) : '?'}`
          : ''),
    };
  }

  // osp — a Purchase Request / Purchase Order activity line naming this card.
  return {
    ...base,
    action: e.ospCategory ?? 'OSP',
    badge: 'b-purple',
    qtyKind: 'none',
    qty: 0,
    detail: e.detail ?? '',
  };
}

const DASH = <span className="text3">—</span>;

export function JcHistoryTable({ jobCardId }: { jobCardId: string }): React.JSX.Element {
  const [view, setView] = useState<View>('floor');
  const { data: jc } = useJobCard(jobCardId);
  const { data: extras, isLoading: extrasLoading } = useJobCardStatusExtras(jobCardId);
  // Keyed exactly as <DocumentHistory entity entityId refId> keys it, so the
  // count and the table share one request. Held back until the card's code is
  // known, so a cold load never fires a second, code-less request.
  const { data: history } = useDocumentHistory({
    entity: 'JobCard',
    entityId: jc ? jobCardId : null,
    refId: jc?.code ?? null,
  });

  const log = extras?.completionLog;
  const feed = useMemo(() => {
    const rows = (log?.events ?? []).map(toRow);
    return {
      rows,
      shown: rows.length,
      total: log?.total ?? rows.length,
      truncated: log?.truncated ?? false,
    };
  }, [log]);
  const docCount = history?.rows.length ?? 0;

  const toggle = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-3)',
        flexWrap: 'wrap',
        marginBottom: 'var(--sp-2)',
      }}
    >
      <div role="group" aria-label="History view" style={{ display: 'flex', gap: 'var(--sp-1)' }}>
        <button
          type="button"
          className={`btn btn-sm ${view === 'floor' ? 'btn-primary' : 'btn-ghost'}`}
          aria-pressed={view === 'floor'}
          onClick={() => setView('floor')}
        >
          Floor entries ({feed.total})
        </button>
        <button
          type="button"
          className={`btn btn-sm ${view === 'doc' ? 'btn-primary' : 'btn-ghost'}`}
          aria-pressed={view === 'doc'}
          onClick={() => setView('doc')}
        >
          Document changes ({docCount})
        </button>
      </div>
      {view === 'floor' ? (
        <span className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
          Ops, NCs, OSP — newest first
        </span>
      ) : null}
    </div>
  );

  if (view === 'doc') {
    return (
      <>
        {toggle}
        {jc ? (
          <DocumentHistory entity="JobCard" entityId={jobCardId} refId={jc.code} />
        ) : (
          <div className="empty-state" style={{ padding: 16 }}>
            Loading…
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {toggle}
      <div className="tbl-wrap">
        <table className="innovic-table">
          <thead>
            <tr>
              <th>Log Date</th>
              <th>Log Time</th>
              <th>Op</th>
              <th>Action</th>
              <th>Machine</th>
              <th>User / Operator</th>
              <th>Shift</th>
              <th className="th-num">Activity Qty</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {feed.rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty-state" style={{ padding: 16 }}>
                  {extrasLoading ? 'Loading…' : 'No entries yet.'}
                </td>
              </tr>
            ) : (
              feed.rows.map((r) => {
                const opTitle = r.opNo
                  ? `Op ${r.opNo}${r.operation ? `: ${r.operation}` : ''}`
                  : undefined;
                const detailTitle = [r.detail, r.remarks].filter(Boolean).join(' • ');
                return (
                  <tr key={r.id}>
                    <td className="mono">{r.date ? fmtJcDate(r.date) : DASH}</td>
                    <td className="mono">{r.time ?? DASH}</td>
                    <td title={opTitle}>
                      {r.opNo ? (
                        <>
                          <span className="mono fw-700">{r.opNo}</span>
                          {r.operation ? (
                            <span
                              className="text2"
                              style={{
                                display: 'inline-block',
                                maxWidth: 160,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                verticalAlign: 'bottom',
                                marginLeft: 6,
                              }}
                            >
                              {r.operation}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        DASH
                      )}
                    </td>
                    <td>
                      <span className={`badge ${r.badge}`}>{r.action}</span>
                    </td>
                    <td className="mono">{r.machine || DASH}</td>
                    <td>{r.user || DASH}</td>
                    <td>{r.shift || DASH}</td>
                    <td className="mono fw-700 td-num">
                      {r.qtyKind === 'none' ? (
                        DASH
                      ) : r.qtyKind === 'minus' ? (
                        <span style={{ color: 'var(--red2)' }}>
                          {r.qty === 0 ? '0' : `−${r.qty}`}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--green2)' }}>+{r.qty}</span>
                      )}
                    </td>
                    <td
                      title={detailTitle || undefined}
                      style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }}
                    >
                      {r.detail || r.remarks ? (
                        <span className="text2">
                          {r.detail}
                          {r.remarks ? (
                            <>
                              {r.detail ? ' • ' : ''}
                              <i>{r.remarks}</i>
                            </>
                          ) : null}
                        </span>
                      ) : (
                        DASH
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="text3" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-1)' }}>
        {feed.truncated
          ? `Showing latest ${feed.shown} of ${feed.total} entries`
          : `${feed.total} entries`}
      </div>
    </>
  );
}
