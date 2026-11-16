// Outward Register columns (ADR-199 fit table) — ONE ROW PER DC again
// (ADR-303, GET /jw-dc/outward). The locked lead block: Sr No · DC No. ·
// Created On · SO No. · Internal SO No. — the order behind the DC's FIRST line
// (SO code, else JWSO code) with a grey "+n" when its lines cover more orders;
// no POL / Item Code / Item Name on a document list. Then DC Date · PO No. ·
// Vendor · Lines · Sent · Received · Pending (sums of the lines) · DC Status
// (one per DC, rolled up from its lines: all back = Returned, some = Partly
// Returned, none = At Vendor) · Created By last. Vehicle / Remarks and the
// lines are on the DC's own page (/jw-dc/$id).

import { type JwDcOutwardListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { createdByColumn, type DataTableColumn, leadColumns } from '@/ui/data';

function statusLabel(s: JwDcOutwardListItem['returnStatus']): string {
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

export function outwardColumns(firstRowNo: number): DataTableColumn<JwDcOutwardListItem>[] {
  return [
    ...leadColumns<JwDcOutwardListItem>({
      firstRowNo,
      doc: {
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
            params={{ id: dc.id }}
            style={{ color: 'var(--blue)', textDecoration: 'underline dotted' }}
          >
            {dc.code}
          </Link>
        ),
      },
      soNo: (r) => r.orderCode,
      internalSoNo: (r) => r.soInternalNo,
      createdOn: (r) => r.createdAt,
      overrides: {
        so_no: {
          sortFilterField: 'soCode',
          filterType: 'text',
          // The first line's order + a grey "+n" for the other orders its lines cover.
          render: (r) => (
            <>
              <span style={{ color: 'var(--blue)' }}>{r.orderCode ?? '—'}</span>
              {r.orderExtraCount ? <span className="text3"> +{r.orderExtraCount}</span> : null}
            </>
          ),
        },
        so_internal_no: { sortFilterField: 'soInternalNo', filterType: 'text' },
        created_on: { sortFilterField: 'createdOn' },
      },
    }),
    {
      id: 'dc_date',
      sortFilterField: 'dcDate',
      kind: 'date',
      header: 'DC Date',
      className: 'mono text2',
      nowrap: true,
      render: (dc) => fmtDate(dc.dcDate),
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
      render: (dc) => dc.vendorName ?? dc.vendorNameText ?? dc.vendorCodeText ?? '—',
      title: (dc) => dc.vendorName ?? dc.vendorNameText ?? '',
    },
    {
      id: 'line_count',
      sortFilterField: 'lineCount',
      kind: 'num',
      header: 'Lines',
      className: 'mono',
      render: (dc) => dc.linesCount,
    },
    {
      id: 'sent',
      sortFilterField: 'sentQty',
      kind: 'num',
      header: 'Sent',
      align: 'right',
      headColor: 'var(--purple)',
      className: 'mono fw-700',
      render: (dc) => <span style={{ color: 'var(--purple)' }}>{dc.totalSentQty}</span>,
    },
    {
      id: 'received',
      sortFilterField: 'receivedQty',
      kind: 'num',
      header: 'Received',
      align: 'right',
      headColor: 'var(--green2)',
      className: 'mono',
      render: (dc) => <span style={{ color: 'var(--green2)' }}>{dc.totalReturnedQty}</span>,
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
    // ADR-261 rev — Created By, the last data column.
    createdByColumn({
      createdByName: (r) => r.createdByName,
      overrides: { sortFilterField: 'createdBy' },
    }),
  ];
}
