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
import { XCircle } from 'lucide-react';

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
          fontSize: 9,
          color: 'var(--text3)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
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
              style={{ fontSize: 10 }}
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
            <span className="text2">{g.grnDate}</span>
            <span>·</span>
            <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{g.jwCodeText ?? '—'}</span>
            <span>·</span>
            <span>
              PO <span className="text2">{g.clientPoNo ?? '—'}</span>
            </span>
            <span>·</span>
            <span>
              DC <span className="text2">{g.dcNo ?? '—'}</span>
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
      </div>
    </div>
  );
}
