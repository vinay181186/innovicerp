// The GRN's lines, revealed in place under an opened row in the GRN list
// (ADR-199 ▸ expand). Its own fetch — the list endpoint carries no lines, so
// only a row actually opened costs a request. Mirrors the PO list's
// PoExpandedLines and uses the compact nested-table density.
//
// Above the lines it restates the document references the list row no longer
// shows inline: DC / vendor challan, vendor invoice and remarks (they moved off
// the retired card's meta line into here when the card became a table row).

import type { GoodsReceiptNoteLineDetail } from '@innovic/shared';
import { useMemo } from 'react';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { PageState } from '@/ui/layout';
import { useGoodsReceiptNote } from '../api';
import { QcStatusBadge } from './qc-status-badge';

export function GrnExpandedLines({ grnId }: { grnId: string }): React.JSX.Element {
  const { data, isLoading } = useGoodsReceiptNote(grnId);

  const columns = useMemo<DataTableColumn<GoodsReceiptNoteLineDetail>[]>(
    () => [
      {
        header: 'Ln',
        width: '5%',
        align: 'right',
        className: 'mono fw-700',
        render: (l) => l.lineNo,
      },
      {
        id: 'pol',
        header: 'POL',
        nowrap: true,
        // POL = the CUSTOMER's own PO line number off the SO line behind this
        // receipt line. Not our SO line number.
        render: (l) =>
          l.clientPoLineNo ? (
            <span className="mono fw-700" style={{ color: 'var(--purple)' }}>
              {l.clientPoLineNo}
            </span>
          ) : (
            <span className="text3">—</span>
          ),
      },
      {
        id: 'item_code',
        header: 'Item Code',
        className: 'td-code',
        nowrap: true,
        render: (l) => itemCodeWithRev(l.itemCode ?? l.itemCodeText, l.itemRevision),
      },
      {
        id: 'item_name',
        header: 'Item Name',
        align: 'left',
        ellipsis: true,
        render: (l) => l.masterItemName ?? l.itemName,
        title: (l) => l.masterItemName ?? l.itemName,
      },
      {
        id: 'received',
        header: 'Received',
        align: 'right',
        className: 'mono fw-700',
        nowrap: true,
        render: (l) => l.receivedQty,
      },
      {
        id: 'accepted',
        header: 'Accepted',
        align: 'right',
        nowrap: true,
        headColor: 'var(--green)',
        render: (l) => (
          <span
            className="mono fw-700"
            style={{ color: l.qcAcceptedQty > 0 ? 'var(--green)' : 'var(--text3)' }}
          >
            {l.qcAcceptedQty}
          </span>
        ),
      },
      {
        id: 'rejected',
        header: 'Rejected',
        align: 'right',
        nowrap: true,
        headColor: 'var(--red)',
        render: (l) => (
          <span
            className="mono"
            style={{ color: l.qcRejectedQty > 0 ? 'var(--red)' : 'var(--text3)' }}
          >
            {l.qcRejectedQty}
          </span>
        ),
      },
      {
        id: 'qc_status',
        kind: 'badge',
        header: 'QC Status',
        nowrap: true,
        render: (l) => <QcStatusBadge status={l.qcStatus} />,
      },
      {
        id: 'qc_date',
        kind: 'date',
        header: 'QC Date',
        className: 'mono',
        nowrap: true,
        render: (l) => fmtDate(l.qcDate),
      },
    ],
    [],
  );

  if (isLoading) {
    return <PageState as="inline" state="loading" message="⟳ Loading lines…" />;
  }
  if (!data) return <PageState as="inline" state="empty" message="—" />;

  return (
    <div style={{ padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)' }}>
      <div
        className="mono fw-700"
        style={{ fontSize: 'var(--fs-xs)', color: 'var(--blue)', marginBottom: 'var(--sp-1)' }}
      >
        ▸ Lines — {data.code}
      </div>
      {/* Document references the row no longer shows inline. DC vs vendor
          challan turns on whether the GRN was raised against an OSP DC. */}
      <GrnRefLine
        dcLabel={data.deliveryChallanId ? 'DC No.' : 'Vendor Challan No.'}
        dcNo={data.dcNo}
        invoiceNo={data.invoiceNo}
        remarks={data.remarks}
      />
      <DataTable columns={columns} rows={data.lines} density="compact" emptyText="No lines yet." />
    </div>
  );
}

function GrnRefLine({
  dcLabel,
  dcNo,
  invoiceNo,
  remarks,
}: {
  dcLabel: string;
  dcNo: string | null;
  invoiceNo: string | null;
  remarks: string | null;
}): React.JSX.Element | null {
  if (!dcNo && !invoiceNo && !remarks) return null;
  return (
    <div
      className="mono"
      style={{
        fontSize: 'var(--fs-xs)',
        color: 'var(--text3)',
        display: 'flex',
        gap: 'var(--sp-2)',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginBottom: 'var(--sp-2)',
      }}
    >
      {dcNo ? (
        <span style={{ whiteSpace: 'nowrap' }}>
          {dcLabel} <span className="text2">{dcNo}</span>
        </span>
      ) : null}
      {invoiceNo ? (
        <span style={{ whiteSpace: 'nowrap' }}>
          Vendor Invoice No. <span className="text2">{invoiceNo}</span>
        </span>
      ) : null}
      {remarks ? <span title={remarks}>{remarks}</span> : null}
    </div>
  );
}
