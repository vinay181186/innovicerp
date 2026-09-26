// Tax-invoice document — ports legacy _printInvoice (L21314).
//
// It renders on `@/lib/print/sheet-print` — THE INNOVIC SHEET, the same paper
// as the Delivery Challan, Purchase Order, GRN and JW Invoice (one letterhead,
// one type scale, one table, Times). It used to be its own boxed layout with a
// "TAX INVOICE" banner; every print document now renders on the sheet.
// `invoiceSheetHtml` is also what the detail page previews (screen = print).
// GST split: home state (GSTIN prefix 24/Gujarat) → SGST+CGST, else IGST.
//
// Known gaps vs legacy (need a shared/API change — do NOT stub):
//  - Bill To omits the client's ADDRESS; InvoiceDetail carries no address field.
//  - There is no 'INVOICE' print-template doc type yet, so no special notes /
//    terms / footer blocks print; the sheet's own signatory line does.

import type { Company, InvoiceDetail } from '@innovic/shared';
import { itemCodeWithRev } from '@/lib/item-code';
import { buildDocCompany } from '@/lib/print/company';
import { inrFormat } from '@/lib/print/doc-print';
import {
  type SheetField,
  type SheetPrintModel,
  buildSheetHtml,
  challanDate,
  openSheetPrintWindow,
} from '@/lib/print/sheet-print';

const FALLBACK_UOM = 'NOS';

const STATE_MAP: Record<string, string> = {
  '24': 'Gujarat',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '33': 'Tamil Nadu',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '07': 'Delhi',
  '09': 'Uttar Pradesh',
  '08': 'Rajasthan',
};

// numWords stays local: the shared amountInWords() appends paise ("… and Fifty
// Paise"), but legacy _printInvoice L21324 words only Math.floor(grandTotal).
// Reusing the shared one would change what the invoice prints.
function numWords(num: number): string {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
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
function invoiceSheetModel(inv: InvoiceDetail, company: Company | null | undefined): SheetPrintModel {
  const gst = inv.clientGst ?? '';
  const stateCode = gst ? gst.substring(0, 2) : '24';
  const isIGST = stateCode !== '24';
  // Money hidden for L1 Viewers: TOLD by the server (priceVisible), never
  // inferred from a null money field. Rate / Amount print an em dash and no
  // money block or amount-in-words follows.
  const priceHidden = inv.priceVisible === false;
  const money = (n: number | null | undefined): string => (priceHidden ? '—' : inrFormat(n ?? 0));
  const gstPct = inv.gstPercent ?? 0;
  const gstAmount = inv.gstAmount ?? 0;
  const taxRows = isIGST
    ? [{ label: `IGST @ ${gstPct}%`, value: money(gstAmount) }]
    : [
        { label: `SGST @ ${gstPct / 2}%`, value: money(gstAmount / 2) },
        { label: `CGST @ ${gstPct / 2}%`, value: money(gstAmount / 2) },
      ];

  const uoms = new Set(inv.lines.map((l) => l.uom?.trim() || FALLBACK_UOM));
  const totalQty = inv.lines.reduce((sum, l) => sum + l.qty, 0);
  // Quantities print rounded to 2 dp with no trailing zeros: 12, 2.5, 0.33 --
  // a float sum (0.1 + 0.2) must not print as 0.30000000000000004.
  const qtyText = (n: number): string => String(Math.round(n * 100) / 100);

  const recipientFields: SheetField[] = [
    { label: 'Customer Code', value: inv.clientCode ?? '', variant: 'mono' },
    { label: 'Name', value: inv.clientName ?? '', variant: 'name' },
    { label: 'GSTIN', value: gst, variant: 'mono' },
  ];
  if (STATE_MAP[stateCode]) {
    recipientFields.push({ label: 'State', value: `${STATE_MAP[stateCode]}, Code: ${stateCode}` });
  }

  const documentFields: SheetField[] = [
    { label: 'Invoice No.', value: inv.code, variant: 'mono', strong: true },
    { label: 'Invoice Date', value: challanDate(inv.invoiceDate), variant: 'mono' },
    { label: 'SO No.', value: inv.soCode ?? '', variant: 'mono' },
    ...(inv.clientPoNo
      ? [{ label: 'Client PO No.', value: inv.clientPoNo, variant: 'mono' as const }]
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
      uom: l.uom?.trim() || FALLBACK_UOM,
      qty: qtyText(l.qty),
      rate: money(l.rate),
      amount: money(l.lineAmount),
    })),
    totalQty: qtyText(totalQty),
    totalUom: uoms.size === 1 ? [...uoms][0] ?? '' : '',
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
