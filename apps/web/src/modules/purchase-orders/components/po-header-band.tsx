// PO detail header — one four-column band: SUPPLIER | ORDER REFERENCES |
// TOTALS | TAX & APPROVAL, separated by hairline rules, under an accent bar
// coloured by status.
//
// Replaces three stacked blocks that each re-stated the same header (a 2-up
// "Vendor / PO Details" box pair with its own borders + grey fill, a 6-up row of
// bordered KPI tiles, then a loose wrapped strip of label/value pairs) — ~3
// screens' worth of chrome for one page of facts, each block with a different
// border, fill, alignment and value size.
//
// PRESENTATION ONLY. Same fields, same values, same sources — nothing is
// computed, fetched or formatted differently here; the blocks were merged and
// restyled. Every colour is a token (no hard-coded hex), and the type scale is
// the app's: 10px uppercase captions, 11px muted labels, 12–13px values, mono
// for codes and money.

import type { PurchaseOrderDetail, Vendor } from '@innovic/shared';

/** Accent bar — the same reading the status badge already gives: green closed,
 *  red cancelled, amber part-received / awaiting QC, grey draft, blue open. */
function accentFor(status: PurchaseOrderDetail['status']): string {
  if (status === 'closed') return 'var(--green)';
  if (status === 'cancelled') return 'var(--red)';
  if (status === 'partial' || status === 'qc_pending') return 'var(--amber)';
  if (status === 'draft') return 'var(--text3)';
  return 'var(--blue)';
}

const CAPTION: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--text3)',
  marginBottom: 8,
};

/** One column of the band.
 *
 *  The dividers are NOT per-column borders: a 1px `var(--border)` left border
 *  read as nothing against the white panel, and it only ran as tall as its own
 *  column. Instead the grid carries a 1px gap over a `--border2` background and
 *  each column paints itself `--bg2` — so the gap IS the divider: always the
 *  full height of the tallest column, and one shade stronger. */
function Col({
  caption,
  children,
}: {
  caption: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div style={{ padding: '12px 16px', minWidth: 0, background: 'var(--bg2)' }}>
      <div style={CAPTION}>{caption}</div>
      {children}
    </div>
  );
}

/** Label left, value right — the shape used by the reference and TOTALS columns.
 *  `align` right-aligns the value for money/qty columns. */
function Row({
  label,
  value,
  align = 'left',
}: {
  label: string;
  value: React.ReactNode;
  align?: 'left' | 'right';
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: align === 'right' ? 'space-between' : 'flex-start',
        gap: 10,
        marginBottom: 5,
        fontSize: 12,
      }}
    >
      <span className="text3" style={{ flexShrink: 0, minWidth: align === 'right' ? 0 : 96 }}>
        {label}
      </span>
      <span style={{ fontWeight: 700, textAlign: align, minWidth: 0 }}>{value}</span>
    </div>
  );
}

export function PoHeaderBand({
  detail,
  vendor,
  totalQty,
  receivedQty,
}: {
  detail: PurchaseOrderDetail;
  vendor: Vendor | null | undefined;
  totalQty: number;
  receivedQty: number;
}): React.JSX.Element {
  const address = [vendor?.addressLine1, vendor?.city, vendor?.state].filter(Boolean).join(', ');
  const rejected = Boolean(detail.rejectedAt ?? detail.rejectedBy ?? detail.rejectionReason);

  return (
    <div style={{ display: 'flex', alignItems: 'stretch' }}>
      <div style={{ width: 4, flexShrink: 0, background: accentFor(detail.status) }} />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'grid',
          gridTemplateColumns:
            'minmax(200px, 1.2fr) minmax(200px, 1.3fr) minmax(170px, 0.9fr) minmax(220px, 1.4fr)',
          // 1px gap over a border-coloured ground = the vertical dividers.
          // `--border3` (the darkest of the three border depths) — `--border2`
          // still read as too faint against the white columns.
          gap: 1,
          background: 'var(--border3)',
        }}
      >
        {/* ── Supplier ── */}
        <Col caption="Supplier">
          {detail.vendorCodeText ? (
            <div
              className="mono fw-700"
              style={{ color: 'var(--purple)', fontSize: 13, marginBottom: 2 }}
            >
              {detail.vendorCodeText}
            </div>
          ) : null}
          <div className="fw-700" style={{ fontSize: 14, marginBottom: 4 }}>
            {detail.vendorName ?? detail.vendorCodeText ?? '—'}
          </div>
          {address ? (
            <div className="text3" style={{ fontSize: 11, marginBottom: 4 }}>
              {address}
            </div>
          ) : null}
          {vendor?.gstNumber ? (
            <div style={{ fontSize: 11 }}>
              <span className="text3">GSTIN/UIN </span>
              <span className="mono fw-700">{vendor.gstNumber}</span>
            </div>
          ) : null}
          {vendor?.contactPerson ? (
            <div style={{ fontSize: 11, marginTop: 2 }}>
              <span className="text3">Contact </span>
              <span className="fw-700">{vendor.contactPerson}</span>
            </div>
          ) : null}
        </Col>

        {/* ── Order references ── */}
        <Col caption="Order References">
          <Row
            label="PO No."
            value={
              <span className="mono" style={{ color: 'var(--blue)', fontSize: 13 }}>
                {detail.code}
              </span>
            }
          />
          <Row label="PO Type" value={detail.poType.replaceAll('_', ' ')} />
          <Row label="Date" value={<span className="mono">{detail.poDate}</span>} />
          <Row
            label="PR"
            value={
              detail.prCodeText ? (
                <span className="mono" style={{ color: 'var(--purple)' }}>
                  {detail.prCodeText}
                </span>
              ) : (
                <span className="text3">—</span>
              )
            }
          />
        </Col>

        {/* ── Totals ── */}
        <Col caption="Totals">
          <Row label="Lines" value={<span className="mono">{detail.lines.length}</span>} align="right" />
          <Row label="Total qty" value={<span className="mono">{totalQty}</span>} align="right" />
          <Row
            label="Received"
            value={
              <span className="mono" style={{ color: 'var(--green)' }}>
                {receivedQty}
              </span>
            }
            align="right"
          />
          <Row
            label="Subtotal"
            value={<span className="mono">₹{detail.subtotal.toFixed(2)}</span>}
            align="right"
          />
          <Row
            label="Tax"
            value={<span className="mono">₹{detail.taxAmount.toFixed(2)}</span>}
            align="right"
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              gap: 10,
              // Matches the column dividers' weight so the Total rule doesn't
              // read lighter than the lines crossing beside it.
              borderTop: '1px solid var(--border3)',
              paddingTop: 6,
              marginTop: 2,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700 }}>Total</span>
            <span className="mono fw-700" style={{ fontSize: 16, color: 'var(--green)' }}>
              ₹{detail.totalAmount.toFixed(2)}
            </span>
          </div>
        </Col>

        {/* ── Tax & approval ── */}
        <Col caption="Tax & Approval">
          <Row label="Tax type" value={detail.taxType ?? '—'} />
          <Row label="Due date" value={<span className="mono">{detail.dueDate ?? '—'}</span>} />
          <div style={{ fontSize: 11, marginBottom: 6 }}>
            <div className="text3" style={{ marginBottom: 2 }}>
              GST split
            </div>
            <div className="mono">
              <span className="text2">SGST</span> {detail.sgstPct}% ·{' '}
              <span className="text2">CGST</span> {detail.cgstPct}% ·{' '}
              <span className="text2">IGST</span> {detail.igstPct}%
            </div>
          </div>
          {detail.approvedAt ? (
            <Row label="Approved at" value={<span className="mono">{detail.approvedAt}</span>} />
          ) : null}
          {detail.approvalRemarks ? (
            <Row label="Approval note" value={detail.approvalRemarks} />
          ) : null}
          {rejected ? (
            <>
              <Row
                label="Rejected at"
                value={
                  <span className="mono" style={{ color: 'var(--red)' }}>
                    {detail.rejectedAt ?? '—'}
                  </span>
                }
              />
              {detail.rejectionReason ? (
                <Row
                  label="Reason"
                  value={<span style={{ color: 'var(--red)' }}>{detail.rejectionReason}</span>}
                />
              ) : null}
            </>
          ) : null}
          {detail.remarks ? (
            <div style={{ fontSize: 11, marginTop: 6 }}>
              <div className="text3" style={{ marginBottom: 2 }}>
                Remarks
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{detail.remarks}</div>
            </div>
          ) : null}
        </Col>
      </div>
    </div>
  );
}
