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
  // Transporter NAME and vehicle NUMBER are two different fields; the print
  // shows both, each under its own label.
  const transporter = dc.transport ?? '';
  const vehicleNo = dc.vehicleNo ?? '';

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

  // ── What came BACK from the vendor ──────────────────────────────────────
  // The DC detail load carries `receipts[]` (per-line receivedQty), which is
  // what the on-screen receipts panel renders. Without it a printed challan
  // cannot say whether the material ever returned.
  //
  // The received/pending numbers are NOT extra columns in the goods table:
  // the shared builder's `DocLine` shape has no such fields and that builder
  // is off limits. They print instead as a short summary block AFTER the
  // table, appended to the `special_notes` block the builder already renders
  // there — the user's own template text is kept and this is added under it.
  const receivedByLine = new Map<string, number>();
  for (const r of dc.receipts) {
    for (const rl of r.lines) {
      receivedByLine.set(
        rl.deliveryChallanLineId,
        (receivedByLine.get(rl.deliveryChallanLineId) ?? 0) + Number(rl.receivedQty),
      );
    }
  }
  const totalReceived = dc.lines.reduce((s, l) => s + (receivedByLine.get(l.id) ?? 0), 0);
  const totalPending = Math.max(0, totalQty - totalReceived);

  const blocks = templatesToBlocks('OSP DC', templates);
  const returnLines = dc.lines.map((l, i) => {
    const sent = Number(l.qty);
    const received = receivedByLine.get(l.id) ?? 0;
    const pending = Math.max(0, sent - received);
    const label = l.itemCode ?? l.itemCodeText;
    return `${i + 1}. ${label} — sent ${sent} / received ${received} / pending ${pending}`;
  });
  // Its OWN section under the goods table, not folded into `special_notes`.
  // special_notes is text the USER authors in Settings -> Print Templates; a
  // computed return status filed under that heading is mislabelled on a document
  // the vendor reads, and would be glued onto whatever they had typed there.
  const extraSection =
    returnLines.length > 0
      ? {
          title: 'Material Return Status (as on print date)',
          body: [
            ...returnLines,
            `Total: sent ${totalQty} / received ${totalReceived} / pending ${totalPending}`,
          ].join('\n'),
        }
      : undefined;

  const meta: DocMetaCell[] = [
    { label: 'DC No.', value: dc.code },
    { label: 'Date', value: fmtDate(dc.dcDate) },
  ];
  if (linkedPo) meta.push({ label: 'Linked PO', value: linkedPo });
  if (transporter) meta.push({ label: 'Transport', value: transporter });
  if (vehicleNo) meta.push({ label: 'Vehicle No.', value: vehicleNo });

  const model: DocPrintModel = {
    doc: 'OSP DC',
    blocks,
    data,
    company: buildDocCompany(company),
    recipient: {
      label: 'Recipient',
      name: recipientName,
      lines: [recipientAddress].filter((l): l is string => Boolean(l)),
    },
    meta,
    lines: dc.lines.map((l) => ({
      // LIVE master code/name first, issue-time snapshot only as the fallback.
      // itemCodeText is filled with the item NAME when the source line had no
      // code, so printing it alone put a part name under the "Item Code" heading
      // on a document the vendor reads. Same bug was just fixed on the JW DC.
      itemCode: l.itemCode ?? l.itemCodeText,
      itemName: l.itemName ?? l.itemNameText,
      qty: String(Number(l.qty)),
      uom: l.uom,
    })),
    // Spread, not `extraSection,`: exactOptionalPropertyTypes refuses an
    // explicit undefined on an optional property.
    ...(extraSection ? { extraSection } : {}),
  };

  return openDocPrintWindow(model);
}
