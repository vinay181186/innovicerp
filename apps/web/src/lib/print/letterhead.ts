// Company letterhead for printed documents (user direction 2026-06-06, visual
// spec = Screen shots/Innovic.docx):
//   - OUTWARD/transaction docs (PO, Service PO, OSP DC, JW DC, Invoice) get the
//     FULL letterhead — logo header + footer line with address / e-mail / M:.
//   - INTERNAL docs (Job Card, registers, reports via print-window) get the
//     LOGO only (no footer strip).
// Text comes from the `companies` row — change it in System Settings and every
// document follows.

import { INNOVIC_LOGO_DATA_URI } from './letterhead-logo';

const escape = (s: string): string =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c);

export function letterheadLogoHtml(heightPx = 44): string {
  return `<img src="${INNOVIC_LOGO_DATA_URI}" alt="INNOVIC" style="height:${heightPx}px;display:block"/>`;
}

// Full letterhead header — logo left, company name + GSTIN right of it.
export function letterheadHeaderHtml(args: {
  name: string;
  gstin?: string | null | undefined;
}): string {
  return `<div style="display:flex;align-items:center;gap:16px;padding:12px 14px;border-bottom:2px solid #333">
    ${letterheadLogoHtml(48)}
    <div style="flex:1;text-align:right">
      <div style="font-size:19px;font-weight:900;color:#1E4DB3;line-height:1.1">${escape(args.name)}</div>
      ${args.gstin ? `<div style="font-size:10px;color:#475569;margin-top:2px">GSTIN: <b>${escape(args.gstin)}</b></div>` : ''}
    </div>
  </div>`;
}

// Footer strip per the docx letterhead: Address … | e-mail | M:.
export function letterheadFooterHtml(args: {
  addressLines: string[];
  email?: string | null | undefined;
  phone?: string | null | undefined;
}): string {
  const addr = args.addressLines.filter(Boolean).join(', ');
  const parts = [
    addr ? `<b>Address:</b> ${escape(addr)}` : '',
    args.email ? `<b>e-mail:</b> ${escape(args.email)}` : '',
    args.phone ? `<b>M:</b> ${escape(args.phone)}` : '',
  ].filter(Boolean);
  if (parts.length === 0) return '';
  return `<div style="border-top:2px solid #1E4DB3;margin-top:2px;padding:6px 10px;text-align:center;font-size:9.5px;color:#334155">
    ${parts.join(' &nbsp;·&nbsp; ')}
  </div>`;
}
