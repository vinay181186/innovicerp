// OSP Outward DC list columns (ADR-199 fit table) — ONE ROW PER DC LINE
// (ADR-261, GET /delivery-challans/lines). Split out of routes/list.tsx to keep
// that file under the 400-line rule.
//
// DC No. and the six lead columns come first and are locked (leadColumns): SO No. (the SO
// code, else the JWSO code, else the DC's SO ref) · Internal SO No. · POL ·
// Created On (the line's) · Item Code (CODE/REV — no separate Drawing Rev
// column any more) · Item Name. Then DC Date · Vendor · PO No. ·
// Sent Qty (the line's) · DC Status · JC No. · Transport. The PO chip keeps its
// green (linked PO) / amber* (snapshot text) / red (NC return) meaning.

import { DC_STATUSES, type DeliveryChallanListLine } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { fmtDate } from '@/lib/date';
import { leadColumns, type DataTableColumn } from '@/ui/data';
import { DC_STATUS_LABEL } from '../lib/dc-status-label';
import { DcStatusBadge } from './dc-status-badge';

/** Sort & Filter (ADR-200, server mode) DC Status tick list: code + label shown. */
const DC_STATUS_OPTIONS = DC_STATUSES.map((value) => ({ value, label: DC_STATUS_LABEL[value] }));

/** The PO this DC was issued against — same three-way chip the card drew:
 *  green = a real linked PO, amber + `*` = the issue-time text snapshot only,
 *  red (NC …) = a return-to-vendor challan raised from an NC (no PO). */
function PoCell({ dc }: { dc: DeliveryChallanListLine }): React.JSX.Element {
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

export function dcListColumns(
  /** ADR-202 — DC ids with a pending edit; their status cell shows "Draft". */
  draftIds?: Set<string>,
): DataTableColumn<DeliveryChallanListLine>[] {
  return [
    ...leadColumns<DeliveryChallanListLine>({
      doc: {
        id: 'dc_code',
        sortFilterField: 'dcCode',
        header: 'DC No.',
        nowrap: true,
        render: (dc) => (
          <Link
            to="/delivery-challans/$id"
            params={{ id: dc.docId }}
            className="td-code"
            style={{ color: 'var(--blue)', fontWeight: 800 }}
            onClick={(e) => e.stopPropagation()}
          >
            {dc.docCode}
          </Link>
        ),
      },
      docDate: {
        id: 'dc_date',
        sortFilterField: 'dcDate',
        kind: 'date',
        header: 'DC Date',
        className: 'mono',
        nowrap: true,
        render: (dc) => fmtDate(dc.docDate),
      },
      soNo: (r) => r.soCode ?? r.jwCode,
      internalSoNo: (r) => r.soInternalNo,
      pol: (r) => r.clientPoLineNo,
      createdOn: (r) => r.createdAt,
      itemCode: (r) => r.itemCode,
      itemRev: (r) => r.itemRevision,
      itemName: (r) => r.itemName,
      overrides: {
        so_no: { sortFilterField: 'soCode' },
        so_internal_no: { sortFilterField: 'soInternalNo' },
        client_po_line_no: { sortFilterField: 'clientPoLineNo' },
        created_on: { sortFilterField: 'createdOn' },
        item_code: { sortFilterField: 'itemCode' },
        item_name: { sortFilterField: 'itemName' },
      },
    }),
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
      id: 'sent_qty',
      sortFilterField: 'qty',
      filterType: 'num',
      header: 'Sent Qty',
      align: 'right',
      nowrap: true,
      // Whole pieces print whole (12, not 12.00); a real fraction keeps ≤2dp.
      render: (dc) => (
        <span className="mono fw-700">
          {Number(dc.qty).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      id: 'dc_status',
      sortFilterField: 'status',
      filterOptions: DC_STATUS_OPTIONS,
      kind: 'badge',
      header: 'DC Status',
      nowrap: true,
      render: (dc) => <DcStatusBadge status={dc.docStatus} draft={draftIds?.has(dc.docId)} />,
    },
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
      id: 'transport',
      sortFilterField: 'transport',
      header: 'Transport',
      align: 'left',
      ellipsis: true,
      className: 'text2',
      render: (dc) => dc.transport?.trim() || '—',
      title: (dc) => dc.transport ?? '',
    },
  ];
}
