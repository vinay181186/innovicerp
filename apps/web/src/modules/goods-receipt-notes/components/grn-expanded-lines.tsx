// The GRN's lines, revealed in place under an opened row in the GRN list
// (ADR-199 ▸ expand). Its own fetch — the list endpoint carries no lines, so
// only a row actually opened costs a request. Mirrors the PO list's
// PoExpandedLines and uses the compact nested-table density.
//
// Above the lines it restates the document references the list row no longer
// shows inline: our own DC, the vendor's challan, the vendor invoice and the
// GRN remarks (they moved off the retired card's meta line into here when the
// card became a table row).
//
// 2026-10-06, two naming fixes (CLAUDE.md §18):
//   - `dcNo` (the VENDOR's delivery paper) was labelled `DC No.` whenever the
//     GRN came off a challan. `DC No.` on the detail page is a DIFFERENT
//     field — OUR outward delivery challan (`dcCode`) — so one name covered
//     two facts, and the reader could not tell whose number they were looking
//     at. The vendor's paper is `Vendor Challan No.` everywhere now, and our
//     own DC is shown beside it under `DC No.` when there is one.
//   - the columns ran Accepted / Deviated BEFORE QC Status while the detail
//     page ran QC Status first. Settled on the verdict, then the split:
//     QC Status → Accepted → Deviated. `UOM` was missing here and present on
//     the detail table; added, so the two tables agree column for column.

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
        // UOM off the item master (A26); blank when the line has no item. The
        // detail table has always shown it — this one had not.
        id: 'uom',
        header: 'UOM',
        className: 'mono',
        nowrap: true,
        render: (l) => l.uom ?? '—',
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
        // The verdict first, then the split it breaks into — the order the
        // detail page and the print already use.
        id: 'qc_status',
        kind: 'badge',
        header: 'QC Status',
        nowrap: true,
        render: (l) => <QcStatusBadge status={l.qcStatus} />,
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
        header: 'Deviated',
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
      {/* Document references the row no longer shows inline. Two different
          numbers under two different names: OUR outward challan (`dcCode`) and
          the VENDOR's paper (`dcNo`). On a GRN raised by receiving our own DC
          the receive service copies the DC code into `dcNo`, so the vendor's
          cell is dropped when it would only repeat our own number. */}
      <GrnRefLine
        dcCode={data.dcCode}
        dcNo={data.dcNo && data.dcNo !== data.dcCode ? data.dcNo : null}
        invoiceNo={data.invoiceNo}
        remarks={data.remarks}
      />
      <DataTable columns={columns} rows={data.lines} density="compact" emptyText="No lines yet." />
    </div>
  );
}

function GrnRefLine({
  dcCode,
  dcNo,
  invoiceNo,
  remarks,
}: {
  /** OUR outward delivery challan this GRN received. */
  dcCode: string | null;
  /** The VENDOR's own challan number, as typed by the storekeeper. */
  dcNo: string | null;
  invoiceNo: string | null;
  remarks: string | null;
}): React.JSX.Element | null {
  if (!dcCode && !dcNo && !invoiceNo && !remarks) return null;
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
      {dcCode ? (
        <span style={{ whiteSpace: 'nowrap' }}>
          DC No. <span className="text2">{dcCode}</span>
        </span>
      ) : null}
      {dcNo ? (
        <span style={{ whiteSpace: 'nowrap' }}>
          Vendor Challan No. <span className="text2">{dcNo}</span>
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
