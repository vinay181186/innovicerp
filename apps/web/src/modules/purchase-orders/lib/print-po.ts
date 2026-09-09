// Real-data Purchase Order print (Print Templates P2, ADR-034). Assembles a
// DocPrintModel from the loaded PO detail + vendor + company + the effective
// `po_*` template blocks, then opens the shared print window. Presentation
// only (DELTA #2) — totals/tax/amount-in-words are display formatting of data
// the API already returns, not new business rules. Mirrors legacy `printPO`
// (L25913): subtotal → IGST or SGST+CGST per taxType → grand → words.

import type { Company, EffectivePrintTemplate, PurchaseOrderDetail, Vendor } from '@innovic/shared';
import { buildDocCompany, companyAddressLines } from '@/lib/print/company';
import {
  type DocMetaCell,
  type DocPrintModel,
  amountInWords,
  fmtDate,
  inrFormat,
  openDocPrintWindow,
  templatesToBlocks,
} from '@/lib/print/doc-print';

export function printPurchaseOrder(args: {
  po: PurchaseOrderDetail;
  vendor: Vendor | null | undefined;
  company: Company | null | undefined;
  templates: EffectivePrintTemplate[];
  currentUser?: string | undefined;
}): boolean {
  const { po, vendor, company, templates } = args;
  const lines = po.lines;

  // Money is hidden for L1 Viewers: the API nulls the header total and line
  // rates. A printed PO must not leak what the screen hides, so every rupee
  // cell prints "—" and the amount-in-words is dropped.
  // TOLD, not inferred — same test the detail page makes (routes/detail.tsx
  // `priceVisible === false`). Probing `totalAmount == null` also caught POs
  // whose header roll-up was simply never filled, and printed "—" in every
  // rupee cell for a buyer fully entitled to see the price.
  const priceHidden = po.priceVisible === false;
  const money = (n: number): string => (priceHidden ? '—' : inrFormat(n));

  const subtotal = lines.reduce((s, l) => s + l.qty * Number(l.rate ?? 0), 0);
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);

  const sgstPct = Number(po.sgstPct) || 0;
  const cgstPct = Number(po.cgstPct) || 0;
  const igstPct = Number(po.igstPct) || 0;
  const isIgst = po.taxType === 'igst' || (igstPct > 0 && sgstPct === 0 && cgstPct === 0);

  const taxRows: DocMetaCell[] = [];
  let tax = 0;
  if (isIgst) {
    const amt = (subtotal * igstPct) / 100;
    tax += amt;
    if (igstPct > 0) taxRows.push({ label: `IGST @ ${igstPct}%`, value: money(amt) });
  } else {
    const sAmt = (subtotal * sgstPct) / 100;
    const cAmt = (subtotal * cgstPct) / 100;
    tax += sAmt + cAmt;
    if (sgstPct > 0) taxRows.push({ label: `SGST @ ${sgstPct}%`, value: money(sAmt) });
    if (cgstPct > 0) taxRows.push({ label: `CGST @ ${cgstPct}%`, value: money(cAmt) });
  }
  const grand = subtotal + tax;

  const vendorName = vendor?.name ?? po.vendorName ?? po.vendorCodeText ?? '';
  // Full postal address for the party box — line 1 plus city / state / pincode,
  // the same join the vendor master shows.
  const vendorAddress = [vendor?.addressLine1, vendor?.city, vendor?.state, vendor?.pincode]
    .filter(Boolean)
    .join(', ');
  const vendorGstin = vendor?.gstNumber ?? '';
  const vendorContact = [vendor?.contactPerson, vendor?.phone].filter(Boolean).join(', ');

  const data: Record<string, string> = {
    companyName: company?.name ?? '',
    companyAddress: companyAddressLines(company).join(', '),
    companyGSTIN: company?.gstNumber ?? '',
    companyPhone: company?.phone ?? '',
    companyEmail: '',
    date: fmtDate(new Date().toISOString()),
    currentUser: args.currentUser ?? '',
    poNo: po.code,
    poDate: fmtDate(po.poDate),
    paymentTerms: 'As per agreement',
    deliveryTerms: po.dueDate ? `By ${fmtDate(po.dueDate)}` : '',
    vendorName,
    vendorAddress,
    vendorGSTIN: vendorGstin,
    vendorContact,
    totalValue: money(grand),
    totalQty: String(totalQty),
  };

  // The approved format's document row. Five cells in a fixed order, so a
  // missing due date or PR reference prints an em dash rather than collapsing
  // the row and shifting every other cell along.
  //
  // CONTACT PERSON is the person who RAISED the PO -- the name a vendor rings
  // about it. `createdBy` alone is a uuid, so the PO detail now joins
  // `createdByName` (users.full_name), the same way the Sales Order does. Null
  // only when that user has since been deleted; a dash, never an id.
  const dash = '—';
  const meta: DocMetaCell[] = [
    { label: 'PO No.', value: po.code },
    { label: 'PO Date', value: fmtDate(po.poDate) },
    { label: 'Due Date', value: po.dueDate ? fmtDate(po.dueDate) : dash },
    { label: 'PR Ref.', value: po.prCodeText ?? dash },
    { label: 'Contact Person', value: po.createdByName ?? dash, mono: false },
  ];

  const model: DocPrintModel = {
    doc: 'PO',
    // Approved Purchase Order format (sample signed off 2026-09-08): repeating
    // letterhead, five-cell document row, supplier + ship-to boxes, and the
    // combined "Item Code & Description" column.
    docLayout: 'v10',
    parties: [
      {
        label: 'Vendor / Supplier',
        name: vendorName,
        rows: [
          { label: 'Vendor Code', value: vendor?.code ?? po.vendorCodeText ?? '', mono: true },
          { label: 'Address', value: vendorAddress },
          { label: 'GSTIN', value: vendorGstin, mono: true },
          { label: 'Vendor Phone', value: vendor?.phone ?? '', mono: true },
          { label: 'Vendor E-mail', value: vendor?.email ?? '' },
        ],
      },
      {
        // Ship To is OUR works — the same company record the letterhead uses.
        label: 'Ship To',
        name: company?.name ?? 'Innovic Technology',
        rows: [
          { label: 'Address', value: companyAddressLines(company).join(', ') },
          { label: 'GSTIN', value: company?.gstNumber ?? '', mono: true },
          { label: 'Phone', value: company?.phone ?? '', mono: true },
          { label: 'E-mail', value: company?.email ?? '' },
        ],
      },
    ],
    // Viewers who may not see prices get the qty-only PO — no Rate/Amount
    // columns, no totals, no amount-in-words.
    hideMoney: priceHidden,
    blocks: templatesToBlocks('PO', templates),
    data,
    company: buildDocCompany(company),
    recipient: {
      label: 'Supplier (Bill from)',
      name: vendorName,
      lines: [
        vendorAddress,
        vendorGstin ? `GSTIN: ${vendorGstin}` : '',
        vendorContact,
      ].filter((l): l is string => Boolean(l)),
    },
    meta,
    lines: lines.map((l) => ({
      itemCode: l.itemCode ?? l.itemCodeText ?? '',
      itemName: l.itemName,
      qty: String(l.qty),
      uom: 'NOS',
      rate: money(Number(l.rate ?? 0)),
      amount: money(l.qty * Number(l.rate ?? 0)),
      // Per-line remarks print as "Description: ..." under the item name; a
      // line without remarks prints nothing extra.
      description: l.lineRemarks,
    })),
    totals: {
      subtotal: money(subtotal),
      taxRows,
      grand: money(grand),
      amountInWords: priceHidden ? '' : amountInWords(grand),
    },
  };

  return openDocPrintWindow(model);
}
