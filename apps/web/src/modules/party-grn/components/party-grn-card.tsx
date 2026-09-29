// One Party Material GRN = one SO-Master-style card. Replaces the 11-column
// table (GRN No. | Date | Client | JWSO No. | Client PO | DC No. | Lines |
// Received Qty | Remarks | Received By | Actions). `.innovic-table td` is
// `white-space: nowrap`, and four of those columns held unbounded server text
// with no max-width — Client, Received By, Client PO and DC No. Only Remarks
// was defended with an ellipsis. So one long client name widened the whole
// table, and with no `tbl-frozen` the GRN No. scrolled off the left with it.
//
// Same bands as sales-orders/routes/list.tsx and the Dispatch / DC / PR ports.
// Every column the table showed is still on the card.
//
// The card is NOT clickable and the code is NOT a link: this module has no
// detail route. `GET /party-grn/:id` exists on the API but nothing in the web
// app consumes it, so there is nowhere to navigate to. The code stays --cyan,
// this module's own identity colour, rather than the --blue used elsewhere for
// codes that ARE links — a blue code that does nothing on click reads as broken.

import type { PartyGrnListItem } from '@innovic/shared';
import { ChevronDown, ChevronRight, Loader2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { DocumentHistory } from '@/components/shared/document-history';
import { fmtDate } from '@/lib/date';
import { Panel } from '@/ui/data';
import { usePartyGrnDetail } from '../api';

/** One cell of the card's metric strip — big number over a small caps label,
 *  identical to the SO/WO, JWSO, Dispatch, DC and PR cards. */
function QtyBox({
  label,
  value,
  color,
  bordered,
}: {
  label: string;
  value: React.ReactNode;
  color?: string | undefined;
  bordered?: boolean | undefined;
}): React.JSX.Element {
  return (
    <div
      style={{
        padding: '4px 12px',
        textAlign: 'center',
        minWidth: 58,
        borderLeft: bordered ? '1px solid var(--border)' : undefined,
      }}
    >
      <div
        className="mono fw-700"
        style={{ fontSize: 15, color: color ?? 'var(--text)', lineHeight: 1.2 }}
      >
        {value}
      </div>
      <div
        className="mono"
        style={{
          fontSize: 11,
          color: 'var(--text3)',
        }}
      >
        {label}
      </div>
    </div>
  );
}

export function PartyGrnCard({
  g,
  canWrite,
  onCancel,
}: {
  g: PartyGrnListItem;
  canWrite: boolean;
  onCancel: () => void;
}): React.JSX.Element {
  // The lines (QC split + linked JWSO line) load lazily on expand — the list
  // itself carries only the header aggregates, and there is no detail route.
  const [open, setOpen] = useState(false);
  const detailQ = usePartyGrnDetail(open ? g.id : undefined);
  const lines = detailQ.data?.lines ?? [];

  return (
    <div
      className="panel"
      style={{ display: 'flex', overflow: 'hidden', padding: 0, marginBottom: 10 }}
    >
      {/* Accent bar. A cancelled GRN is soft-deleted and never reaches this
          list, so every card here is a live receipt — green, the app's "done"
          colour and the colour this page already uses for received qty. */}
      <div style={{ width: 4, flexShrink: 0, background: 'var(--green)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* ── Band 1: identity + client — actions ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            padding: '10px 14px',
          }}
        >
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Hide lines' : 'Show lines'}
            aria-expanded={open}
            title={open ? 'Hide lines' : 'Show lines'}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          <span className="td-code" style={{ color: 'var(--cyan)', fontWeight: 800, fontSize: 13 }}>
            {g.code}
          </span>
          <span className="fw-700" style={{ fontSize: 13 }}>
            {g.clientName ?? g.clientCodeText ?? '—'}
          </span>
          <span style={{ flex: 1 }} />
          {canWrite ? (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              style={{ fontSize: 11 }}
              onClick={onCancel}
              title="Cancel this GRN and take the qty back off party stock"
            >
              <XCircle size={12} /> Cancel
            </button>
          ) : null}
        </div>

        {/* ── Band 2: metric boxes + meta line ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            padding: '0 14px 10px',
          }}
        >
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6 }}>
            <QtyBox label="Received" value={g.totalReceivedQty} color="var(--green)" />
            <QtyBox label="Lines" value={g.linesCount} bordered />
          </div>
          <div
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--text3)',
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              flexWrap: 'wrap',
              minWidth: 0,
            }}
          >
            <span className="text2">{fmtDate(g.grnDate)}</span>
            <span>·</span>
            <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{g.jwCodeText ?? '—'}</span>
            <span>·</span>
            <span>
              Client PO No. <span className="text2">{g.clientPoNo ?? '—'}</span>
            </span>
            <span>·</span>
            <span>
              Customer Challan No. <span className="text2">{g.dcNo ?? '—'}</span>
            </span>
            <span>·</span>
            {/* receivedByText is the user's email, so it can be long — clipped
                rather than allowed to widen the card. */}
            <span
              className="text2"
              style={{
                maxWidth: 180,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={g.receivedByText ?? ''}
            >
              {g.receivedByText ?? '—'}
            </span>
            <span>·</span>
            <span
              style={{
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={g.remarks ?? ''}
            >
              {g.remarks ?? '—'}
            </span>
          </div>
        </div>

        {/* ── Band 3 (expand): per-line QC split + the linked JWSO line ── */}
        {open ? (
          <div style={{ borderTop: '1px solid var(--border)', padding: '8px 14px 12px' }}>
            {detailQ.isLoading ? (
              <div className="text3" style={{ fontSize: 12 }}>
                <Loader2 size={13} className="inline animate-spin" /> Loading lines…
              </div>
            ) : detailQ.isError ? (
              <div className="empty-state" style={{ color: 'var(--red2)', padding: 8 }}>
                Could not load lines. Try again.
              </div>
            ) : (
              <div className="tbl-wrap">
                <table className="innovic-table tbl-ctr">
                  <thead>
                    <tr>
                      <th>Ln</th>
                      <th>Material</th>
                      <th>Material Name</th>
                      <th>JWSO Line</th>
                      <th className="th-num" style={{ color: 'var(--green2)' }}>
                        Received
                      </th>
                      <th className="th-num" style={{ color: 'var(--green2)' }}>
                        Accepted
                      </th>
                      <th className="th-num" style={{ color: 'var(--red2)' }}>
                        Rejected
                      </th>
                      <th>Reject Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="empty-state">
                          No lines.
                        </td>
                      </tr>
                    ) : (
                      lines.map((l) => (
                        <tr key={l.id}>
                          <td className="mono">{l.lineNo}</td>
                          <td>
                            <span className="td-code" style={{ color: 'var(--purple)' }}>
                              {l.partyMaterialCodeText}
                            </span>
                          </td>
                          <td
                            className="text2"
                            style={{
                              maxWidth: 220,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={l.partyMaterialName ?? ''}
                          >
                            {l.partyMaterialName ?? '—'}
                          </td>
                          <td className="mono" style={{ color: 'var(--purple)' }}>
                            {l.jwLineNoText ? `L${l.jwLineNoText}` : '—'}
                          </td>
                          <td className="mono td-num">{l.receivedQty}</td>
                          <td className="mono fw-700 td-num" style={{ color: 'var(--green2)' }}>
                            {l.acceptedQty}
                          </td>
                          <td
                            className="mono td-num"
                            style={{ color: l.rejectedQty > 0 ? 'var(--red2)' : 'var(--text3)' }}
                          >
                            {l.rejectedQty > 0 ? l.rejectedQty : '—'}
                          </td>
                          <td className="text3" style={{ fontSize: 11 }}>
                            {l.rejectReason ?? '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {/* ADR-197: this receipt's own History (create + compulsory QC). */}
            <div style={{ marginTop: 10 }}>
              <Panel title="History" bodyPadding="none">
                <DocumentHistory entity="PartyGrn" entityId={g.id} refId={g.code} />
              </Panel>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
