// The Line Items table of New Party GRN (routes/create.tsx): one row per open
// JWSO line, with its Customer RM, the server's Pending cap and the typed
// Received Qty. Greyed rows cannot be received; the reason sits in their cells.

import { LINE_REMARKS_MAX, type JobWorkOrderDetail } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { itemCodeWithRev } from '@/lib/item-code';

/** What the user typed per JWSO line, keyed by the line id. */
export type LineEntry = { receivedQty: string; remarks: string };

type JwLine = JobWorkOrderDetail['lines'][number];

export function PartyGrnReceiveLines({
  jwId,
  loading,
  loadError,
  jwCode,
  nothingToReceive,
  allDeleted,
  lines,
  entries,
  canReceive,
  waitingOf,
  pendingOf,
  setEntry,
  onDeleteLine,
}: {
  jwId: string | null;
  loading: boolean;
  /** The JWSO load's failure message, or null. */
  loadError: string | null;
  /** The picked JWSO's number once its detail has loaded. */
  jwCode: string | null;
  nothingToReceive: boolean;
  allDeleted: boolean;
  /** The lines still on this challan. */
  lines: JwLine[];
  entries: Record<string, LineEntry>;
  canReceive: (l: JwLine) => boolean;
  waitingOf: (lineId: string) => number;
  pendingOf: (l: JwLine) => number;
  setEntry: (lineId: string, patch: Partial<LineEntry>) => void;
  onDeleteLine: (lineId: string) => void;
}): React.JSX.Element {
  const message = (body: React.ReactNode, color?: string): React.JSX.Element => (
    <tr>
      <td colSpan={12} className="empty-state" style={{ padding: 14, ...(color ? { color } : {}) }}>
        {body}
      </td>
    </tr>
  );

  return (
    <div className="tbl-wrap">
      <table className="innovic-table">
        <thead>
          <tr>
            <th className="th-num">Ln</th>
            <th style={{ color: 'var(--purple)' }}>POL</th>
            <th>Item Code</th>
            <th>Item Name</th>
            <th>Customer RM</th>
            <th className="th-num">Order Qty</th>
            <th className="th-num">Accepted</th>
            <th className="th-num">Waiting QC</th>
            <th className="th-num">Pending</th>
            <th className="th-num">
              Received Qty <span className="req">★</span>
            </th>
            <th>Remarks</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {!jwId ? (
            message('Select Client PO No. / JWSO No.')
          ) : loading ? (
            message(
              <>
                <Loader2 size={13} className="inline animate-spin" /> Loading lines…
              </>,
            )
          ) : loadError ? (
            message(loadError, 'var(--red2)')
          ) : (
            <>
              {nothingToReceive && jwCode
                ? message(
                    <>
                      Nothing left to receive on {jwCode}. All customer material is received or
                      waiting QC.
                    </>,
                  )
                : null}
              {allDeleted ? message('All lines deleted — use Restore deleted lines.') : null}
              {lines.map((l) => {
                const noRm = !l.partyMaterialId;
                const receivable = canReceive(l);
                const e = entries[l.id];
                return (
                  <tr key={l.id} style={receivable ? undefined : { opacity: 0.55 }}>
                    <td className="td-num mono">{l.lineNo}</td>
                    <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                      {l.clientPoLineNo ?? '—'}
                    </td>
                    <td>
                      <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                        {itemCodeWithRev(l.itemCodeText, l.revision)}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'normal' }}>{l.partName.trim() || '—'}</td>
                    <td>
                      {noRm ? (
                        <span className="text3" style={{ fontSize: 11 }}>
                          No customer RM — save the JWSO first
                        </span>
                      ) : (
                        <span
                          className="mono fw-700"
                          style={{ color: 'var(--text)' }}
                          title={l.partyMaterialCode ?? ''}
                        >
                          {l.rmItemCode ?? l.partyMaterialCode ?? '—'}
                        </span>
                      )}
                    </td>
                    <td className="td-num mono">
                      {l.orderQty} {l.uom}
                    </td>
                    <td className="td-num mono">{l.rmAcceptedQty}</td>
                    <td className="td-num mono">{waitingOf(l.id)}</td>
                    <td className="td-num mono fw-700">{pendingOf(l)}</td>
                    <td className="td-num">
                      {receivable ? (
                        <input
                          type="number"
                          min={1}
                          step={1}
                          max={pendingOf(l)}
                          className="innovic-input"
                          aria-label={`Received Qty, line ${l.lineNo}`}
                          value={e?.receivedQty ?? ''}
                          onChange={(ev) => setEntry(l.id, { receivedQty: ev.target.value })}
                          placeholder="—"
                          style={{ maxWidth: '12ch' }}
                        />
                      ) : noRm ? (
                        '—'
                      ) : (
                        <span className="text3" style={{ fontSize: 11 }}>
                          {waitingOf(l.id) > 0 ? 'Waiting QC' : 'Fully received'}
                        </span>
                      )}
                    </td>
                    <td>
                      {receivable ? (
                        <input
                          type="text"
                          className="innovic-input"
                          aria-label={`Remarks, line ${l.lineNo}`}
                          autoComplete="off"
                          placeholder="Remarks"
                          maxLength={LINE_REMARKS_MAX}
                          title={e?.remarks || undefined}
                          value={e?.remarks ?? ''}
                          onChange={(ev) => setEntry(l.id, { remarks: ev.target.value })}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {receivable ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm red"
                          onClick={() => onDeleteLine(l.id)}
                          aria-label={`Remove line ${l.lineNo}`}
                        >
                          Delete
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
