// JW Invoice register columns (ADR-199 fit table, table standard 2026-10-01).
// One line per invoice; the fit engine sizes columns to the screen and drops the
// rightmost unpinned ones into the ▸ detail row (jw-invoice-expand.tsx). Split
// out of jw-invoice-view.tsx to keep that file under the 400-line rule.
//
// Money columns (Taxable, Total) are built only when the viewer may see prices
// (`priceHidden` is false) — told by the server on the list response, never
// inferred from a null money field. Rate / GST% / GST Amt live in the ▸ expand,
// gated the same way.

import type { JwInvoiceListItem } from '@innovic/shared';
import { PLACE_OF_SUPPLY_UNKNOWN_NOTE } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn } from '@/ui/data';

function money(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** The register's columns. `priceHidden` drops the money columns for L1 Viewers,
 *  exactly as the old table did. */
export function jwInvoiceColumns(priceHidden: boolean): DataTableColumn<JwInvoiceListItem>[] {
  const cols: DataTableColumn<JwInvoiceListItem>[] = [
    {
      id: 'invoice_code',
      header: 'Invoice No.',
      kind: 'code',
      nowrap: true,
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span className="td-code" style={{ color: 'var(--cyan)' }}>
            {r.code}
          </span>
          {/* Screen-only note (plan D2, 0186), never printed: a live invoice
              missing its Place of Supply. Full text on hover; the detail sits
              in the ▸ expand. Kept to one glyph so it does not widen the
              fit-engine column. */}
          {r.status !== 'cancelled' && !r.placeOfSupply ? (
            <span
              title={PLACE_OF_SUPPLY_UNKNOWN_NOTE}
              style={{ color: 'var(--amber2)', fontSize: 11 }}
            >
              ⚠
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'invoice_date',
      header: 'Invoice Date',
      kind: 'date',
      className: 'mono text2',
      nowrap: true,
      render: (r) => fmtDate(r.invoiceDate),
    },
    {
      id: 'jwso_code',
      header: 'JWSO No.',
      kind: 'code',
      nowrap: true,
      render: (r) => (
        <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
          {r.jwCodeText ?? '—'}
        </span>
      ),
    },
    {
      id: 'customer',
      header: 'Customer',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (r) => r.clientName ?? '—',
      title: (r) => r.clientName ?? '',
    },
    {
      id: 'item_code',
      header: 'Item Code',
      kind: 'code',
      nowrap: true,
      render: (r) => (
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {itemCodeWithRev(r.itemCode, r.itemRevision)}
        </span>
      ),
    },
    {
      id: 'qty',
      header: 'Invoice Qty',
      kind: 'num',
      align: 'right',
      className: 'mono',
      nowrap: true,
      render: (r) => r.qty,
    },
  ];

  if (!priceHidden) {
    cols.push(
      {
        id: 'taxable',
        header: 'Taxable',
        kind: 'num',
        align: 'right',
        className: 'mono',
        nowrap: true,
        render: (r) => money(r.taxableAmount ?? 0),
      },
      {
        id: 'total',
        header: 'Total',
        kind: 'num',
        align: 'right',
        headColor: 'var(--green)',
        nowrap: true,
        render: (r) => (
          <span className="mono fw-700" style={{ color: 'var(--green2)' }}>
            {money(r.totalAmount ?? 0)}
          </span>
        ),
      },
    );
  }

  cols.push({
    id: 'status',
    header: 'Invoice Status',
    kind: 'badge',
    render: (r) => (
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          padding: '2px 6px',
          borderRadius: 4,
          whiteSpace: 'nowrap',
          color: r.status === 'cancelled' ? 'var(--red2)' : 'var(--green2)',
          background: r.status === 'cancelled' ? 'rgba(239,68,68,0.10)' : 'rgba(34,197,94,0.10)',
        }}
        title={
          r.status === 'cancelled' && r.cancelReason ? `Cancelled: ${r.cancelReason}` : undefined
        }
      >
        {r.status === 'cancelled' ? 'Cancelled' : 'Issued'}
      </span>
    ),
  });

  return cols;
}
