// Real-data Job Work Delivery Challan print (Print Templates P2, ADR-034).
// Assembles a DocPrintModel from the loaded JW DC outward detail + vendor +
// company + the effective `jwdc_*` template blocks. Presentation only
// (DELTA #2). Mirrors legacy `_jwdcPrint` (L24611) — returnable gate pass
// under the GST job-work provisions.

import type { Company, EffectivePrintTemplate, JwDcOutwardDetail, Vendor } from '@innovic/shared';
import { buildDocCompany, companyAddressLines } from '@/lib/print/company';
import {
  type DocMetaCell,
  type DocPrintModel,
  fmtDate,
  openDocPrintWindow,
  templatesToBlocks,
} from '@/lib/print/doc-print';

export function printJwDc(args: {
  dc: JwDcOutwardDetail;
  vendor: Vendor | null | undefined;
  company: Company | null | undefined;
  templates: EffectivePrintTemplate[];
  currentUser?: string | undefined;
}): boolean {
  const { dc, vendor, company, templates } = args;

  const totalQty = dc.lines.reduce((s, l) => s + l.sentQty, 0);
  const linkedPo = dc.jwpoCodeText ?? '';
  const recipientName = vendor?.name ?? dc.vendorNameText ?? dc.vendorCodeText ?? '';
  const recipientAddress = vendor?.addressLine1 ?? '';
  const vehicleNo = dc.vehicleNo ?? '';
  const purpose = [...new Set(dc.lines.map((l) => l.processText).filter(Boolean))].join(', ');

  const data: Record<string, string> = {
    companyName: company?.name ?? '',
    companyAddress: companyAddressLines(company).join(', '),
    companyGSTIN: company?.gstNumber ?? '',
    date: fmtDate(new Date().toISOString()),
    currentUser: args.currentUser ?? '',
    dcNo: dc.code,
    dcDate: fmtDate(dc.dcDate),
    purpose,
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
  if (linkedPo) meta.push({ label: 'JWPO', value: linkedPo });
  if (vehicleNo) meta.push({ label: 'Vehicle', value: vehicleNo });

  const model: DocPrintModel = {
    doc: 'JW DC',
    blocks: templatesToBlocks('JW DC', templates),
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
      qty: String(l.sentQty),
      uom: 'NOS',
    })),
  };

  return openDocPrintWindow(model);
}
