// One OSP Outward DC = one SO-Master-style card. Replaces the 8-column table
// (DC No. | Date | PO | Vendor | SO | Sent | Status | Action). Only 8 columns,
// but `.innovic-table td` is `white-space: nowrap` and two of them — Vendor and
// SO — are unbounded server text with no max-width and no ellipsis, so one long
// vendor name pushed the whole table sideways, and with no `tbl-frozen` the DC
// No. went with it. Same bands as sales-orders/routes/list.tsx, the Dispatch
// port (ADR-118) and pr-card.tsx (ADR-120).
//
// Nothing about the data or the actions changed: every column the table showed
// is still on the card, the linked-PO vs snapshot-PO chip keeps its green/amber
// meaning and both tooltips, and + Receive stays gated on status === 'issued'.

import type { DeliveryChallanListItem } from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { DcStatusBadge } from './dc-status-badge';

/** Accent bar: amber still out at the vendor, green once it has come back,
 *  grey cancelled — the same meaning DcStatusBadge carries. */
function accentFor(status: DeliveryChallanListItem['status']): string {
  if (status === 'received') return 'var(--green)';
  if (status === 'cancelled') return 'var(--text3)';
  return 'var(--amber)';
}

/** One cell of the card's metric strip — big number over a small caps label,
 *  identical to the SO/WO, JWSO, Dispatch and PR cards. */
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

/** The PO this DC was issued against. Green = a real FK to a purchase order;
 *  amber + a trailing `*` = only the issue-time text snapshot, which will
 *  mismatch if that PO is ever renumbered. Both tooltips are the originals. */
function PoChip({ dc }: { dc: DeliveryChallanListItem }): React.JSX.Element {
  if (dc.poCode) {
    return (
      <span className="badge b-green" title={`Linked PO ${dc.poCode}`} style={{ fontSize: 11 }}>
        {dc.poCode}
      </span>
    );
  }
  if (dc.poCodeText) {
    return (
      <span
        className="badge b-amber"
        title="Snapshot text — no PO linked. Will mismatch if the PO is renumbered."
        style={{ fontSize: 11 }}
      >
        {dc.poCodeText}*
      </span>
    );
  }
  return <span className="text3">—</span>;
}

export function DcCard({ dc }: { dc: DeliveryChallanListItem }): React.JSX.Element {
  const navigate = useNavigate();
  const openDetail = (): void => {
    void navigate({ to: '/delivery-challans/$id', params: { id: dc.id } });
  };

  return (
    <div
      className="panel"
      style={{ display: 'flex', overflow: 'hidden', padding: 0, marginBottom: 10 }}
    >
      <div style={{ width: 4, flexShrink: 0, background: accentFor(dc.status) }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* ── Band 1: identity + vendor + PO + status — actions ── */}
        <div
          onClick={openDetail}
          title="Open this delivery challan"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            padding: '10px 14px',
            cursor: 'pointer',
          }}
        >
          <Link
            to="/delivery-challans/$id"
            params={{ id: dc.id }}
            className="td-code"
            style={{ color: 'var(--blue)', fontWeight: 800, fontSize: 13 }}
            onClick={(e) => e.stopPropagation()}
          >
            {dc.code}
          </Link>
          <span className="fw-700" style={{ fontSize: 13 }}>
            {dc.vendorName ?? <span className="text3">{dc.vendorCodeText ?? '—'}</span>}
          </span>
          <PoChip dc={dc} />
          <DcStatusBadge status={dc.status} />
          <span style={{ flex: 1 }} />
          {/* Receiving is a different destination from the card's own click, so
              it stops propagation. A partially-received DC stays `issued`, which
              is why the gate is on the status and not on a received quantity. */}
          <div
            style={{
              display: 'flex',
              gap: 4,
              alignItems: 'center',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              minWidth: 0,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {dc.status === 'issued' ? (
              <Link
                to="/delivery-challans/$id/receive"
                params={{ id: dc.id }}
                className="btn btn-success btn-sm"
                style={{ fontSize: 10 }}
                title="Receive material back from the vendor"
              >
                + Receive
              </Link>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 10 }}
                disabled
                title={
                  dc.status === 'received'
                    ? 'Already received back in full'
                    : 'This DC was cancelled'
                }
              >
                + Receive
              </button>
            )}
          </div>
        </div>

        {/* ── Band 2: metric boxes + meta line ── */}
        <div
          onClick={openDetail}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            padding: '0 14px 10px',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6 }}>
            <QtyBox label="Sent" value={Number(dc.totalQty).toFixed(2)} />
            {/* lineCount was already fetched and already printed on the register
                (lib/print-dispatch-register.ts) but never shown on screen. */}
            <QtyBox label="Lines" value={dc.lineCount} bordered />
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
            }}
          >
            <span className="text2">{dc.dcDate}</span>
            <span>·</span>
            <span>
              SO <span className="text2">{dc.soCode ?? dc.soRefText ?? '—'}</span>
            </span>
            {dc.transport ? (
              <>
                <span>·</span>
                <span className="text2">{dc.transport}</span>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
