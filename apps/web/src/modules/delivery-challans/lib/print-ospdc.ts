// Real-data OSP Delivery Challan print (Print Templates P2, ADR-034).
// Assembles a DocPrintModel from the loaded DC detail + vendor + company + the
// effective `ospdc_*` template blocks. Presentation only (DELTA #2). Mirrors
// legacy `printChallan` (L26133) — outsource gate pass for a Job-Work PO.

import type {
  Company,
  DeliveryChallanWithLines,
  EffectivePrintTemplate,
  Vendor,
} from '@innovic/shared';
import { buildDocCompany, companyAddressLines } from '@/lib/print/company';
import {
  type DocMetaCell,
  type DocPrintModel,
  fmtDate,
  openDocPrintWindow,
  templatesToBlocks,
} from '@/lib/print/doc-print';

export function printOspDc(args: {
  dc: DeliveryChallanWithLines;
  vendor: Vendor | null | undefined;
  company: Company | null | undefined;
  templates: EffectivePrintTemplate[];
  currentUser?: string | undefined;
}): boolean {
  const { dc, vendor, company, templates } = args;

  const totalQty = dc.lines.reduce((s, l) => s + Number(l.qty), 0);
  const linkedPo = dc.poCode ?? dc.poCodeText ?? '';
  const recipientName = vendor?.name ?? dc.vendorName ?? dc.vendorCodeText ?? '';
  const recipientAddress = vendor?.addressLine1 ?? '';
  const vehicleNo = dc.transport ?? '';

  const data: Record<string, string> = {
    companyName: company?.name ?? '',
    companyAddress: companyAddressLines(company).join(', '),
    companyGSTIN: company?.gstNumber ?? '',
    date: fmtDate(new Date().toISOString()),
    currentUser: args.currentUser ?? '',
    dcNo: dc.code,
    dcDate: fmtDate(dc.dcDate),
    purpose: '',
    recipientName,
    recipientAddress,
    vehicleNo,
    driverName: '',
    linkedPONo: linkedPo,
    totalQty: String(totalQty),
  };

  const meta: DocMetaCell[] = [
    { label: 'DC No.', value: dc.code },
    { label: 'Date', value: fmtDate(dc.dcDate) },
  ];
  if (linkedPo) meta.push({ label: 'Linked PO', value: linkedPo });
  if (vehicleNo) meta.push({ label: 'Transport', value: vehicleNo });

  const model: DocPrintModel = {
    doc: 'OSP DC',
    blocks: templatesToBlocks('OSP DC', templates),
    data,
    company: buildDocCompany(company),
    recipient: {
      label: 'Recipient',
      name: recipientName,
      lines: [recipientAddress].filter((l): l is string => Boolean(l)),
    },
    meta,
    lines: dc.lines.map((l) => ({
      itemCode: l.itemCodeText,
      itemName: l.itemNameText,
      qty: String(Number(l.qty)),
      uom: l.uom,
    })),
  };

  return openDocPrintWindow(model);
}
