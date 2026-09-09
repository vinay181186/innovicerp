// Real-data JW Invoice print (Print Templates, ADR-034 / ADR-079). Assembles
// the print model from a JW invoice register row + the client master + company
// + the effective `jwinv_*` template blocks, then opens the shared print
// window. Presentation only — the taxable / GST / total figures are the ones
// the API already returns, re-formatted; nothing here is a new calculation.
//
// It renders on `@/lib/print/sheet-print` — THE SAME SHEET AS THE DELIVERY
// CHALLAN AND THE PURCHASE ORDER. The challan proof is the master: one
// letterhead, one type scale, one set of rules, one outer border. Until now the
// JW Invoice had no print at all, so it is the last register to come onto the
// sheet rather than the first to leave it.
//
// It differs from the two outward documents in three ways, all of them content:
//   - the counterparty is a CLIENT we bill, not a vendor we send goods to;
//   - it has exactly ONE goods row, because a JW invoice bills exactly one Job
//     Work Order line;
//   - the thing being charged is LABOUR. There is no material value on this
//     document, and the sheet says so out loud (see MATERIAL_NOTE).

import type { Client, Company, EffectivePrintTemplate, JwInvoiceListItem } from '@innovic/shared';
import { buildDocCompany, companyAddressLines } from '@/lib/print/company';
import { amountInWords, fmtDate, inrFormat, templatesToBlocks } from '@/lib/print/doc-print';
import {
  type SheetField,
  type SheetPrintModel,
  challanDate,
  openSheetPrintWindow,
} from '@/lib/print/sheet-print';

// `jw_invoices.qty` is a whole-number piece count and the register shows it
// without a unit, so the sheet prints the one the whole system assumes — the
// same value and the same reason as the purchase order's PO_UOM.
const JW_INVOICE_UOM = 'NOS';

// The one statement this document must never print without.
//
// A JW invoice bills the LABOUR on a job-work line. The material being worked
// on belongs to the client, was sent to us by the client, and is not charged
// for anywhere on this sheet. A reader holding a piece of paper with a
// quantity, a rate and a total on it will assume the goods are being charged
// unless somebody tells them otherwise — so we tell them, in the band directly
// under the money, which is where the question forms.
//
// It fills `special_notes` ONLY when that block is blank. The contract ships no
// factory text for the four `jwinv_*` blocks yet (PRINT_TEMPLATE_DEFAULTS has
// none), so today the block is always blank and the note always prints. The day
// an admin writes their own special notes in Settings → Print Templates, or a
// default lands in the contract, theirs wins and this yields to it.
const MATERIAL_NOTE =
  'This invoice is for the labour / processing charge only. The material processed under ' +
  'it is supplied by the client and remains the property of the client throughout — no ' +
  'material value is charged on this invoice.';

export function printJwInvoice(args: {
  invoice: JwInvoiceListItem;
  /** Told by the server on the list response, never inferred from a null money
   *  field — a null also means "no value yet", and probing it once hid the
   *  money from a user fully entitled to see it. */
  priceVisible: boolean;
  client: Client | null | undefined;
  company: Company | null | undefined;
  templates: EffectivePrintTemplate[];
  currentUser?: string | undefined;
  /** Print Templates → Test Print. Draws the sample banner and nothing else,
   *  so the editor exercises the SAME code path a real invoice prints on. */
  testBanner?: boolean;
}): boolean {
  const { invoice, client, company, templates } = args;

  // Money is hidden for viewers whose access removes prices: the API nulls
  // rate / taxable / GST / total on every row it sends them. A printed invoice
  // must not leak what the screen hides, so every rupee cell prints an em dash,
  // the subtotal / tax / grand block is dropped and no amount-in-words follows.
  // The document still prints, and still says who is billed for what quantity.
  const priceHidden = !args.priceVisible;
  const money = (n: number): string => (priceHidden ? '—' : inrFormat(n));

  // Each figure prefers what the server computed and stored, and falls back to
  // the arithmetic the create form itself uses (qty × rate, + GST %). The
  // fallback only ever runs on a row the server did not fill; it is never a
  // second opinion about a number the API already gave.
  const rate = Number(invoice.rate ?? 0);
  const taxable = invoice.taxableAmount ?? invoice.qty * rate;
  const gstPct = Number(invoice.gstPercent ?? 0);
  const gstAmount = invoice.gstAmount ?? (taxable * gstPct) / 100;
  const grand = invoice.totalAmount ?? taxable + gstAmount;

  // ONE tax row, not the purchase order's IGST-or-SGST+CGST pair. `jw_invoices`
  // stores a single `gst_percent` / `gst_amount` taken from the JWSO header and
  // carries no `taxType`, so there is nothing to split an intra-state supply on.
  // Inventing a 9%+9% split from an 18% figure would be a claim the data does
  // not make.
  const taxRows = gstPct > 0 ? [{ label: `GST @ ${gstPct}%`, value: money(gstAmount) }] : [];

  const clientName = client?.name ?? invoice.clientName ?? '';
  // Full postal address for the party box — line 1 plus city / state / pincode,
  // the same join the client master shows. Most client rows carry the whole
  // address inside line 1 today, so the second line is usually empty and is
  // dropped rather than printed as a stray comma.
  const clientAddressLines = [
    client?.addressLine1 ?? '',
    [client?.city, client?.state, client?.pincode].filter(Boolean).join(', '),
  ].filter(Boolean);
  const clientGstin = client?.gstNumber ?? '';
  const clientContact = [client?.contactPerson, client?.phone].filter(Boolean).join(', ');

  // The {placeholder} bag for the four template blocks.
  //
  // The contract does not list 'JW INVOICE' in PRINT_TEMPLATE_VARS, so the
  // Print Templates editor offers no variable chips for these blocks yet and an
  // admin has to type a {name} by hand. The names below deliberately mirror the
  // purchase order's vocabulary (companyName / date / currentUser / totalValue /
  // totalQty) with the party names swapped from vendor to client, so a template
  // written against the PO's habits substitutes instead of blanking.
  const data: Record<string, string> = {
    companyName: company?.name ?? '',
    companyAddress: companyAddressLines(company).join(', '),
    companyGSTIN: company?.gstNumber ?? '',
    companyPhone: company?.phone ?? '',
    companyEmail: company?.email ?? '',
    date: fmtDate(new Date().toISOString()),
    currentUser: args.currentUser ?? '',
    invoiceNo: invoice.code,
    invoiceDate: fmtDate(invoice.invoiceDate),
    jwNo: invoice.jwCodeText ?? '',
    clientName,
    clientAddress: clientAddressLines.join(', '),
    clientGSTIN: clientGstin,
    clientContact,
    partName: invoice.partName ?? '',
    totalValue: money(grand),
    totalQty: String(invoice.qty),
  };

  const blocks = templatesToBlocks('JW INVOICE', templates);
  if (!blocks.special_notes?.trim()) blocks.special_notes = MATERIAL_NOTE;

  // The left box: who is being billed. Same fields, same order and same labels
  // the challan and the PO use for their vendor, so a reader who handles all
  // three documents reads them the same way — only the party changes.
  const recipientFields: SheetField[] = [
    { label: 'Client code', value: client?.code ?? '', variant: 'mono' },
    { label: 'Name', value: clientName, variant: 'name' },
    {
      label: 'Address',
      value: clientAddressLines[0] ?? '',
      ...(clientAddressLines.length > 1 ? { extra: clientAddressLines.slice(1) } : {}),
    },
    // Not one client in the master carries a GSTIN today, so this normally
    // prints as a blank dotted rule. The field stays: it is the first thing a
    // client's accounts desk looks for, and the rule says "not captured"
    // where an omitted row would say nothing at all.
    { label: 'GSTIN', value: clientGstin, variant: 'mono' },
  ];
  if (clientContact) recipientFields.push({ label: 'Contact', value: clientContact });

  // The right box: the facts about the invoice itself. `jwCodeText` is the
  // JWSO number snapshotted at invoice time — it is what the client quotes back
  // when they query the bill.
  const documentFields: SheetField[] = [
    { label: 'Invoice No.', value: invoice.code, variant: 'mono', strong: true },
    { label: 'Invoice date', value: challanDate(invoice.invoiceDate), variant: 'mono' },
    { label: 'JWSO No.', value: invoice.jwCodeText ?? '', variant: 'mono' },
    // Spelled out as a field, not left to the reader: this is a service bill
    // against material the client already owns.
    { label: 'Nature of charge', value: 'Job work — labour / processing' },
  ];

  const model: SheetPrintModel = {
    title: 'Job Work Invoice',
    windowTitle: 'JW Invoice',
    // The money column set: Sr · Item detail · UOM · Qty · Rate · Amount, with
    // the subtotal / tax / total block under the quantity total.
    columns: 'po',
    blocks,
    data,
    company: buildDocCompany(company),
    recipient: { label: 'Bill to / Client', fields: recipientFields },
    document: { label: 'Invoice', fields: documentFields },
    // ONE line, always: a JW invoice bills exactly one Job Work Order line
    // (`jobWorkOrderLineId` is a single id on the row, not a list).
    lines: [
      {
        // There is NO item code on this document. The invoice row carries the
        // JW line's `partName` and nothing else that identifies the part, and
        // the job-work part is the CLIENT's part — it has no code in our item
        // master to print. Blank, rather than a value invented to fill the
        // column; the same choice the OSP challan makes for HSN.
        itemCode: '',
        itemName: invoice.partName ?? '',
        uom: JW_INVOICE_UOM,
        qty: String(invoice.qty),
        rate: money(rate),
        amount: money(taxable),
        // Whatever the biller typed on this invoice, under the part name. A
        // blank remarks field prints nothing extra.
        description: invoice.remarks,
      },
    ],
    totalQty: String(invoice.qty),
    totalUom: JW_INVOICE_UOM,
    // Viewers who may not see prices get the qty-only invoice — the Rate and
    // Amount cells print an em dash and no money block or amount-in-words
    // follows it.
    ...(priceHidden
      ? {}
      : {
          money: {
            subtotal: money(taxable),
            taxRows,
            grand: money(grand),
            amountInWords: amountInWords(grand),
          },
        }),
    // No third foot panel. The challan's "Received by — job worker" is a gate
    // signature for material arriving somewhere; an invoice is not received at
    // a gate, so the signature strip prints two panels, the same as the PO.
    ...(args.testBanner ? { opts: { testBanner: true } } : {}),
  };

  return openSheetPrintWindow(model);
}
