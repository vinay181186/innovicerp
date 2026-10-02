// OSP Outward DC list columns (ADR-199 fit table). One line per row; the fit
// engine sizes the columns to the screen and drops the rightmost unpinned ones
// — and the default-hidden JC No. / Drawing Rev / Transport — into the ▸ detail
// row. Split out of routes/list.tsx to keep that file under the 400-line rule.
//
// Every field the old card showed is still here: the PO chip keeps its
// green (linked PO) / amber* (snapshot text) / red (NC return) meaning and its
// tooltips, the Sent total keeps its whole-vs-fraction formatting, and the JC /
// Drawing Rev / Transport facts move into ▸ (defaultHidden below).

import { DC_STATUSES, type DeliveryChallanListItem } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import type { DataTableColumn } from '@/ui/data';
import { DC_STATUS_LABEL } from '../lib/dc-status-label';
import { DcStatusBadge } from './dc-status-badge';

/** Column ids shown inside the ▸ detail row by default (fit engine
 *  `defaultHidden`): JC No., Drawing Rev, Transport, Created On. */
export const DC_LIST_DEFAULT_HIDDEN = ['jc_code', 'drawing_rev', 'transport', 'created_on'];

/** Sort & Filter (ADR-200, server mode) DC Status tick list: code + label shown. */
const DC_STATUS_OPTIONS = DC_STATUSES.map((value) => ({ value, label: DC_STATUS_LABEL[value] }));

/** The PO this DC was issued against — same three-way chip the card drew:
 *  green = a real linked PO, amber + `*` = the issue-time text snapshot only,
 *  red (NC …) = a return-to-vendor challan raised from an NC (no PO). */
function PoCell({ dc }: { dc: DeliveryChallanListItem }): React.JSX.Element {
  if (dc.ncId) {
    return (
      <span
        className="badge b-red"
        title={`Return to vendor — NC ${dc.ncCode ?? dc.poCodeText}${dc.jobCardCode ? ` · JC ${dc.jobCardCode}` : ''}`}
        style={{ fontSize: 11 }}
      >
        NC {dc.ncCode ?? dc.poCodeText}
      </span>
    );
  }
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
        title="PO No. typed by hand — not linked to a PO"
        style={{ fontSize: 11 }}
      >
        {dc.poCodeText}*
      </span>
    );
  }
  return <span className="text3">—</span>;
}

export function dcListColumns(): DataTableColumn<DeliveryChallanListItem>[] {
  return [
    {
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
      id: 'so_code',
      sortFilterField: 'soCode',
      kind: 'code',
      header: 'SO No.',
      nowrap: true,
      render: (dc) => (
        <span className="mono text2" style={{ fontSize: 'var(--fs-xs)' }}>
          {dc.soCode ?? dc.soRefText ?? '—'}
        </span>
      ),
    },
    {
      id: 'sent_qty',
      sortFilterField: 'totalQty',
      filterType: 'num',
      header: 'Sent Qty',
      align: 'right',
      nowrap: true,
      // Whole pieces print whole (12, not 12.00); a real fraction keeps ≤2dp.
      render: (dc) => (
        <span className="mono fw-700">
          {Number(dc.totalQty).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      id: 'lines',
      sortFilterField: 'lineCount',
      filterType: 'num',
      header: 'Lines',
      align: 'right',
      nowrap: true,
      render: (dc) => <span className="mono">{dc.lineCount}</span>,
    },
    {
      id: 'dc_status',
      sortFilterField: 'status',
      filterOptions: DC_STATUS_OPTIONS,
      kind: 'badge',
      header: 'DC Status',
      nowrap: true,
      render: (dc) => <DcStatusBadge status={dc.status} />,
    },
    // ── ▸ detail row (defaultHidden) ──────────────────────────────────────
    {
      id: 'jc_code',
      sortFilterField: 'jobCardCode',
      kind: 'code',
      header: 'JC No.',
      nowrap: true,
      render: (dc) =>
        dc.jobCardCode ? (
          <span className="mono text2">{dc.jobCardCode}</span>
        ) : (
          <span className="text3">—</span>
        ),
    },
    {
      id: 'drawing_rev',
      sortFilterField: 'drawingRev',
      kind: 'code',
      header: 'Drawing Rev',
      nowrap: true,
      render: (dc) =>
        dc.soLineRevision ? (
          <span className="mono text2">{dc.soLineRevision}</span>
        ) : (
          <span className="text3">—</span>
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
    {
      // When the DC record was entered (IST day) — Sort & Filter can pick a
      // range of it (ADR-200). Off by default; Columns ▾ shows it.
      id: 'created_on',
      sortFilterField: 'createdOn',
      kind: 'date',
      header: 'Created On',
      className: 'mono',
      nowrap: true,
      render: (dc) => fmtDate(dc.createdAt),
    },
  ];
}
