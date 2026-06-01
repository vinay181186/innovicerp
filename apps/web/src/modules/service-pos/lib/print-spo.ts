// Real-data Service Purchase Order print (Phase F follow-up, ADR-034 family).
// Assembles a DocPrintModel from the loaded Service PO detail + vendor +
// company + the effective `spo_*` template blocks, then opens the shared print
// window. Presentation only — totals/tax/amount-in-words are display
// formatting of data the API already returns. Mirrors print-po.ts.

import type { Company, EffectivePrintTemplate, ServicePoDetail, Vendor } from '@innovic/shared';
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

export function printServicePo(args: {
  spo: ServicePoDetail;
  vendor: Vendor | null | undefined;
  company: Company | null | undefined;
  templates: EffectivePrintTemplate[];
  currentUser?: string | undefined;
}): boolean {
  const { spo, vendor, company, templates } = args;
  const lines = spo.lines;

  const subtotal = spo.subtotal;
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);

  const isIgst = spo.taxType === 'igst';
  const taxRows: DocMetaCell[] = [];
  if (spo.taxAmount > 0) {
    taxRows.push({
      label: `${isIgst ? 'IGST' : 'SGST+CGST'} @ ${spo.gstPct}%`,
      value: inrFormat(spo.taxAmount),
    });
  }
  const grand = spo.total;

  const vendorName = vendor?.name ?? spo.vendorName ?? spo.vendorCodeText ?? '';
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
    spoNo: spo.spoNo,
    spoDate: fmtDate(spo.spoDate),
    expenseHead: spo.expenseHead,
    costCenter: spo.costCenter === 'general' ? 'General' : (spo.soNoText ?? ''),
    paymentTerms: spo.paymentTerms,
    vendorName,
    vendorAddress,
    vendorGSTIN: vendorGstin,
    vendorContact,
    totalValue: inrFormat(grand),
    totalQty: String(totalQty),
  };

  const meta: DocMetaCell[] = [
    { label: 'SPO No.', value: spo.spoNo },
    { label: 'Date', value: fmtDate(spo.spoDate) },
    { label: 'Expense Head', value: spo.expenseHead },
  ];
  if (data.costCenter) meta.push({ label: 'Cost Center', value: data.costCenter });

  const model: DocPrintModel = {
    doc: 'SERVICE PO',
    blocks: templatesToBlocks('SERVICE PO', templates),
    data,
    company: buildDocCompany(company),
    recipient: {
      label: 'Service Provider (Bill from)',
      name: vendorName,
      lines: [
        vendorAddress,
        vendorGstin ? `GSTIN: ${vendorGstin}` : '',
        vendorContact,
      ].filter((l): l is string => Boolean(l)),
    },
    meta,
    lines: lines.map((l) => ({
      // Service lines have a free-text description, no item code.
      itemCode: l.description,
      itemName: '',
      qty: String(l.qty),
      uom: 'NOS',
      rate: inrFormat(l.rate),
      amount: inrFormat(l.amount),
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
