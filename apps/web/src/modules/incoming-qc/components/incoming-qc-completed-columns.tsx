// Incoming QC — Recently Completed columns + ▸ detail (ADR-199 fit table).
// Split out of routes/index.tsx so that file stays under the 400-line ceiling.
// Centred by the table standard; the two qty columns (Accepted, Rejected) are
// right-aligned (num).
//
// Columns, first pinned: GRN No. · Item Code · Accepted · Rejected · QC Result ·
// QC Date. The ▸ detail keeps every other field the retired wide table showed —
// GRN Date, Days to Inspect, Vendor, POL, Item Name, Received, Remarks and the
// QC report attachment — so nothing was dropped in the move.

import type { IncomingQcCompletedRow } from '@innovic/shared';
import { QcReportLink } from '@/components/shared/qc-report-attach';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import type { DataTableColumn } from '@/ui/data';
import { daysText, dispColor, dispLabel, respColor } from '../lib/qc-format';

// Server Sort & Filter tick list for QC Result: the stored result code + the
// word the cell shows (dispLabel).
const QC_RESULT_OPTIONS = (['Accepted', 'Partial Accept', 'Rejected'] as const).map((d) => ({
  value: d,
  label: dispLabel(d),
}));

export function incomingQcCompletedColumns(): DataTableColumn<IncomingQcCompletedRow>[] {
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
      render: (r) => (
        <span style={{ color: 'var(--text)' }}>{itemCodeWithRev(r.itemCode, r.itemRevision)}</span>
      ),
    },
    {
      id: 'accepted',
      header: 'Accepted',
      sortFilterField: 'acceptedQty',
      filterType: 'num',
      align: 'right',
      nowrap: true,
      headColor: 'var(--green)',
      render: (r) => (
        <span className="mono fw-700" style={{ color: 'var(--green2)' }}>
          {r.acceptedQty}
        </span>
      ),
    },
    {
      id: 'rejected',
      header: 'Rejected',
      sortFilterField: 'rejectedQty',
      filterType: 'num',
      align: 'right',
      nowrap: true,
      headColor: 'var(--red)',
      render: (r) => (
        <span className="mono fw-700" style={{ color: 'var(--red2)' }}>
          {r.rejectedQty}
        </span>
      ),
    },
    {
      id: 'qc_result',
      kind: 'badge',
      header: 'QC Result',
      sortFilterField: 'disposition',
      filterOptions: QC_RESULT_OPTIONS,
      nowrap: true,
      filterValue: (r) => dispLabel(r.disposition),
      render: (r) => (
        <span className="fw-700" style={{ color: dispColor(r.disposition) }}>
          {dispLabel(r.disposition)}
        </span>
      ),
    },
    {
      id: 'qc_date',
      kind: 'date',
      header: 'QC Date',
      sortFilterField: 'qcDate',
      className: 'mono',
      nowrap: true,
      headColor: 'var(--green2)',
      render: (r) => (r.qcDate ? fmtDate(r.qcDate) : '—'),
    },
  ];
}

/** ▸ detail row: every field the six triage columns leave out, so the completed
 *  feed loses nothing it showed before. POL = the customer's own PO line number;
 *  '—' on a raw-material receipt with no SO behind it. */
export function IncomingQcCompletedExpanded({
  r,
}: {
  r: IncomingQcCompletedRow;
}): React.JSX.Element {
  const resp = r.respDays === null ? '—' : r.respDays <= 0 ? 'Same day' : daysText(r.respDays);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 24px', padding: '8px 12px' }}>
      <Field label="GRN Date" value={fmtDate(r.grnDate)} mono />
      <Field label="Days to Inspect" value={resp} mono color={respColor(r.respDays)} />
      <Field label="Vendor" value={r.vendorName ?? '—'} />
      <Field label="POL" value={r.clientPoLineNo ?? '—'} mono color="var(--purple)" />
      <Field label="Item Name" value={r.itemName ?? '—'} />
      <Field label="Received" value={String(r.receivedQty)} mono />
      <Field label="Remarks" value={r.qcRemarks ?? '—'} />
      <span style={{ fontSize: 11 }}>
        <span style={{ color: 'var(--text3)' }}>Report: </span>
        {r.qcReportPath ? (
          <QcReportLink path={r.qcReportPath} name={r.qcReportName} label="Report" />
        ) : (
          <span className="text3">—</span>
        )}
      </span>
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
