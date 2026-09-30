// Tax-invoice document — ports legacy _printInvoice (L21314).
//
// It renders on `@/lib/print/sheet-print` — THE INNOVIC SHEET, the same paper
// as the Delivery Challan, Purchase Order, GRN and JW Invoice (one letterhead,
// one type scale, one table, Times). It used to be its own boxed layout with a
// "TAX INVOICE" banner; every print document now renders on the sheet.
// `invoiceSheetHtml` is also what the detail page previews (screen = print).
// GST split: the invoice's Tax Type (0171). An older invoice without one prints
// a single "GST" row — no state is guessed (plan D2; the old '24 Gujarat'
// fallback is gone).
//
// Bill To prints the customer as BILLED — the invoice's own legal copy (0186,
// plan D7; the API falls back to the master only for an invoice with no copy)
// — and each line its HSN (A4). Place of Supply prints when known; an unknown
// one is a screen-only note, never on this legal copy.
// UOM prints blank when neither the SO line nor the item has one: never 'NOS'.
//
// Known gap vs legacy:
//  - There is no 'INVOICE' print-template doc type yet, so no special notes /
//    terms / footer blocks print; the sheet's own signatory line does.

import {
  type Company,
  type InvoiceDetail,
  placeOfSupplyLabel,
  stateNameForCode,
} from '@innovic/shared';
import { itemCodeWithRev } from '@/lib/item-code';
import { buildDocCompany } from '@/lib/print/company';
import { inrFormat } from '@/lib/print/doc-print';
import { splitGst } from './gst-split';
import {
  type SheetField,
  type SheetPrintModel,
  buildSheetHtml,
  challanDate,
  openSheetPrintWindow,
} from '@/lib/print/sheet-print';

// numWords stays local: the shared amountInWords() appends paise ("… and Fifty
// Paise"), but legacy _printInvoice L21324 words only Math.floor(grandTotal).
// Reusing the shared one would change what the invoice prints.
function numWords(num: number): string {
  const a = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  if (num === 0) return 'Zero';
  let s = '';
  let n = num;
  if (Math.floor(n / 10000000) > 0) {
    s += `${numWords(Math.floor(n / 10000000))} Crore `;
    n %= 10000000;
  }
  if (Math.floor(n / 100000) > 0) {
    s += `${numWords(Math.floor(n / 100000))} Lakh `;
    n %= 100000;
  }
  if (Math.floor(n / 1000) > 0) {
    s += `${numWords(Math.floor(n / 1000))} Thousand `;
    n %= 1000;
  }
  if (Math.floor(n / 100) > 0) {
    s += `${numWords(Math.floor(n / 100))} Hundred `;
    n %= 100;
  }
  if (n > 0) {
    if (n < 20) s += a[n];
    else s += b[Math.floor(n / 10)] + (n % 10 > 0 ? ` ${a[n % 10]}` : '');
  }
  return s.trim();
}

/** The invoice as an Innovic Sheet print model. */
function invoiceSheetModel(
  inv: InvoiceDetail,
  company: Company | null | undefined,
): SheetPrintModel {
  const gst = inv.clientGst ?? '';
  // The invoice's own Tax Type (migration 0171) decides the split.
  // Money hidden for L1 Viewers: TOLD by the server (priceVisible), never
  // inferred from a null money field. Rate / Amount print an em dash and no
  // money block or amount-in-words follows.
  const priceHidden = inv.priceVisible === false;
  const money = (n: number | null | undefined): string => (priceHidden ? '—' : inrFormat(n ?? 0));
  const gstPct = inv.gstPercent ?? 0;
  const gstAmount = inv.gstAmount ?? 0;
  const taxRows =
    inv.taxType === 'igst'
      ? [{ label: `IGST @ ${gstPct}%`, value: money(gstAmount) }]
      : inv.taxType === 'sgst_cgst'
        ? [
            { label: `SGST @ ${gstPct / 2}%`, value: money(splitGst(gstAmount).sgst) },
            { label: `CGST @ ${gstPct / 2}%`, value: money(splitGst(gstAmount).cgst) },
          ]
        : [{ label: `GST @ ${gstPct}%`, value: money(gstAmount) }];

  const uoms = new Set(inv.lines.map((l) => l.uom?.trim() ?? ''));
  const totalQty = inv.lines.reduce((sum, l) => sum + l.qty, 0);
  // Quantities print rounded to 2 dp with no trailing zeros: 12, 2.5, 0.33 --
  // a float sum (0.1 + 0.2) must not print as 0.30000000000000004.
  const qtyText = (n: number): string => String(Math.round(n * 100) / 100);

  // Billing address: street, then "City – Pincode" (A1). State prints on its
  // own row below, with the GST state code.
  const addressLines = [
    inv.clientAddressLine1?.trim() ?? '',
    [inv.clientCity?.trim(), inv.clientPincode?.trim()].filter(Boolean).join(' – '),
  ].filter(Boolean);
  const recipientFields: SheetField[] = [
    { label: 'Customer Code', value: inv.clientCode ?? '', variant: 'mono' },
    { label: 'Name', value: inv.clientName ?? '', variant: 'name' },
    ...(addressLines.length > 0
      ? [
          {
            label: 'Address',
            value: addressLines[0] ?? '',
            ...(addressLines.length > 1 ? { extra: addressLines.slice(1) } : {}),
          },
        ]
      : []),
    { label: 'GSTIN', value: gst, variant: 'mono' },
  ];
  // State: the billed State with its State Code (the invoice's copy). Nothing
  // is printed when the State is not known — never a guessed one.
  const billedState = inv.clientState?.trim() || stateNameForCode(inv.clientStateCode) || '';
  if (billedState) {
    recipientFields.push({
      label: 'State',
      value: inv.clientStateCode ? `${billedState}, Code: ${inv.clientStateCode}` : billedState,
    });
  }

  const documentFields: SheetField[] = [
    { label: 'Invoice No.', value: inv.code, variant: 'mono', strong: true },
    { label: 'Invoice Date', value: challanDate(inv.invoiceDate), variant: 'mono' },
    { label: 'SO No.', value: inv.soCode ?? '', variant: 'mono' },
    ...(inv.clientPoNo
      ? [{ label: 'Client PO No.', value: inv.clientPoNo, variant: 'mono' as const }]
      : []),
    ...(inv.placeOfSupply
      ? [{ label: 'Place of Supply', value: placeOfSupplyLabel(inv.placeOfSupply) }]
      : []),
    { label: 'Payment Terms', value: `${inv.paymentTermsDays} Days` },
    { label: 'Due Date', value: challanDate(inv.dueDate), variant: 'mono' },
  ];

  return {
    title: 'Tax Invoice',
    windowTitle: `Invoice ${inv.code}`,
    columns: 'po',
    blocks: {},
    data: {},
    company: buildDocCompany(company),
    recipient: { label: 'Customer', fields: recipientFields },
    document: { label: 'Invoice', fields: documentFields },
    lines: inv.lines.map((l) => ({
      // CODE/REV — the customer's drawing revision rides on the code, the same
      // as the job card and the dispatch note.
      itemCode: itemCodeWithRev(l.itemCode ?? l.itemCodeText, l.itemRevision, ''),
      pol: l.clientPoLineNo ?? null,
      itemName: l.itemName,
      uom: l.uom?.trim() ?? '',
      hsn: l.hsnCode?.trim() || null,
      qty: qtyText(l.qty),
      rate: money(l.rate),
      amount: money(l.lineAmount),
    })),
    totalQty: qtyText(totalQty),
    totalUom: uoms.size === 1 ? ([...uoms][0] ?? '') : '',
    ...(priceHidden
      ? {}
      : {
          money: {
            subtotal: money(inv.subtotal),
            taxRows,
            grand: money(inv.grandTotal),
            // Whole rupees, as legacy printed it (see numWords above).
            amountInWords: `Indian Rupees ${numWords(Math.floor(inv.grandTotal ?? 0))} Only`,
          },
        }),
  };
}

/** The sheet markup (no <style>) — the detail page previews exactly this. */
export function invoiceSheetHtml(inv: InvoiceDetail, company: Company | null | undefined): string {
  return buildSheetHtml(invoiceSheetModel(inv, company));
}

/** Opens the print window. Returns false if the popup was blocked, so the
 *  caller can say so. */
export function printInvoice(inv: InvoiceDetail, company: Company | null | undefined): boolean {
  return openSheetPrintWindow(invoiceSheetModel(inv, company));
}
