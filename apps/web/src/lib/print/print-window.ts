// Shared print-window for fixed-layout documents (Print Templates P3,
// ADR-034). Mirrors legacy `printWindow(title, bodyHtml)` (L10524): opens a
// window, writes the standard stylesheet + company header + Print/Close
// buttons, then the caller's body HTML. Unlike the P2 template documents
// (PO/DC), these layouts are hard-coded per document — they do NOT use the
// editor templates. Callers build `body` HTML using the CSS classes defined
// in PRINT_STYLE (doc-title / info-grid / info-box / h2 / table / badge /
// sign-row).
//
// DELTA vs legacy: the company header is text-only (no embedded base64 logo)
// and pulls name/address/GSTIN from the `companies` row at print time, not a
// hard-coded block.

import type { Company } from '@innovic/shared';
import { companyAddressLines } from './company';
import { esc } from './doc-print';

const PRINT_STYLE = `
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:18px}
  .company-hdr{display:flex;align-items:center;gap:16px;border-bottom:3px solid #1a3a6b;padding-bottom:10px;margin-bottom:14px}
  .co-mark{font-size:26px;font-weight:900;color:#1a3a6b;letter-spacing:.04em}
  .company-right{flex:1}
  .co-name-big{font-size:22px;font-weight:900;color:#1a3a6b;letter-spacing:.02em;line-height:1.1}
  .co-addr{font-size:11px;color:#555;margin-top:2px}
  .doc-title{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:12px;border-bottom:1px solid #ddd;padding-bottom:8px}
  .doc-title h1{font-size:16px;font-weight:700;color:#1a3a6b}
  .doc-title .print-meta{font-size:11px;color:#888}
  h2{font-size:13px;font-weight:700;margin:14px 0 6px;padding:4px 8px;background:#f1f5f9;border-left:3px solid #1a3a6b}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  th{background:#1a3a6b;color:#fff;padding:5px 8px;text-align:left;font-size:11px}
  td{padding:5px 8px;border-bottom:1px solid #e5e7eb;font-size:11px;vertical-align:top}
  tr:nth-child(even) td{background:#f8fafc}
  .badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:10px;font-weight:700}
  .b-green{background:#dcfce7;color:#16a34a}.b-amber{background:#fef3c7;color:#d97706}
  .b-blue{background:#dbeafe;color:#1d4ed8}.b-grey{background:#f3f4f6;color:#6b7280}
  .b-red{background:#fee2e2;color:#dc2626}.b-cyan{background:#cffafe;color:#0369a1}
  .b-purple{background:#ede9fe;color:#7c3aed}
  .info-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
  .info-box{border:1px solid #e5e7eb;border-radius:6px;padding:10px}
  .info-lbl{font-size:9px;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px}
  .info-val{font-size:14px;font-weight:700}
  .sign-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:36px}
  .sign-box{border-top:1px solid #333;padding-top:6px;text-align:center;font-size:11px;color:#666}
  .no-print{margin-bottom:12px}
  @media print{.no-print{display:none}body{padding:10px}}
`;

function companyHeader(company: Company | null | undefined): string {
  const name = company?.name ?? 'Innovic Technology';
  const addr = companyAddressLines(company);
  return `<div class="company-hdr">
    <div class="co-mark">INNOVIC</div>
    <div class="company-right">
      <div class="co-name-big">${esc(name)}</div>
      ${addr.map((l) => `<div class="co-addr">${esc(l)}</div>`).join('')}
      ${company?.gstNumber ? `<div class="co-addr">GSTIN: ${esc(company.gstNumber)}</div>` : ''}
    </div>
  </div>`;
}

// Opens the print window. `body` is raw HTML using PRINT_STYLE's classes.
// Returns false if the popup was blocked.
export function printWindow(args: {
  title: string;
  body: string;
  company: Company | null | undefined;
}): boolean {
  const w = window.open('', '_blank', 'width=980,height=740');
  if (!w) return false;
  w.document.write(
    `<!DOCTYPE html><html><head><title>${esc(args.title)}</title><style>${PRINT_STYLE}</style></head><body>
      <div class="no-print">
        <button onclick="window.print()" style="padding:7px 20px;background:#1a3a6b;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:13px;margin-right:8px">🖨 Print</button>
        <button onclick="window.close()" style="padding:7px 14px;background:#f3f4f6;border:1px solid #d1d5db;border-radius:5px;cursor:pointer;font-size:13px">✕ Close</button>
      </div>
      ${companyHeader(args.company)}
      ${args.body}
    </body></html>`,
  );
  w.document.close();
  return true;
}

// Convenience for "Printed: <now>" meta + section markup.
export function printedMeta(): string {
  return `Printed: ${new Date().toLocaleString()}`;
}
