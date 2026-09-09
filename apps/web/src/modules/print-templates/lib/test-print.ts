// Test-print for the Print Templates editor. Mirrors legacy _ptSampleData
// (L14619) + _pteTestPrint (L15034): renders the selected document with the
// currently-effective template blocks + SAMPLE data, with a "TEST PRINT"
// banner. Real-data prints (P2) use the same `@/lib/print` builder but feed
// live PO/DC data — this file only supplies the sample model.

import {
  type Client,
  type Company,
  type EffectivePrintTemplate,
  type JwInvoiceListItem,
  type PrintDocType,
} from '@innovic/shared';
import { addDays, format } from 'date-fns';
import {
  type GrnPrintLine,
  type GrnPrintModel,
  printGrnDoc,
} from '@/modules/goods-receipt-notes/lib/print-grn';
import { printJwInvoice } from '@/modules/jw-invoices/lib/print-jw-invoice';
import {
  type SheetField,
  type SheetLine,
  type SheetPrintModel,
  challanDate,
  challanEndDate,
  openSheetPrintWindow,
} from '@/lib/print/sheet-print';
// Only the pure helpers now — the GRN is the last document that still renders
// through this builder, and it goes there through its own entry point.
import { amountInWords, inrFormat, templatesToBlocks } from '@/lib/print/doc-print';

// The company as it really is, for every sample on this page. The Test Print
// is what an admin checks a template against, so a placeholder address or a
// mistyped GSTIN there is a trap: it reads as correct and is not. Real prints
// read the `companies` row; this is the same row's content, written out.
const CO_NAME = 'Innovic Technology';
const CO_ADDRESS_LINES = [
  'Plot No: 12, Phase 2, GIDC V U Nagar',
  'Vithal Udyognagar',
  'Anand, Gujarat, 388121',
];
const CO_ADDRESS = CO_ADDRESS_LINES.join(', ');
const CO_GSTIN = '24AQKPM4121A1ZG';
const CO_EMAIL = 'innovic.technology@gmail.com';
const CO_PHONE = '+91 9909920457';

// Variable substitution bag (the {var} values). Kept exported because the
// editor's live WYSIWYG preview renders blocks with this sample data.
export function sampleDataFor(doc: PrintDocType): Record<string, string> {
  const today = format(new Date(), 'dd-MM-yyyy');
  const common: Record<string, string> = {
    companyName: CO_NAME,
    companyAddress: CO_ADDRESS,
    companyGSTIN: CO_GSTIN,
    companyPhone: CO_PHONE,
    companyEmail: CO_EMAIL,
    date: today,
    currentUser: 'Admin User',
  };
  // Service PO carries its OWN variable set (PRINT_TEMPLATE_VARS['SERVICE PO']:
  // spoNo / spoDate / expenseHead / costCenter). Without this branch it fell
  // through to the delivery-challan bag below, so every {spoNo} in a Service PO
  // block substituted to blank and the test print showed a DC's fields.
  if (doc === 'SERVICE PO') {
    return {
      ...common,
      spoNo: 'IN-SPO-99999',
      spoDate: today,
      expenseHead: 'Machining charges',
      costCenter: 'Production',
      paymentTerms: '30 days from invoice',
      vendorName: 'Sample Services Pvt Ltd',
      vendorAddress: 'Industrial Area, Phase 2, Vadodara',
      vendorGSTIN: '24AAACS1234D1Z5',
      vendorContact: 'Mr. Sample, +91 90000 00000',
      totalValue: '1,18,000.00',
      totalQty: '200',
    };
  }
  // The GRN is an INWARD document with its own variable set
  // (PRINT_TEMPLATE_VARS.GRN): grnNo / grnDate, the supplying vendor, the PO,
  // the vendor's DC and invoice, and the three quantity totals. Every one of
  // them gets a sample value here — a variable missing from this bag prints
  // its own name, e.g. a literal "{grnNo}", on the test sheet.
  if (doc === 'GRN') {
    return {
      ...common,
      grnNo: 'IN-GRN-99999',
      grnDate: today,
      vendorName: 'Sample Vendor Pvt Ltd',
      vendorAddress: 'Industrial Area, Phase 2, Vadodara',
      vendorGSTIN: '24AAACS1234D1Z5',
      vendorContact: 'Mr. Sample, +91 90000 00000',
      poNo: 'IN-PO-99999',
      dcNo: 'VDC-99999',
      invoiceNo: 'INV-99999',
      totalReceived: '200',
      totalAccepted: '190',
      totalRejected: '10',
    };
  }
  // The JW Invoice bills a CLIENT for labour, so its bag names the client, not
  // a vendor, and its numbers are a single job-work line: 10 pcs x Rs 500 =
  // Rs 5,000 + 18% GST = Rs 5,900. The contract does not yet list 'JW INVOICE'
  // in PRINT_TEMPLATE_VARS, so the editor shows no variable chips for these
  // four blocks; these are the names the real print
  // (modules/jw-invoices/lib/print-jw-invoice.ts) fills, so a block written by
  // hand against them substitutes here exactly as it will on paper.
  if (doc === 'JW INVOICE') {
    return {
      ...common,
      invoiceNo: 'IN-JWINV-99999',
      invoiceDate: today,
      jwNo: 'IN-JW-99999',
      clientName: 'Sample Client Pvt Ltd',
      clientAddress: 'GIDC Estate, Phase 1, Vadodara, Gujarat',
      clientGSTIN: '24AAACS1234D1Z5',
      clientContact: 'Mr. Sample, +91 90000 00000',
      partName: 'Single Fire Check Lever',
      totalValue: '5,900.00',
      totalQty: '10',
    };
  }
  if (doc === 'PO') {
    return {
      ...common,
      poNo: 'IN-PO-99999',
      poDate: today,
      paymentTerms: '30 days from invoice',
      deliveryTerms: 'Within 15 days at our works',
      vendorName: 'Sample Vendor Pvt Ltd',
      vendorAddress: 'Industrial Area, Phase 2, Vadodara',
      vendorGSTIN: '24AAACS1234D1Z5',
      vendorContact: 'Mr. Sample, +91 90000 00000',
      totalValue: '1,18,000.00',
      totalQty: '200',
    };
  }
  return {
    ...common,
    dcNo: doc === 'OSP DC' ? 'OSP-99999' : 'JWDC-99999',
    dcDate: today,
    purpose: doc === 'OSP DC' ? 'Phosphate coating' : 'Plating process',
    recipientName: 'Sample Process House',
    recipientAddress: 'GIDC, Vadodara, Gujarat',
    vehicleNo: 'GJ-05-XX-9999',
    driverName: 'Sample Driver',
    linkedPONo: 'IN-PO-99999',
    totalQty: '200',
  };
}

// The Purchase Order's two sample lines. Exported so the editor's on-screen
// preview and the PO Test Print show the SAME material. The first line carries
// remarks, which the sheet prints as a "Description" line under the item
// name; the second has none, which is what a normal row looks like.
export const PO_SAMPLE_LINES: SheetLine[] = [
  {
    itemCode: 'STL-PL-6',
    itemName: 'Steel Plate 6mm',
    qty: '100',
    uom: 'NOS',
    rate: inrFormat(500),
    amount: inrFormat(50000),
    description: 'As per drawing rev. 3. Material MS EN8, black oxide finish.',
  },
  {
    itemCode: 'BRG-6203',
    itemName: 'Bearings 6203',
    qty: '100',
    uom: 'NOS',
    rate: inrFormat(500),
    amount: inrFormat(50000),
  },
];

// The PO's two sample boxes, exported so the editor's preview and the Test
// Print cannot drift apart. Functions, not constants, because the dates are
// "today" and "today + 15".
export function poSampleRecipient(isSpo = false): SheetField[] {
  return [
    { label: 'Vendor code', value: 'VND-999', variant: 'mono' },
    {
      label: 'Name',
      value: isSpo ? 'Sample Services Pvt Ltd' : 'Sample Vendor Pvt Ltd',
      variant: 'name',
    },
    {
      label: 'Address',
      value: 'Industrial Area, Phase 2, Vadodara',
      extra: ['Gujarat — 390010'],
    },
    { label: 'GSTIN', value: '24AAACS1234D1Z5', variant: 'mono' },
    { label: 'Contact', value: 'Mr. Sample, +91 90000 00000' },
  ];
}

export function poSampleOrder(isSpo = false): SheetField[] {
  return [
    {
      label: isSpo ? 'SPO No.' : 'PO No.',
      value: isSpo ? 'IN-SPO-99999' : 'IN-PO-99999',
      variant: 'mono',
      strong: true,
    },
    {
      label: isSpo ? 'SPO date' : 'PO date',
      value: challanDate(format(new Date(), 'yyyy-MM-dd')),
      variant: 'mono',
    },
    {
      label: 'Due date',
      value: challanDate(format(addDays(new Date(), 15), 'yyyy-MM-dd')),
      variant: 'mono',
    },
    { label: 'PR Ref.', value: 'IN-PR-99999', variant: 'mono' },
    { label: 'Contact person', value: 'Admin User' },
    { label: 'Ship to', value: CO_ADDRESS },
  ];
}


// The two sample GRN lines. Exported so the editor's on-screen preview and the
// GRN test print show the SAME material — 100 + 100 received, 95 + 95 accepted,
// 5 + 5 rejected, which is the 200 / 190 / 10 in the sample totals above.
export const GRN_SAMPLE_LINES: GrnPrintLine[] = [
  {
    itemCode: 'STL-PL-6',
    itemName: 'Steel Plate 6mm',
    receivedQty: 100,
    qcAcceptedQty: 95,
    qcRejectedQty: 5,
    qcStatus: 'completed',
    dcRefNo: 'VDC-99999',
  },
  {
    itemCode: 'BRG-6203',
    itemName: 'Bearings 6203',
    receivedQty: 100,
    qcAcceptedQty: 95,
    qcRejectedQty: 5,
    qcStatus: 'completed',
    dcRefNo: 'VDC-99999',
  },
];

// Sample company for the test print's letterhead. The real prints read the
// `companies` row; the editor has no document to read one from, so the same
// values that back {companyName}/{companyAddress} above are used here.
const SAMPLE_COMPANY: Company = {
  id: '00000000-0000-0000-0000-000000000000',
  name: CO_NAME,
  slug: 'innovic',
  gstNumber: CO_GSTIN,
  phone: CO_PHONE,
  email: CO_EMAIL,
  addressLine1: 'V.U. Nagar',
  addressLine2: null,
  city: 'Anand',
  state: 'Gujarat',
  pincode: null,
  createdAt: '',
  createdBy: '00000000-0000-0000-0000-000000000000',
  updatedAt: '',
  updatedBy: '00000000-0000-0000-0000-000000000000',
  deletedAt: null,
};

// The GRN renders on the SAME document layout as the PO and the two delivery
// challans, but its columns are received / accepted / rejected / QC status, so
// it supplies its own table to the shared builder through its own entry point
// in modules/goods-receipt-notes/lib/print-grn.ts. Test Print therefore goes to
// that entry point, with the same effective template blocks and the same TEST
// PRINT banner.
function openGrnTestPrint(templates: EffectivePrintTemplate[]): boolean {
  const data = sampleDataFor('GRN');
  const model: GrnPrintModel = {
    code: data.grnNo ?? 'IN-GRN-99999',
    grnDate: data.grnDate ?? '',
    vendorName: data.vendorName ?? '',
    poNo: data.poNo ?? '',
    dcNo: data.dcNo ?? '',
    invoiceNo: data.invoiceNo ?? '',
    remarks: 'Sample receipt — material counted at the gate and taken into store.',
    lines: GRN_SAMPLE_LINES,
  };
  return printGrnDoc({
    model,
    data,
    company: SAMPLE_COMPANY,
    templates,
    testBanner: true,
  });
}

// The two delivery challans print on their OWN approved layout
// (@/lib/print/sheet-print), not the shared PO document builder, so their
// Test Print has to go there too — otherwise the editor previews a sheet that
// no real challan ever produces. Same effective template blocks, same TEST
// PRINT banner.
function openChallanTestPrint(
  doc: 'OSP DC' | 'JW DC',
  templates: EffectivePrintTemplate[],
): boolean {
  const data = sampleDataFor(doc);
  // A fixed sample challan date so the sample "Challan end date" (+3 months) is
  // visibly three months later rather than today's date twice.
  const sampleDcDate = format(new Date(), 'yyyy-MM-dd');
  const recipient: SheetField[] = [
    { label: 'Vendor code', value: 'VND-099', variant: 'mono' },
    { label: 'Name', value: 'Sample Process House', variant: 'name' },
    { label: 'Address', value: 'GIDC, Vadodara', extra: ['Gujarat — 390010'] },
    { label: 'GSTIN', value: '24AAACS1234D1Z5', variant: 'mono' },
  ];
  const document: SheetField[] = [
    { label: 'Challan No.', value: data.dcNo ?? '', variant: 'mono' },
    { label: 'Challan date', value: challanDate(sampleDcDate), variant: 'mono' },
    { label: 'SO No.', value: '', variant: 'mono' },
    { label: 'PO No.', value: data.linkedPONo ?? '', variant: 'mono' },
    {
      label: 'Challan end date',
      value: challanEndDate(sampleDcDate),
      variant: 'mono',
      strong: true,
    },
    { label: 'Vehicle No.', value: data.vehicleNo ?? '', variant: 'mono' },
  ];
  const model: SheetPrintModel = {
    title: 'Delivery Challan',
    windowTitle: doc === 'OSP DC' ? 'OSP Delivery Challan' : 'Job Work Delivery Challan',
    blocks: templatesToBlocks(doc, templates),
    data,
    company: {
      name: SAMPLE_COMPANY.name,
      addressLines: CO_ADDRESS_LINES,
      gstin: SAMPLE_COMPANY.gstNumber ?? '',
      email: SAMPLE_COMPANY.email ?? '',
      phone: SAMPLE_COMPANY.phone ?? '',
    },
    recipient: { label: 'Recipient', fields: recipient },
    document: { label: 'Document', fields: document },
    lines: [
      {
        itemCode: 'STL-PL-6',
        itemName: 'Steel Plate 6mm',
        uom: 'NOS',
        hsn: null,
        qty: '100.00',
        remarks: data.purpose ?? '',
      },
      {
        itemCode: 'BRG-6203',
        itemName: 'Bearings 6203',
        uom: 'NOS',
        hsn: null,
        qty: '100.00',
        remarks: data.purpose ?? '',
      },
    ],
    totalQty: '200.00',
    totalUom: 'NOS',
    opts: { testBanner: true },
  };
  return openSheetPrintWindow(model);
}

// Both purchase documents print on the SAME sheet as the delivery challans
// (@/lib/print/sheet-print), so their Test Print goes there too — otherwise the
// editor previews a sheet no real order produces. Same effective template
// blocks, same TEST PRINT banner, same sample lines.
//
// A SERVICE PO differs from a PO in wording only: its own title, its own
// spo_* blocks and its own {spoNo}/{spoDate}/{expenseHead}/{costCenter}
// vocabulary. The sheet, the columns and the money are identical.
function openPoTestPrint(
  doc: 'PO' | 'SERVICE PO',
  templates: EffectivePrintTemplate[],
): boolean {
  const isSpo = doc === 'SERVICE PO';
  const data = sampleDataFor(doc);
  const recipient = poSampleRecipient(isSpo);
  const order = poSampleOrder(isSpo);
  const model: SheetPrintModel = {
    title: isSpo ? 'Service Purchase Order' : 'Purchase Order',
    windowTitle: isSpo ? 'Service Purchase Order' : 'Purchase Order',
    columns: 'po',
    blocks: templatesToBlocks(doc, templates),
    data,
    company: {
      name: SAMPLE_COMPANY.name,
      addressLines: CO_ADDRESS_LINES,
      gstin: SAMPLE_COMPANY.gstNumber ?? '',
      email: SAMPLE_COMPANY.email ?? '',
      phone: SAMPLE_COMPANY.phone ?? '',
    },
    recipient: { label: isSpo ? 'Service provider' : 'Vendor / Supplier', fields: recipient },
    document: { label: 'Order', fields: order },
    lines: PO_SAMPLE_LINES,
    totalQty: '200',
    totalUom: 'NOS',
    money: {
      subtotal: inrFormat(100000),
      taxRows: [
        { label: 'SGST @ 9%', value: inrFormat(9000) },
        { label: 'CGST @ 9%', value: inrFormat(9000) },
      ],
      grand: inrFormat(118000),
      amountInWords: amountInWords(118000),
    },
    opts: { testBanner: true },
  };
  return openSheetPrintWindow(model);
}

// The JW Invoice's Test Print goes through the REAL print entry point with a
// sample invoice and a sample client, rather than assembling a second model
// here. That is the same principle the GRN's test print records: whatever an
// admin checks a template against has to be the sheet a real invoice produces,
// or the check is worthless. One job-work line — 10 pcs at Rs 500, Rs 5,000
// taxable, 18% GST, Rs 5,900 total — matching the sample bag above.
const JWINV_SAMPLE_ID = '00000000-0000-0000-0000-000000000000';

function openJwInvoiceTestPrint(templates: EffectivePrintTemplate[]): boolean {
  const today = format(new Date(), 'yyyy-MM-dd');
  const client: Client = {
    id: JWINV_SAMPLE_ID,
    companyId: JWINV_SAMPLE_ID,
    code: 'CLI-999',
    name: 'Sample Client Pvt Ltd',
    contactPerson: 'Mr. Sample',
    email: null,
    phone: '+91 90000 00000',
    gstNumber: '24AAACS1234D1Z5',
    addressLine1: 'GIDC Estate, Phase 1',
    city: 'Vadodara',
    state: 'Gujarat',
    pincode: '390010',
    isActive: true,
    createdAt: '',
    createdBy: JWINV_SAMPLE_ID,
    updatedAt: '',
    updatedBy: JWINV_SAMPLE_ID,
    deletedAt: null,
  };
  const invoice: JwInvoiceListItem = {
    id: JWINV_SAMPLE_ID,
    companyId: JWINV_SAMPLE_ID,
    code: 'IN-JWINV-99999',
    invoiceDate: today,
    jobWorkOrderId: JWINV_SAMPLE_ID,
    jobWorkOrderLineId: JWINV_SAMPLE_ID,
    jwCodeText: 'IN-JW-99999',
    clientId: JWINV_SAMPLE_ID,
    clientName: client.name,
    partName: 'Single Fire Check Lever',
    qty: 10,
    rate: 500,
    taxableAmount: 5000,
    gstPercent: 18,
    gstAmount: 900,
    totalAmount: 5900,
    remarks: 'Sample invoice — turning and grinding on client-supplied blanks.',
    createdAt: '',
    createdBy: JWINV_SAMPLE_ID,
    updatedAt: '',
    updatedBy: JWINV_SAMPLE_ID,
    deletedAt: null,
  };
  return printJwInvoice({
    invoice,
    // The sample sheet shows the money: an admin editing the invoice's blocks
    // needs to see where the totals land relative to them.
    priceVisible: true,
    client,
    company: SAMPLE_COMPANY,
    templates,
    currentUser: 'Admin User',
    testBanner: true,
  });
}

// Test Print for the editor. Every one of the six documents now has its own
// entry point, so there is no fall-through branch left: the PO and the Service
// PO print on the shared sheet, so do the two challans and the JW Invoice, and
// the GRN goes to its own builder because its columns are received / accepted /
// rejected / QC status rather than qty and money.
export function openTestPrint(doc: PrintDocType, templates: EffectivePrintTemplate[]): boolean {
  if (doc === 'GRN') return openGrnTestPrint(templates);
  if (doc === 'JW INVOICE') return openJwInvoiceTestPrint(templates);
  if (doc === 'PO' || doc === 'SERVICE PO') return openPoTestPrint(doc, templates);
  return openChallanTestPrint(doc, templates);
}
