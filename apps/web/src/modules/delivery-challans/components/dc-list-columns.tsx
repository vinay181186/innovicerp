// OSP Outward DC list columns (ADR-199 fit table). ADR-303 (2026-11-16): ONE
// ROW PER DC again (GET /delivery-challans); the per-line read
// (/delivery-challans/lines) stays for the Print Register.
//
// Lead block: Sr No · DC No. · Created On · SO No. (first line's SO / JWSO /
// SO ref, grey "+n" for more) · Internal SO No. — no POL / Item Code / Item
// Name (a DC has many lines). Then DC Date · Vendor · PO No. · Lines · Sent Qty
// (Σ lines) · DC Status · JC No. (first + "+n") · Transport · Created By. The
// PO chip keeps its green (linked PO) / amber* (snapshot text) / red (NC
// return) meaning.

import { DC_STATUSES, type DeliveryChallanListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { fmtQty } from '@/lib/qty-format';
import { createdByColumn, type DataTableColumn, leadColumns } from '@/ui/data';
import { FirstPlusMore } from '@/modules/purchase-orders/components/first-plus-more';
import { DC_STATUS_LABEL } from '../lib/dc-status-label';
import { DcStatusBadge } from './dc-status-badge';

/** Sort & Filter (ADR-200, server mode) DC Status tick list: code + label shown. */
const DC_STATUS_OPTIONS = DC_STATUSES.map((value) => ({ value, label: DC_STATUS_LABEL[value] }));

/** The PO this DC was issued against — same three-way chip the card drew:
 *  green = a real linked PO, amber + `*` = the issue-time text snapshot only,
 *  red (NC …) = a return-to-vendor challan raised from an NC (no PO). */
function PoCell({ dc }: { dc: DeliveryChallanListItem }): React.JSX.Element {
  if (dc.ncId) {
    // 0237 — a return challan may carry several NCs: every one, line order.
    const nc =
      dc.ncs.length > 0 ? dc.ncs.map((n) => n.code).join(', ') : (dc.ncCode ?? dc.poCodeText);
    return (
      <span
        className="badge b-red"
        title={`Return to vendor — NC ${nc}${dc.jobCardCode ? ` · JC ${dc.jobCardCode}` : ''}`}
        style={{ fontSize: 'var(--fs-xs)' }}
      >
        NC {nc}
      </span>
    );
  }
  if (dc.poCode) {
    return (
      <span
        className="badge b-green"
        title={`Linked PO ${dc.poCode}`}
        style={{ fontSize: 'var(--fs-xs)' }}
      >
        {dc.poCode}
      </span>
    );
  }
  if (dc.poCodeText) {
    return (
      <span
        className="badge b-amber"
        title="PO No. typed by hand — not linked to a PO"
        style={{ fontSize: 'var(--fs-xs)' }}
      >
        {dc.poCodeText}*
      </span>
    );
  }
  return <span className="text3">—</span>;
}

export function dcListColumns(
  /** Sr No of the page's first row (offset + 1) — ADR-261 rev. */
  firstRowNo: number,
  /** ADR-202 — DC ids with a pending edit; their status cell shows "Draft". */
  draftIds?: Set<string>,
): DataTableColumn<DeliveryChallanListItem>[] {
  return [
    ...leadColumns<DeliveryChallanListItem>({
      firstRowNo,
      doc: {
        id: 'dc_code',
        sortFilterField: 'dcCode',
        header: 'DC No.',
        nowrap: true,
        render: (dc) => (
          <Link
            to="/delivery-challans/$id"
            params={{ id: dc.id }}
            className="td-code"
            style={{ color: 'var(--blue)', fontWeight: 800 }}
            onClick={(e) => e.stopPropagation()}
          >
            {dc.code}
          </Link>
        ),
      },
      soNo: (r) => r.lineSoCode,
      internalSoNo: (r) => r.lineSoInternalNo,
      createdOn: (r) => r.createdAt,
      overrides: {
        so_no: {
          sortFilterField: 'soCode',
          render: (r) => <FirstPlusMore value={r.lineSoCode} more={r.soExtraCount} />,
        },
        so_internal_no: { sortFilterField: 'soInternalNo' },
        created_on: { sortFilterField: 'createdOn' },
      },
    }),
    {
      id: 'dc_date',
      sortFilterField: 'dcDate',
      kind: 'date',
      header: 'DC Date',
      className: 'mono',
      nowrap: true,
      render: (dc) => fmtDate(dc.dcDate),
    },
    {
      id: 'vendor',
      sortFilterField: 'vendor',
      header: 'Vendor',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (dc) => dc.vendorName ?? dc.vendorCodeText ?? '—',
      title: (dc) => dc.vendorName ?? dc.vendorCodeText ?? '',
    },
    {
      id: 'po_code',
      sortFilterField: 'poCode',
      kind: 'code',
      header: 'PO No.',
      nowrap: true,
      render: (dc) => <PoCell dc={dc} />,
    },
    {
      id: 'line_count',
      sortFilterField: 'lineCount',
      filterType: 'num',
      header: 'Lines',
      nowrap: true,
      className: 'mono',
      render: (dc) => dc.lineCount,
    },
    {
      id: 'sent_qty',
      sortFilterField: 'totalQty',
      filterType: 'num',
      header: 'Sent Qty',
      align: 'right',
      nowrap: true,
      // Whole pieces print whole (12, not 12.00); a real fraction keeps ≤3dp.
      render: (dc) => <span className="mono fw-700">{fmtQty(Number(dc.totalQty))}</span>,
    },
    {
      id: 'dc_status',
      sortFilterField: 'status',
      filterOptions: DC_STATUS_OPTIONS,
      kind: 'badge',
      header: 'DC Status',
      nowrap: true,
      render: (dc) => <DcStatusBadge status={dc.status} draft={draftIds?.has(dc.id)} />,
    },
    {
      id: 'jc_code',
      sortFilterField: 'jobCardCode',
      kind: 'code',
      header: 'JC No.',
      nowrap: true,
      render: (dc) => (
        <span className="mono">
          <FirstPlusMore
            value={dc.lineJobCardCode}
            more={dc.jobCardExtraCount}
            color="var(--text2)"
          />
        </span>
      ),
    },
    {
      id: 'transport',
      sortFilterField: 'transport',
      header: 'Transport',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (dc) => dc.transport?.trim() || '—',
      title: (dc) => dc.transport ?? '',
    },
    // ADR-261 rev — Created By, the last data column.
    createdByColumn({
      createdByName: (r) => r.createdByName,
      overrides: { sortFilterField: 'createdBy' },
    }),
  ];
}
