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

  const subtotal = lines.reduce((s, l) => s + l.qty * Number(l.rate), 0);
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
    if (igstPct > 0) taxRows.push({ label: `IGST @ ${igstPct}%`, value: inrFormat(amt) });
  } else {
    const sAmt = (subtotal * sgstPct) / 100;
    const cAmt = (subtotal * cgstPct) / 100;
    tax += sAmt + cAmt;
    if (sgstPct > 0) taxRows.push({ label: `SGST @ ${sgstPct}%`, value: inrFormat(sAmt) });
    if (cgstPct > 0) taxRows.push({ label: `CGST @ ${cgstPct}%`, value: inrFormat(cAmt) });
  }
  const grand = subtotal + tax;

  const vendorName = vendor?.name ?? po.vendorName ?? po.vendorCodeText ?? '';
  const vendorAddress = vendor?.addressLine1 ?? '';
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
    totalValue: inrFormat(grand),
    totalQty: String(totalQty),
  };

  const meta: DocMetaCell[] = [
    { label: 'PO No.', value: po.code },
    { label: 'Date', value: fmtDate(po.poDate) },
  ];
  if (po.dueDate) meta.push({ label: 'Delivery Date', value: fmtDate(po.dueDate) });
  if (po.prCodeText) meta.push({ label: 'PR Ref', value: po.prCodeText });

  const model: DocPrintModel = {
    doc: 'PO',
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
      rate: inrFormat(Number(l.rate)),
      amount: inrFormat(l.qty * Number(l.rate)),
    })),
    totals: {
      subtotal: inrFormat(subtotal),
      taxRows,
      grand: inrFormat(grand),
      amountInWords: amountInWords(grand),
    },
  };

  return openDocPrintWindow(model);
}
