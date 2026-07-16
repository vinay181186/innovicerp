// Tax-invoice document — ports legacy _printInvoice (L21314, line verified).
// `invoiceDocHtml` builds the full A4-portrait document (inline styles only)
// so the SAME markup renders as the on-screen preview on the invoice detail
// page AND in the print window (user direction 2026-06-06: screen = print).
// GST split: home state (GSTIN prefix 24/Gujarat) → SGST+CGST, else IGST.
//
// NOT a verbatim mirror. Verified deltas against L21314-21375:
//  - Company header/footer come from letterheadHeaderHtml/FooterHtml (the
//    companies row) instead of legacy's hardcoded "INNOVIC TECHNOLOGY" block
//    (L21349-21352). Deliberate: user direction 2026-06-06 names Invoice as a
//    full-letterhead doc (lib/print/letterhead.ts). Legacy has no footer strip.
//  - @page pins A4 portrait; legacy only set margins (L21338).
// Known GAPS vs legacy (reported, need a shared/API change — do NOT stub):
//  - Bill To omits the client's ADDRESS. Legacy prints it (L21355) from the
//    clients row; InvoiceDetail carries clientCode but no address field.
//  - The signature block omits legacy's left "PAN: AQKPM4121A / E. & O.E."
//    (L21371). `companies` has no PAN column, and hardcoding it would fight the
//    letterhead direction ("text comes from the companies row").
//  - Dates print as raw ISO; legacy uses fmt() → "15 Jul 26" (L21360/21363).

import type { Company, InvoiceDetail } from '@innovic/shared';
import { companyAddressLines } from '@/lib/print/company';
import { inrFormat } from '@/lib/print/doc-print';
import { letterheadFooterHtml, letterheadHeaderHtml } from '@/lib/print/letterhead';

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

const esc = (s: string): string =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);

const TD = 'border:1px solid #999;padding:5px 6px;font-size:11px';
const TH = 'background:#f0f0f0;border:1px solid #999;padding:5px 6px;font-size:10px;font-weight:700;text-align:center';

// The full invoice document (white sheet, black text, inline styles only).
// Rendered 1:1 on the detail page preview and in the print window.
export function invoiceDocHtml(inv: InvoiceDetail, company: Company | null | undefined): string {
  const gst = inv.clientGst ?? '';
  const stateCode = gst ? gst.substring(0, 2) : '24';
  const isIGST = stateCode !== '24';
  const amtWords = `Indian Rupees ${numWords(Math.floor(inv.grandTotal))} Only`;
  const coName = company?.name ?? 'Innovic Technology';
  const coAddr = companyAddressLines(company);

  const lineRows = inv.lines
    .map(
      (l, i) =>
        `<tr><td style="${TD};text-align:center">${i + 1}</td>` +
        `<td style="${TD}">${esc(l.itemCode ?? l.itemName)}<br><span style="font-size:10px;color:#666">${esc(l.itemName)}</span></td>` +
        `<td style="${TD};text-align:right">${l.qty.toFixed(1)}</td>` +
        `<td style="${TD};text-align:center;font-size:10px">NOS</td>` +
        `<td style="${TD};text-align:right">${inrFormat(l.rate)}</td>` +
        `<td style="${TD};text-align:right;font-weight:700">${inrFormat(l.lineAmount)}</td></tr>`,
    )
    .join('');

  const taxRows = isIGST
    ? `<tr><td colspan="5" style="${TD};text-align:right">IGST @ ${inv.gstPercent}%</td><td style="${TD};text-align:right">${inrFormat(inv.gstAmount)}</td></tr>`
    : `<tr><td colspan="5" style="${TD};text-align:right">SGST @ ${inv.gstPercent / 2}%</td><td style="${TD};text-align:right">${inrFormat(inv.gstAmount / 2)}</td></tr>` +
      `<tr><td colspan="5" style="${TD};text-align:right">CGST @ ${inv.gstPercent / 2}%</td><td style="${TD};text-align:right">${inrFormat(inv.gstAmount / 2)}</td></tr>`;

  return `<div style="background:#fff;color:#1e293b;font-family:Arial,sans-serif;font-size:11px;line-height:1.35;padding:18px">
    <div style="border:2px solid #333">
      ${letterheadHeaderHtml({ name: coName, gstin: company?.gstNumber })}
      <div style="text-align:center;padding:8px;border-bottom:2px solid #333;font-size:17px;font-weight:900;letter-spacing:2px">TAX INVOICE</div>
      <div style="display:flex;border-bottom:1px solid #999">
        <div style="flex:1;padding:8px 10px;font-size:10px;border-right:1px solid #999">
          <div style="font-weight:700;font-size:11px;text-decoration:underline;margin-bottom:3px">Bill To</div>
          <div style="font-weight:700;font-size:12px">${esc(inv.clientName ?? '')}</div>
          ${gst ? `<div>GSTIN: <b>${esc(gst)}</b></div>` : ''}
          ${STATE_MAP[stateCode] ? `<div>State: ${STATE_MAP[stateCode]}, Code: ${stateCode}</div>` : ''}
        </div>
        <div style="flex:1;padding:8px 10px;font-size:10px">
          <div style="font-weight:700;font-size:11px;text-decoration:underline;margin-bottom:3px">Invoice Details</div>
          <div style="font-weight:700;font-size:14px;color:#1a5276">${esc(inv.code)}</div>
          <div>Date: ${esc(inv.invoiceDate)}</div>
          <div>SO Ref: <b>${esc(inv.soCode ?? '')}</b></div>
          <div>Payment: ${inv.paymentTermsDays} Days</div>
          <div>Due: <b>${esc(inv.dueDate ?? '')}</b></div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr><th style="${TH}">Sl</th><th style="${TH};text-align:left">Description</th><th style="${TH}">Qty</th><th style="${TH}">UOM</th><th style="${TH}">Rate</th><th style="${TH}">Amount</th></tr></thead>
        <tbody>${lineRows}
          <tr style="font-weight:700;background:#f5f5f5"><td colspan="5" style="${TD};text-align:right">Subtotal</td><td style="${TD};text-align:right">${inrFormat(inv.subtotal)}</td></tr>
          ${taxRows}
          <tr><td colspan="5" style="border:2px solid #333;padding:5px 6px;font-weight:900;font-size:12px;background:#f5f5f5;text-align:right">Total</td><td style="border:2px solid #333;padding:5px 6px;font-weight:900;font-size:12px;background:#f5f5f5;text-align:right">₹ ${inrFormat(inv.grandTotal)}</td></tr>
        </tbody>
      </table>
      <div style="padding:8px 10px;border-top:1px solid #999;font-size:10px"><b>Amount in Words:</b> <i>${esc(amtWords)}</i></div>
      <div style="padding:15px 10px;display:flex;justify-content:flex-end;border-top:1px solid #999">
        <div style="text-align:right">
          <div style="font-weight:700">for ${esc(coName)}</div>
          <div style="margin-top:40px;border-top:1px solid #333;padding-top:4px;font-size:10px">Authorised Signatory</div>
        </div>
      </div>
      ${letterheadFooterHtml({ addressLines: coAddr, email: company?.email, phone: company?.phone })}
    </div>
    <div style="text-align:center;font-size:9px;color:#999;margin-top:8px">This is a Computer Generated Invoice</div>
  </div>`;
}

// Print window: A4 PORTRAIT pinned via @page, same document markup as the
// on-screen preview.
export function printInvoice(inv: InvoiceDetail, company: Company | null | undefined): void {
  const w = window.open('', '_blank', 'width=850,height=900');
  if (!w) return;
  w.document.write(
    `<!DOCTYPE html><html><head><title>Invoice ${esc(inv.code)}</title>` +
      `<style>@page{size:A4 portrait;margin:10mm}*{margin:0;padding:0;box-sizing:border-box}body{background:#fff}` +
      `@media print{.no-print{display:none!important}}` +
      `.print-btn{position:fixed;top:10px;right:10px;background:#1a5276;color:#fff;border:none;padding:10px 24px;font-size:14px;cursor:pointer;border-radius:6px;font-weight:700}</style></head><body>` +
      `<button class="print-btn no-print" onclick="window.print()">🖨 Print</button>` +
      invoiceDocHtml(inv, company) +
      `</body></html>`,
  );
  w.document.close();
}
