// Sales Order / JW Sales Order print (owner 2026-10-17: "per SO no. / JWSO no.
// user can preview, print, download — refer to PO print"). Same sheet as the
// PO (`@/lib/print/sheet-print`); the party is the CUSTOMER, and the money is
// the order's one GST %. Presentation only — SO and JWSO both print the
// SERVER's `totals` (ADR-243: Subtotal → SGST + CGST or IGST → Round-off →
// Grand Total), the same figures the detail page shows. No totals (prices
// hidden) → no money block.

import {
  type Client,
  type Company,
  type EffectivePrintTemplate,
  type JobWorkOrderDetail,
  type SalesOrderDetail,
  type SoTotals,
  placeOfSupplyLabel,
} from '@innovic/shared';
import { todayIst } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { COMPANY_CARD_ADDRESS_LINES, buildDocCompany } from '@/lib/print/company';
import { amountInWords, fmtDate, inrFormat, templatesToBlocks } from '@/lib/print/doc-print';
import { partyForPrint } from '@/lib/print/party-copy';
import { type SheetField, type SheetPrintModel, challanDate } from '@/lib/print/sheet-print';
import { gstTaxRows, signedRoundOff } from './gst-rows';
import { SO_STATUS_LABEL, SO_TYPE_LABEL } from './so-status-label';

type OrderArgs = {
  client: Client | null | undefined;
  company: Company | null | undefined;
  templates: EffectivePrintTemplate[];
  currentUser?: string | undefined;
  /** ADR-202 — an edit is pending: the sheet prints "Draft — awaiting approval". */
  draft?: boolean | undefined;
};

export function salesOrderSheet(args: OrderArgs & { so: SalesOrderDetail }): SheetPrintModel {
  const { so } = args;
  return orderSheet(args, {
    doc: 'SO',
    title: 'Sales Order',
    code: so.code,
    date: so.soDate,
    clientPoNo: so.clientPoNo,
    customerName: so.customerName,
    priceHidden: so.priceVisible === false,
    totals: so.totals ?? null,
    placeOfSupply: so.totals?.placeOfSupply ?? so.placeOfSupply,
    cancelled: so.status === 'cancelled',
    // The saved totals leave cancelled lines out (computeSoTotals), so the
    // printed rows do too — rows, Total Qty and Subtotal must agree.
    lines: so.lines.filter((l) => l.status !== 'cancelled'),
    fields: [
      { label: 'SO No.', value: so.code, variant: 'mono', strong: true },
      ...(so.internalSoNo
        ? [{ label: 'Internal SO No.', value: so.internalSoNo, variant: 'mono' } as const]
        : []),
      { label: 'SO Type', value: SO_TYPE_LABEL[so.type] ?? so.type },
      { label: 'Client PO No.', value: so.clientPoNo ?? '', variant: 'mono' },
      { label: 'SO Date', value: challanDate(so.soDate), variant: 'mono' },
      { label: 'SO Status', value: SO_STATUS_LABEL[so.status] ?? so.status },
      { label: 'Our Contact Person', value: so.createdByName ?? '—' },
    ],
  });
}

export function jwSalesOrderSheet(args: OrderArgs & { jw: JobWorkOrderDetail }): SheetPrintModel {
  const { jw } = args;
  return orderSheet(args, {
    doc: 'JWSO',
    title: 'JW Sales Order',
    code: jw.code,
    date: jw.jwDate,
    clientPoNo: jw.clientPoNo,
    customerName: jw.customerName,
    priceHidden: jw.priceVisible === false,
    totals: jw.totals ?? null,
    placeOfSupply: jw.totals?.placeOfSupply ?? jw.placeOfSupply,
    cancelled: jw.status === 'cancelled',
    // The server's totals leave cancelled lines out, so the printed rows do too.
    lines: jw.lines.filter((l) => l.status !== 'cancelled'),
    fields: [
      { label: 'JWSO No.', value: jw.code, variant: 'mono', strong: true },
      { label: 'Client PO No.', value: jw.clientPoNo ?? '', variant: 'mono' },
      { label: 'JWSO Date', value: challanDate(jw.jwDate), variant: 'mono' },
      { label: 'JWSO Status', value: SO_STATUS_LABEL[jw.status] ?? jw.status },
    ],
  });
}

type OrderLine = {
  itemCode?: string | null;
  itemCodeText: string | null;
  revision: string;
  clientPoLineNo: string | null;
  partName: string;
  uom: string;
  orderQty: number;
  rate: string | null;
  remarks: string | null;
};

function orderSheet(
  args: OrderArgs,
  o: {
    doc: 'SO' | 'JWSO';
    title: string;
    code: string;
    date: string;
    clientPoNo: string | null;
    customerName: string | null;
    priceHidden: boolean;
    totals: SoTotals | null;
    placeOfSupply: string | null;
    /** ADR-235 — a cancelled order prints with the CANCELLED stamp. */
    cancelled: boolean;
    lines: OrderLine[];
    fields: SheetField[];
  },
): SheetPrintModel {
  const { client, company, templates } = args;
  // Price hidden: the sheet drops the Rate / Amount columns and the money
  // block (`hideMoney`); `{totalValue}` prints blank, never a dash.
  const money = (n: number): string => (o.priceHidden ? '' : inrFormat(n));

  const t = o.priceHidden ? null : o.totals;
  const totalQty = o.lines.reduce((s, l) => s + l.orderQty, 0);
  const uoms = [...new Set(o.lines.map((l) => l.uom))];

  const party = partyForPrint(null, client, o.customerName);
  const recipientFields: SheetField[] = [
    { label: 'Customer Code', value: party.code, variant: 'mono' },
    { label: 'Name', value: party.name, variant: 'name' },
    {
      label: 'Address',
      value: party.addressLines[0] ?? '',
      ...(party.addressLines.length > 1 ? { extra: party.addressLines.slice(1) } : {}),
    },
    { label: 'GSTIN', value: party.gstNumber, variant: 'mono' },
  ];
  if (party.stateLine) recipientFields.push({ label: 'State', value: party.stateLine });
  if (o.placeOfSupply)
    recipientFields.push({ label: 'Place of Supply', value: placeOfSupplyLabel(o.placeOfSupply) });
  if (party.contact) recipientFields.push({ label: 'Contact', value: party.contact });

  const model: SheetPrintModel = {
    title: o.title,
    windowTitle: `${o.title} ${o.code}`,
    columns: 'po',
    hidePreparedBy: true,
    draft: args.draft,
    cancelled: o.cancelled,
    blocks: templatesToBlocks(o.doc, templates),
    data: {
      companyName: company?.name ?? '',
      companyAddress: COMPANY_CARD_ADDRESS_LINES.join(' '),
      companyGSTIN: company?.gstNumber ?? '',
      companyPhone: company?.phone ?? '',
      companyEmail: company?.email ?? '',
      date: fmtDate(todayIst()),
      currentUser: args.currentUser ?? '',
      orderNo: o.code,
      orderDate: fmtDate(o.date),
      clientPoNo: o.clientPoNo ?? '',
      clientName: party.name,
      clientAddress: party.addressLines.join(', '),
      clientGSTIN: party.gstNumber,
      clientContact: party.contact,
      totalQty: String(totalQty),
      // Hidden → blank. Visible but no saved totals (an old order) → the dash
      // that says "not worked out", as before.
      totalValue: t ? money(t.grandTotal) : o.priceHidden ? '' : '—',
    },
    company: { ...buildDocCompany(company), addressLines: [...COMPANY_CARD_ADDRESS_LINES] },
    recipient: { label: 'Customer', fields: recipientFields },
    document: { label: 'Order', fields: o.fields },
    lines: o.lines.map((l) => ({
      itemCode: itemCodeWithRev(l.itemCode ?? l.itemCodeText, l.revision, ''),
      pol: l.clientPoLineNo,
      itemName: l.partName,
      uom: l.uom,
      qty: String(l.orderQty),
      rate: money(Number(l.rate ?? 0)),
      amount: money(l.orderQty * Number(l.rate ?? 0)),
      description: l.remarks,
      descLabel: 'Remarks',
    })),
    totalQty: String(totalQty),
    totalUom: uoms.length === 1 ? (uoms[0] ?? '') : '',
    hideMoney: o.priceHidden,
    ...(t
      ? {
          money: {
            subtotal: money(t.subtotal),
            taxRows: [
              ...gstTaxRows(t).map((r) => ({ label: r.label, value: money(r.amount) })),
              { label: 'Round-off', value: signedRoundOff(t.roundOff) },
            ],
            grand: money(t.grandTotal),
            amountInWords: amountInWords(t.grandTotal),
          },
        }
      : {}),
  };
  return model;
}
