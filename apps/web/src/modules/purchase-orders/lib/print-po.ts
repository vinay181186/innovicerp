// Real-data Purchase Order print (Print Templates P2, ADR-034). Assembles the
// print model from the loaded PO detail + vendor + company + the effective
// `po_*` template blocks, then opens the shared print window. Presentation
// only (DELTA #2) — totals/tax/amount-in-words are display formatting of data
// the API already returns, not new business rules. Mirrors legacy `printPO`
// (L25913): subtotal → IGST or SGST+CGST per taxType → grand → words.
//
// It renders on `@/lib/print/sheet-print` — THE SAME SHEET AS THE DELIVERY
// CHALLAN, on the user's instruction (2026-09-09). The challan proof is the
// master: one letterhead, one type scale, one set of rules, one outer border.
// The PO differs from a challan in exactly two places, both of them content:
// the last three columns are Qty / Rate / Amount, and the money block prints
// under the quantity total.

import type {
  Company,
  EffectivePrintTemplate,
  PrintDocType,
  PurchaseOrderDetail,
  Vendor,
} from '@innovic/shared';
import { COMPANY_CARD_ADDRESS_LINES, buildDocCompany } from '@/lib/print/company';
import { amountInWords, fmtDate, inrFormat, templatesToBlocks } from '@/lib/print/doc-print';
import {
  type SheetField,
  type SheetPrintModel,
  challanDate,
  openSheetPrintWindow,
} from '@/lib/print/sheet-print';

// A purchase-order line carries no unit of its own -- `purchase_order_lines`
// has no uom column -- so the sheet prints the one the whole system assumes.
// It was hard-coded in this file before the PO moved onto the shared sheet;
// naming it here keeps it one value instead of two literals that can drift.
const PO_UOM = 'NOS';

// A SERVICE purchase order is a purchase order with `poType: 'service'` -- the
// same table, the same screen, the same lines. It is NOT the `service_pos`
// table, which has no API and no screen and is empty in both databases.
//
// Until 2026-09-09 it printed as a plain "PURCHASE ORDER" carrying the `po_*`
// template blocks, which meant the SERVICE PO tab in Settings -> Print
// Templates reached no paper at all: an admin could edit its terms and nothing
// would ever print them. It now prints its own title and its own blocks.
function docTypeOf(po: PurchaseOrderDetail): PrintDocType {
  return po.poType === 'service' ? 'SERVICE PO' : 'PO';
}

// The stored values are snake_case enum keys ('job_work'); nobody wants to read
// that on a printed document.
const PO_TYPE_LABEL: Record<string, string> = {
  standard: 'Standard',
  job_work: 'Job work',
  outsource: 'Outsource',
  service: 'Service',
};

export function printPurchaseOrder(args: {
  po: PurchaseOrderDetail;
  vendor: Vendor | null | undefined;
  company: Company | null | undefined;
  templates: EffectivePrintTemplate[];
  currentUser?: string | undefined;
}): boolean {
  const { po, vendor, company, templates } = args;
  const lines = po.lines;
  const doc = docTypeOf(po);
  const isSpo = doc === 'SERVICE PO';

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

  const taxRows: { label: string; value: string }[] = [];
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
  const vendorAddressLines = [
    vendor?.addressLine1 ?? '',
    [vendor?.city, vendor?.state, vendor?.pincode].filter(Boolean).join(', '),
  ].filter(Boolean);
  const vendorAddress = vendorAddressLines.join(', ');
  const vendorGstin = vendor?.gstNumber ?? '';
  const vendorContact = [vendor?.contactPerson, vendor?.phone].filter(Boolean).join(', ');

  const data: Record<string, string> = {
    companyName: company?.name ?? '',
    // The card's wording, not the row's — see COMPANY_CARD_ADDRESS_LINES.
    companyAddress: COMPANY_CARD_ADDRESS_LINES.join(' '),
    companyGSTIN: company?.gstNumber ?? '',
    companyPhone: company?.phone ?? '',
    companyEmail: company?.email ?? '',
    date: fmtDate(new Date().toISOString()),
    currentUser: args.currentUser ?? '',
    poNo: po.code,
    poDate: fmtDate(po.poDate),
    // The SERVICE PO block vocabulary names the same two facts spoNo/spoDate
    // (PRINT_TEMPLATE_VARS in @innovic/shared). Both are supplied so a template
    // written against either vocabulary substitutes rather than blanking.
    spoNo: po.code,
    spoDate: fmtDate(po.poDate),
    // `purchase_orders` carries no expense head or cost centre -- those columns
    // live on the unbuilt `service_pos` table. The variables are declared for
    // the SERVICE PO document, so they are passed as blanks rather than left
    // out: substituteTemplateVars blanks an unknown name either way, and this
    // says the omission is known.
    expenseHead: '',
    costCenter: '',
    paymentTerms: 'As per agreement',
    deliveryTerms: po.dueDate ? `By ${fmtDate(po.dueDate)}` : '',
    vendorName,
    vendorAddress,
    vendorGSTIN: vendorGstin,
    vendorContact,
    totalValue: money(grand),
    totalQty: String(totalQty),
  };

  const dash = '—';
  // The left box on the sheet: who the order goes to. Same fields, same order
  // and same labels the challan's recipient box uses, so a vendor holding both
  // documents reads them the same way.
  const recipientFields: SheetField[] = [
    { label: 'Vendor code', value: vendor?.code ?? po.vendorCodeText ?? '', variant: 'mono' },
    { label: 'Name', value: vendorName, variant: 'name' },
    {
      label: 'Address',
      value: vendorAddressLines[0] ?? '',
      ...(vendorAddressLines.length > 1 ? { extra: vendorAddressLines.slice(1) } : {}),
    },
    { label: 'GSTIN', value: vendorGstin, variant: 'mono' },
  ];
  if (vendorContact) recipientFields.push({ label: 'Contact', value: vendorContact });

  // The right box: the facts about the order itself.
  //
  // CONTACT PERSON is the person who RAISED the PO -- the name a vendor rings
  // about it. `createdBy` alone is a uuid, so the PO detail joins
  // `createdByName` (users.full_name), the same way the Sales Order does. Null
  // only when that user has since been deleted; a dash, never an id.
  //
  // There is deliberately NO "Ship to" field. Our own works address is printed
  // in full on the letterhead at the top of every page, so repeating it inside
  // the Order box said the same thing twice and cost four lines of the box.
  // Removed on the user's instruction, 2026-09-09.
  const documentFields: SheetField[] = [
    { label: isSpo ? 'SPO No.' : 'PO No.', value: po.code, variant: 'mono', strong: true },
    // The type decides what happens to the material afterwards -- job work and
    // service send OUR parts out and expect them back; standard buys goods. A
    // vendor holding the paper should not have to infer which one this is.
    { label: 'PO type', value: PO_TYPE_LABEL[po.poType] ?? po.poType },
    // The sales order behind it, resolved by the detail read from the first line
    // that carries one. Blank on a hand-raised PO, which genuinely has no SO.
    { label: 'SO No.', value: po.soCode ?? '', variant: 'mono' },
    { label: isSpo ? 'SPO date' : 'PO date', value: challanDate(po.poDate), variant: 'mono' },
    { label: 'Due date', value: po.dueDate ? challanDate(po.dueDate) : '', variant: 'mono' },
    { label: 'PR Ref.', value: po.prCodeText ?? '', variant: 'mono' },
    { label: 'Contact person', value: po.createdByName ?? dash },
  ];

  const model: SheetPrintModel = {
    title: isSpo ? 'Service Purchase Order' : 'Purchase Order',
    windowTitle: isSpo ? 'Service Purchase Order' : 'Purchase Order',
    columns: 'po',
    // The purchase order's own skin -- Times New Roman throughout, tight
    // vertical spacing, GSTIN ending its own letterhead line. It is a SEPARATE
    // flag from `columns` on purpose: the JW Invoice also prints the 'po'
    // column set, and it must keep the shared look.
    sheetVariant: 'po',
    blocks: templatesToBlocks(doc, templates),
    data,
    // Letterhead address comes from the business card rather than the
    // companies row, which splits the same address differently and cannot
    // hold the country. Everything else about the company is the row's.
    company: { ...buildDocCompany(company), addressLines: [...COMPANY_CARD_ADDRESS_LINES] },
    recipient: { label: 'Vendor / Supplier', fields: recipientFields },
    // SHIP TO — where the goods are actually to be delivered. It sits INSIDE
    // the Vendor / Supplier box, under a half-width rule below that box's GSTIN
    // row, so the right-hand Order box keeps its fields and its alignment
    // untouched (user's instruction, 2026-09-10).
    //
    // The address is the same COMPANY_CARD_ADDRESS_LINES the letterhead prints,
    // not a second copy typed out here: one definition, so the two can never
    // disagree about where the vendor is meant to send the material.
    shipTo: {
      label: 'Ship to',
      fields: [
        { label: 'Name', value: company?.name ?? '', variant: 'name' },
        {
          label: 'Address',
          value: COMPANY_CARD_ADDRESS_LINES[0] ?? '',
          extra: [...COMPANY_CARD_ADDRESS_LINES.slice(1)],
        },
        { label: 'GSTIN', value: company?.gstNumber ?? '', variant: 'mono' },
      ],
    },
    document: { label: 'Order', fields: documentFields },
    lines: lines.map((l) => ({
      itemCode: l.itemCode ?? l.itemCodeText ?? '',
      itemName: l.itemName,
      uom: PO_UOM,
      qty: String(l.qty),
      rate: money(Number(l.rate ?? 0)),
      amount: money(l.qty * Number(l.rate ?? 0)),
      // Per-line remarks print under the item name; a line without remarks
      // prints nothing extra.
      description: l.lineRemarks,
    })),
    totalQty: String(totalQty),
    totalUom: PO_UOM,
    // Viewers who may not see prices get the qty-only PO — the Rate and Amount
    // cells print an em dash and no money block or amount-in-words follows.
    ...(priceHidden
      ? {}
      : {
          money: {
            subtotal: money(subtotal),
            taxRows,
            grand: money(grand),
            amountInWords: amountInWords(grand),
          },
        }),
    // No third foot panel: a purchase order is not received at a gate, so the
    // challan's "Received by — job worker" would be a lie on it. The signature
    // strip prints two panels — Prepared by, and the authorised signatory.
  };

  return openSheetPrintWindow(model);
}
