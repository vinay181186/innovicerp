// Incoming QC — Pending Inspection columns + ▸ detail (ADR-199 fit table).
// Split out of routes/index.tsx so that file stays under the 400-line ceiling.
// Centred by the table standard; the one number column (QC Pending) is
// right-aligned (num). Item Code carries the customer drawing revision where a
// job card traces back to an SO line.
//
// Columns, first pinned: GRN No. · Item Code · Vendor · QC Pending · Days
// Waiting. The ▸ detail shows GRN Date, PO No., POL and Item Name — the fields
// the retired wide table carried that are context rather than queue triage.

import type { IncomingQcPendingRow } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn } from '@/ui/data';
import { daysText, waitBadge } from '../lib/qc-format';

export function incomingQcPendingColumns(): DataTableColumn<IncomingQcPendingRow>[] {
  return [
    {
      // First column — pinned by the table standard (ADR-199).
      id: 'grn_code',
      header: 'GRN No.',
      sortFilterField: 'grnNo',
      nowrap: true,
      className: 'td-code cyan',
      render: (r) => r.grnNo,
    },
    {
      id: 'item_code',
      header: 'Item Code',
      sortFilterField: 'itemCode',
      nowrap: true,
      className: 'td-code',
      // An OSP return traces back to an SO line and shows CODE/REV; a vendor's
      // raw-material receipt has no SO behind it and shows the bare code.
      render: (r) => (
        <span style={{ color: 'var(--text)' }}>{itemCodeWithRev(r.itemCode, r.itemRevision)}</span>
      ),
    },
    {
      id: 'vendor',
      header: 'Vendor',
      sortFilterField: 'vendorName',
      align: 'left',
      ellipsis: true,
      render: (r) => r.vendorName ?? '—',
      title: (r) => r.vendorName ?? '',
    },
    {
      id: 'qc_pending',
      header: 'QC Pending',
      sortFilterField: 'pendingQty',
      filterType: 'num',
      align: 'right',
      nowrap: true,
      headColor: 'var(--amber2)',
      render: (r) => (
        <span className="mono fw-700" style={{ color: 'var(--amber2)' }}>
          {r.pendingQty}
        </span>
      ),
    },
    {
      id: 'days_waiting',
      header: 'Days Waiting',
      sortFilterField: 'waitDays',
      filterType: 'num',
      align: 'right',
      nowrap: true,
      headColor: 'var(--amber2)',
      filterValue: (r) => r.waitDays,
      render: (r) => (
        <span className={`badge ${waitBadge(r.waitDays)}`}>{daysText(r.waitDays)}</span>
      ),
    },
  ];
}

/** ▸ detail row: the context fields (GRN Date, PO No., POL, Item Name) the
 *  triage columns leave out. POL = the customer's own PO line number off the SO
 *  line behind this receipt; '—' on a raw-material receipt with no SO behind it. */
export function IncomingQcPendingExpanded({ r }: { r: IncomingQcPendingRow }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 24px', padding: '8px 12px' }}>
      <Field label="GRN Date" value={fmtDate(r.grnDate)} mono />
      <Field label="PO No." value={r.poCode ?? '—'} mono />
      <Field label="POL" value={r.clientPoLineNo ?? '—'} mono color="var(--purple)" />
      <Field label="Item Name" value={r.itemName ?? '—'} />
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  color,
}: {
  label: string;
  value: string;
  mono?: boolean;
  color?: string;
}): React.JSX.Element {
  return (
    <span style={{ fontSize: 11 }}>
      <span style={{ color: 'var(--text3)' }}>{label}: </span>
      <span className={mono ? 'mono fw-700' : 'fw-700'} style={{ color: color ?? 'var(--text2)' }}>
        {value}
      </span>
    </span>
  );
}
