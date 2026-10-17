// Sales Order / JW Sales Order print (owner 2026-10-17: "per SO no. / JWSO no.
// user can preview, print, download — refer to PO print"). Same sheet as the
// PO (`@/lib/print/sheet-print`); the party is the CUSTOMER, and the money is
// the order's one GST %. Presentation only — the SO prints its SAVED totals
// (the detail page's figures); a JWSO has no stored roll-up, so it prints
// Σ qty × rate + GST, the same sum its detail page shows as Value.

import type {
  Client,
  Company,
  EffectivePrintTemplate,
  JobWorkOrderDetail,
  SalesOrderDetail,
} from '@innovic/shared';
import { todayIst } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { COMPANY_CARD_ADDRESS_LINES, buildDocCompany } from '@/lib/print/company';
import { amountInWords, fmtDate, inrFormat, templatesToBlocks } from '@/lib/print/doc-print';
import { partyForPrint } from '@/lib/print/party-copy';
import {
  type SheetField,
  type SheetPrintModel,
  challanDate,
  openSheetPrintWindow,
} from '@/lib/print/sheet-print';
import { SO_STATUS_LABEL, SO_TYPE_LABEL } from './so-status-label';

type OrderArgs = {
  client: Client | null | undefined;
  company: Company | null | undefined;
  templates: EffectivePrintTemplate[];
  currentUser?: string | undefined;
  /** ADR-202 — an edit is pending: the sheet prints "Draft — awaiting approval". */
  draft?: boolean | undefined;
};

export function printSalesOrder(args: OrderArgs & { so: SalesOrderDetail }): boolean {
  const { so } = args;
  return printOrder(args, {
    doc: 'SO',
    title: 'Sales Order',
    code: so.code,
    date: so.soDate,
    clientPoNo: so.clientPoNo,
    customerName: so.customerName,
    priceHidden: so.priceVisible === false,
    gstPercent: so.totals?.gstPercent ?? Number(so.gstPercent ?? 0),
    totals: so.totals ?? null,
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

export function printJwSalesOrder(args: OrderArgs & { jw: JobWorkOrderDetail }): boolean {
  const { jw } = args;
  return printOrder(args, {
    doc: 'JWSO',
    title: 'JW Sales Order',
    code: jw.code,
    date: jw.jwDate,
    clientPoNo: jw.clientPoNo,
    customerName: jw.customerName,
    priceHidden: jw.priceVisible === false,
    gstPercent: Number(jw.gstPercent ?? 0),
    totals: null,
    lines: jw.lines,
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

function printOrder(
  args: OrderArgs,
  o: {
    doc: 'SO' | 'JWSO';
    title: string;
    code: string;
    date: string;
    clientPoNo: string | null;
    customerName: string | null;
    priceHidden: boolean;
    gstPercent: number;
    totals: { subtotal: number; gstAmount: number; grandTotal: number } | null;
    lines: OrderLine[];
    fields: SheetField[];
  },
): boolean {
  const { client, company, templates } = args;
  const money = (n: number): string => (o.priceHidden ? '—' : inrFormat(n));

  const lineSubtotal = o.lines.reduce((s, l) => s + l.orderQty * Number(l.rate ?? 0), 0);
  const subtotal = o.totals?.subtotal ?? Number(lineSubtotal.toFixed(2));
  const tax = o.totals?.gstAmount ?? Number(((subtotal * o.gstPercent) / 100).toFixed(2));
  const grand = o.totals?.grandTotal ?? subtotal + tax;
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
  if (party.contact) recipientFields.push({ label: 'Contact', value: party.contact });

  const model: SheetPrintModel = {
    title: o.title,
    windowTitle: `${o.title} ${o.code}`,
    columns: 'po',
    hidePreparedBy: true,
    draft: args.draft,
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
      totalValue: money(grand),
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
    ...(o.priceHidden
      ? {}
      : {
          money: {
            subtotal: money(subtotal),
            taxRows:
              o.gstPercent > 0 ? [{ label: `GST @ ${o.gstPercent}%`, value: money(tax) }] : [],
            grand: money(grand),
            amountInWords: amountInWords(grand),
          },
        }),
  };
  return openSheetPrintWindow(model);
}
