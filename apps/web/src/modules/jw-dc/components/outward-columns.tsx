// Outward Register columns (ADR-199 fit table) — ONE ROW PER DC LINE (ADR-261).
// The six lead columns come first and are locked (SO No. · Internal SO No. ·
// POL · Created On · Item Code · Item Name); SO No. shows the SO code, else the
// JWSO code, and Internal SO No. only for an SO. Then DC No. · DC Date · PO No.
// · Vendor · Sent · Received · Pending · DC Status — all for THIS line, except
// DC No. / Date / PO / Vendor which are the challan's. Vehicle / Remarks sit in
// the ▸ detail row (see outward-register).

import { type JwDcOutwardLineRow } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { type DataTableColumn, leadColumns } from '@/ui/data';

function statusLabel(s: JwDcOutwardLineRow['returnStatus']): string {
  // Returned = done; Partly Returned / At Vendor = still under way.
  return s === 'fully_returned' ? 'Returned' : s === 'partial' ? 'Partly Returned' : 'At Vendor';
}

// Sort & Filter tick list (ADR-200): the stored status + the label shown.
const STATUS_OPTIONS = (['out', 'partial', 'fully_returned'] as const).map((s) => ({
  value: s,
  label: statusLabel(s),
}));

/** ADR-235 — a Cancelled outward DC (listed with includeCancelled):
 *  cancelledAt is the standard Cancel's stamp. */
export function isJwDcCancelled(dc: { cancelledAt: string | null }): boolean {
  return Boolean(dc.cancelledAt);
}

export function outwardColumns(): DataTableColumn<JwDcOutwardLineRow>[] {
  return [
    ...leadColumns<JwDcOutwardLineRow>({
      soNo: (r) => r.soCode ?? r.jwCode,
      internalSoNo: (r) => r.soInternalNo,
      pol: (r) => r.clientPoLineNo,
      createdOn: (r) => r.createdAt,
      itemCode: (r) => r.itemCode,
      itemRev: (r) => r.itemRevision,
      itemName: (r) => r.itemName,
      overrides: {
        so_no: { sortFilterField: 'soCode', filterType: 'text' },
        so_internal_no: { sortFilterField: 'soInternalNo', filterType: 'text' },
        client_po_line_no: { sortFilterField: 'clientPoLineNo', filterType: 'text' },
        created_on: { sortFilterField: 'createdOn' },
        item_code: { sortFilterField: 'itemCode', filterType: 'text' },
        item_name: { sortFilterField: 'itemName', filterType: 'text' },
      },
    }),
    {
      id: 'dc_no',
      sortFilterField: 'code',
      filterType: 'text',
      kind: 'code',
      header: 'DC No.',
      className: 'td-code',
      nowrap: true,
      render: (dc) => (
        <Link
          onClick={(e) => e.stopPropagation()}
          to="/jw-dc/$id"
          params={{ id: dc.docId }}
          style={{ color: 'var(--purple)', textDecoration: 'underline dotted' }}
        >
          {dc.docCode}
        </Link>
      ),
    },
    {
      id: 'dc_date',
      sortFilterField: 'dcDate',
      kind: 'date',
      header: 'DC Date',
      className: 'mono text2',
      nowrap: true,
      render: (dc) => fmtDate(dc.docDate),
    },
    {
      id: 'po_no',
      sortFilterField: 'poNo',
      filterType: 'text',
      kind: 'code',
      header: 'PO No.',
      className: 'mono',
      nowrap: true,
      render: (dc) => <span style={{ color: 'var(--cyan)' }}>{dc.jwpoCodeText ?? '—'}</span>,
    },
    {
      id: 'vendor',
      sortFilterField: 'vendor',
      filterType: 'text',
      kind: 'text',
      header: 'Vendor',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (dc) => dc.vendorName ?? '—',
      title: (dc) => dc.vendorName ?? '',
    },
    {
      id: 'sent',
      sortFilterField: 'sentQty',
      kind: 'num',
      header: 'Sent',
      align: 'right',
      headColor: 'var(--purple)',
      className: 'mono fw-700',
      render: (dc) => <span style={{ color: 'var(--purple)' }}>{dc.sentQty}</span>,
    },
    {
      id: 'received',
      sortFilterField: 'receivedQty',
      kind: 'num',
      header: 'Received',
      align: 'right',
      headColor: 'var(--green2)',
      className: 'mono',
      render: (dc) => <span style={{ color: 'var(--green2)' }}>{dc.receivedQty}</span>,
    },
    {
      id: 'pending',
      sortFilterField: 'pendingQty',
      kind: 'num',
      header: 'Pending',
      align: 'right',
      headColor: 'var(--red2)',
      className: 'mono fw-700',
      render: (dc) => (
        <span style={{ color: dc.pendingQty > 0 ? 'var(--red)' : 'var(--green)' }}>
          {dc.pendingQty}
        </span>
      ),
    },
    {
      id: 'status',
      sortFilterField: 'returnStatus',
      filterOptions: STATUS_OPTIONS,
      kind: 'badge',
      header: 'DC Status',
      // ADR-235: a Cancelled DC reads "Cancelled" here instead.
      render: (dc) =>
        isJwDcCancelled(dc) ? (
          <span className="badge b-red">Cancelled</span>
        ) : (
          <span className={`badge ${dc.returnStatus === 'fully_returned' ? 'b-green' : 'b-amber'}`}>
            {statusLabel(dc.returnStatus)}
          </span>
        ),
    },
  ];
}
