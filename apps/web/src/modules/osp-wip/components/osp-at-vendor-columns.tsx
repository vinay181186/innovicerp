// At-Vendor Register columns (ADR-199 fit table: one line per row, always fits
// the screen). Moved out of osp-at-vendor-register.tsx.
//
// Bucket colours (header + figure): amber At Vendor, cyan In QC, green
// Accepted, blue Not Sent, purple Ready to Send — purple being the one colour
// no bucket already speaks for. A zero reads "—" in the muted token.

import { opSrNo, type OspWipRow } from '@innovic/shared';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import type { DataTableColumn } from '@/ui/data';

export const OSP_AT_VENDOR_DEFAULT_PINNED = ['item_code'];

function qty(
  id: string,
  header: string,
  pick: (r: OspWipRow) => number,
  color: string,
  opts: { headColor?: string; title?: string; bold?: boolean; sf?: string } = {},
): DataTableColumn<OspWipRow> {
  return {
    id,
    sortFilterField: opts.sf,
    kind: 'num',
    header: opts.title ? <span title={opts.title}>{header}</span> : header,
    label: header,
    align: 'right',
    headColor: opts.headColor,
    className: opts.bold ? 'mono fw-700' : 'mono',
    render: (r) => {
      const v = pick(r);
      return <span style={{ color: v > 0 ? color : 'var(--text3)' }}>{v || '—'}</span>;
    },
  };
}

export function ospAtVendorColumns(): DataTableColumn<OspWipRow>[] {
  return [
    {
      id: 'jc_no',
      sortFilterField: 'jcCode',
      kind: 'code',
      header: 'JC No.',
      className: 'td-code',
      render: (r) => <span style={{ color: 'var(--cyan)' }}>{r.jcCode}</span>,
    },
    {
      // POL — the line number printed on the CUSTOMER's own purchase order,
      // immediately before the item code. '—' when no sales order is behind it.
      id: 'client_po_line_no',
      sortFilterField: 'clientPoLineNo',
      kind: 'code',
      header: 'POL',
      headColor: 'var(--purple)',
      className: 'mono fw-700',
      render: (r) => <span style={{ color: 'var(--purple)' }}>{r.clientPoLineNo ?? '—'}</span>,
    },
    {
      id: 'item_code',
      sortFilterField: 'itemCode',
      kind: 'code',
      header: 'Item Code',
      className: 'mono fw-700',
      render: (r) => (
        <span style={{ color: 'var(--text)' }}>{itemCodeWithRev(r.itemCode, r.itemRevision)}</span>
      ),
    },
    {
      id: 'item_name',
      sortFilterField: 'itemName',
      kind: 'text',
      header: 'Item Name',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (r) => r.itemName ?? '—',
      title: (r) => r.itemName ?? '',
    },
    {
      id: 'so_no',
      sortFilterField: 'soCode',
      kind: 'code',
      header: 'SO No.',
      className: 'mono text2',
      render: (r) => (r.soCode ? soNoWithInternal(r.soCode, r.soInternalNo) : '—'),
    },
    {
      id: 'vendor',
      sortFilterField: 'vendorName',
      kind: 'text',
      header: 'Vendor',
      ellipsis: true,
      className: 'text2',
      render: (r) => r.vendorName ?? '—',
      title: (r) => r.vendorName ?? '',
    },
    {
      id: 'operation',
      sortFilterField: 'operation',
      kind: 'text',
      header: 'Operation',
      ellipsis: true,
      className: 'text3',
      render: (r) => r.operation ?? `Op ${opSrNo(r.opSeq)}`,
      title: (r) => r.operation ?? '',
    },
    {
      id: 'order_qty',
      sortFilterField: 'orderQty',
      kind: 'num',
      header: 'Order Qty',
      align: 'right',
      className: 'mono',
      render: (r) => r.orderQty,
    },
    qty('sent', 'Sent', (r) => r.sentQty, 'var(--text3)', { sf: 'sentQty' }),
    qty('at_vendor', 'At Vendor', (r) => r.atVendorQty, 'var(--amber)', {
      sf: 'atVendorQty',
      headColor: 'var(--amber2)',
      title: 'Physically out at the vendor (sent − returned)',
      bold: true,
    }),
    qty('in_qc', 'In QC', (r) => r.inQcQty, 'var(--cyan)', {
      sf: 'inQcQty',
      headColor: 'var(--cyan)',
      title: 'Returned, incoming QC still pending',
      bold: true,
    }),
    qty('accepted', 'Accepted', (r) => r.acceptedQty, 'var(--green)', {
      sf: 'acceptedQty',
      headColor: 'var(--green2)',
      title: 'Accepted at incoming QC',
    }),
    qty('rejected', 'Rejected', (r) => r.rejectedQty, 'var(--red)', { sf: 'rejectedQty' }),
    qty('not_sent', 'Not Sent', (r) => r.notSentQty, 'var(--blue)', {
      sf: 'notSentQty',
      headColor: 'var(--blue)',
      title: 'Not yet sent to the vendor',
    }),
    // Not Sent is order − sent, an ORDER-level figure that over-states what may
    // physically leave; this is the shop-floor number the challan will accept.
    qty('ready_to_send', 'Ready to Send', (r) => r.readyToSendQty, 'var(--purple)', {
      sf: 'readyToSendQty',
      headColor: 'var(--purple)',
      title: 'Cleared by the previous operation — what a challan accepts today',
      bold: true,
    }),
  ];
}
