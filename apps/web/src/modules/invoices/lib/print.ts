// Tax-invoice print — mirror of legacy _printInvoice (L21314). Opens a print
// window. GST split: home state (GSTIN prefix 24/Gujarat) → SGST+CGST, else IGST.

import type { InvoiceDetail } from '@innovic/shared';

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

function inr(v: number): string {
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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

export function printInvoice(inv: InvoiceDetail): void {
  const gst = inv.clientGst ?? '';
  const stateCode = gst ? gst.substring(0, 2) : '24';
  const isIGST = stateCode !== '24';
  const amtWords = `Indian Rupees ${numWords(Math.floor(inv.grandTotal))} Only`;

  const lineRows = inv.lines
    .map(
      (l, i) =>
        `<tr><td style="text-align:center;border:1px solid #999;padding:5px">${i + 1}</td>` +
        `<td style="border:1px solid #999;padding:5px">${esc(l.itemCode ?? l.itemName)}<br><span style="font-size:10px;color:#666">${esc(l.itemName)}</span></td>` +
        `<td style="text-align:right;border:1px solid #999;padding:5px">${l.qty}</td>` +
        `<td style="text-align:center;border:1px solid #999;padding:5px;font-size:10px">NOS</td>` +
        `<td style="text-align:right;border:1px solid #999;padding:5px">${inr(l.rate)}</td>` +
        `<td style="text-align:right;border:1px solid #999;padding:5px;font-weight:700">${inr(l.lineAmount)}</td></tr>`,
    )
    .join('');

  const taxRows = isIGST
    ? `<tr><td colspan="5" style="text-align:right;border:1px solid #999;padding:5px">IGST @ ${inv.gstPercent}%</td><td style="text-align:right;border:1px solid #999;padding:5px">${inr(inv.gstAmount)}</td></tr>`
    : `<tr><td colspan="5" style="text-align:right;border:1px solid #999;padding:5px">SGST @ ${inv.gstPercent / 2}%</td><td style="text-align:right;border:1px solid #999;padding:5px">${inr(inv.gstAmount / 2)}</td></tr>` +
      `<tr><td colspan="5" style="text-align:right;border:1px solid #999;padding:5px">CGST @ ${inv.gstPercent / 2}%</td><td style="text-align:right;border:1px solid #999;padding:5px">${inr(inv.gstAmount / 2)}</td></tr>`;

  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  w.document.write(
    `<!DOCTYPE html><html><head><title>Invoice ${esc(inv.code)}</title>` +
      `<style>@media print{@page{margin:8mm 10mm}body{margin:0}.no-print{display:none!important}}body{font-family:Arial,sans-serif;font-size:11px;color:#1e293b;margin:15px;line-height:1.35}` +
      `.po-border{border:2px solid #333}.po-header{text-align:center;padding:10px;border-bottom:2px solid #333;font-size:18px;font-weight:900;letter-spacing:2px}` +
      `.addr-row{display:flex;border-bottom:1px solid #999}.addr-box{flex:1;padding:8px 10px;font-size:10px}.addr-box:first-child{border-right:1px solid #999}` +
      `.addr-lbl{font-weight:700;font-size:11px;text-decoration:underline}table{width:100%;border-collapse:collapse;font-size:10px}` +
      `th{background:#f0f0f0;padding:5px 6px;border:1px solid #999;font-size:9px;font-weight:700;text-align:center}` +
      `.grand-row td{border:2px solid #333;padding:5px 6px;font-weight:900;font-size:12px;background:#f5f5f5}` +
      `.print-btn{position:fixed;top:10px;right:10px;background:#1a5276;color:#fff;border:none;padding:10px 24px;font-size:14px;cursor:pointer;border-radius:6px;font-weight:700}</style></head><body>` +
      `<button class="print-btn no-print" onclick="window.print()">🖨 Print</button>` +
      `<div class="po-border"><div class="po-header">TAX INVOICE</div>` +
      `<div class="addr-row"><div class="addr-box"><div class="addr-lbl">Bill To</div><div style="font-weight:700;font-size:12px">${esc(inv.clientName ?? '')}</div>` +
      (gst ? `<div>GSTIN: <b>${esc(gst)}</b></div>` : '') +
      (STATE_MAP[stateCode] ? `<div>State: ${STATE_MAP[stateCode]}, Code: ${stateCode}</div>` : '') +
      `</div><div class="addr-box"><div class="addr-lbl">Invoice Details</div>` +
      `<div style="font-weight:700;font-size:14px;color:#1a5276">${esc(inv.code)}</div>` +
      `<div>Date: ${esc(inv.invoiceDate)}</div><div>SO Ref: <b>${esc(inv.soCode ?? '')}</b></div>` +
      `<div>Payment: ${inv.paymentTermsDays} Days</div><div>Due: <b>${esc(inv.dueDate ?? '')}</b></div></div></div>` +
      `<table><thead><tr><th>Sl</th><th style="text-align:left">Description</th><th>Qty</th><th>UOM</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${lineRows}` +
      `<tr style="font-weight:700;background:#f5f5f5"><td colspan="5" style="text-align:right;border:1px solid #999;padding:5px">Subtotal</td><td style="text-align:right;border:1px solid #999;padding:5px">${inr(inv.subtotal)}</td></tr>` +
      taxRows +
      `<tr class="grand-row"><td colspan="5" style="text-align:right">Total</td><td style="text-align:right">₹ ${inr(inv.grandTotal)}</td></tr></tbody></table>` +
      `<div style="padding:8px 10px;border-top:1px solid #999;font-size:10px"><b>Amount in Words:</b> <i>${esc(amtWords)}</i></div>` +
      `<div style="padding:15px 10px;display:flex;justify-content:flex-end;border-top:1px solid #999"><div style="text-align:right"><div style="font-weight:700">for Innovic Technology</div><div style="margin-top:40px;border-top:1px solid #333;padding-top:4px;font-size:10px">Authorised Signatory</div></div></div></div>` +
      `<div style="text-align:center;font-size:9px;color:#999;margin-top:8px">This is a Computer Generated Invoice</div></body></html>`,
  );
  w.document.close();
}
