// Test-print for the Print Templates editor. Mirrors legacy _ptSampleData
// (L14619) + _pteTestPrint (L15034): renders the selected document with the
// currently-effective template blocks + SAMPLE data, with a "TEST PRINT"
// banner. Real-data prints (P2) use the same `@/lib/print` builder but feed
// live PO/DC data — this file only supplies the sample model.

import { type Company, type EffectivePrintTemplate, type PrintDocType } from '@innovic/shared';
import { format } from 'date-fns';
import {
  type GrnPrintLine,
  type GrnPrintModel,
  printGrnDoc,
} from '@/modules/goods-receipt-notes/lib/print-grn';
import {
  type DocLine,
  type DocPrintModel,
  amountInWords,
  inrFormat,
  openDocPrintWindow,
  templatesToBlocks,
} from '@/lib/print/doc-print';

// Variable substitution bag (the {var} values). Kept exported because the
// editor's live WYSIWYG preview renders blocks with this sample data.
export function sampleDataFor(doc: PrintDocType): Record<string, string> {
  const today = format(new Date(), 'dd-MM-yyyy');
  const common: Record<string, string> = {
    companyName: 'Innovic Technology',
    companyAddress: 'V.U. Nagar, Anand, Gujarat, India',
    companyGSTIN: '24AQKPM4121A1Z5',
    companyPhone: '+91 98XXX XXXXX',
    companyEmail: 'innovic.technology@gmail.com',
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

function sampleLines(doc: PrintDocType): DocLine[] {
  // Both purchase documents print the PRICED goods table (doc-print's `isPo`),
  // so both need sample Rate/Amount. Service PO used to fall through to the
  // qty-only DC lines and printed a Rate and Amount column with empty cells.
  if (doc === 'PO' || doc === 'SERVICE PO') {
    return [
      {
        itemCode: 'STL-PL-6',
        itemName: 'Steel Plate 6mm',
        qty: '100',
        uom: 'NOS',
        rate: inrFormat(500),
        amount: inrFormat(50000),
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
  }
  return [
    { itemCode: 'STL-PL-6', itemName: 'Steel Plate 6mm', qty: '100', uom: 'NOS' },
    { itemCode: 'BRG-6203', itemName: 'Bearings 6203', qty: '100', uom: 'NOS' },
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
  name: 'Innovic Technology',
  slug: 'innovic',
  gstNumber: '24AQKPM4121A1Z5',
  phone: '+91 98XXX XXXXX',
  email: 'innovic.technology@gmail.com',
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

// Build a sample DocPrintModel for the editor's Test Print button.
export function openTestPrint(doc: PrintDocType, templates: EffectivePrintTemplate[]): boolean {
  if (doc === 'GRN') return openGrnTestPrint(templates);
  const data = sampleDataFor(doc);
  const today = data.date ?? format(new Date(), 'dd-MM-yyyy');
  // Mirrors `isPo` in @/lib/print/doc-print — Service PO is a purchase
  // document, not a challan.
  const isPo = doc === 'PO' || doc === 'SERVICE PO';
  const isSpo = doc === 'SERVICE PO';

  const model: DocPrintModel = {
    doc,
    blocks: templatesToBlocks(doc, templates),
    data,
    company: {
      name: 'Innovic Technology',
      addressLines: ['V.U. Nagar, Anand, Gujarat, India'],
      gstin: '24AQKPM4121A1Z5',
      email: 'innovic.technology@gmail.com',
    },
    recipient: isPo
      ? {
          label: 'Supplier (Bill from)',
          name: isSpo ? 'Sample Services Pvt Ltd' : 'Sample Vendor Pvt Ltd',
          lines: ['Industrial Area, Phase 2, Vadodara', 'GSTIN: 24AAACS1234D1Z5', 'Mr. Sample, +91 90000 00000'],
        }
      : {
          label: 'Recipient',
          name: 'Sample Process House',
          lines: ['GIDC, Vadodara, Gujarat'],
        },
    meta: isSpo
      ? [
          { label: 'SPO No.', value: 'IN-SPO-99999' },
          { label: 'Date', value: today },
          { label: 'Expense Head', value: 'Machining charges' },
          { label: 'Cost Center', value: 'Production' },
        ]
      : isPo
        ? [
            { label: 'PO No.', value: 'IN-PO-99999' },
            { label: 'Date', value: today },
            { label: 'Payment Terms', value: '30 days from invoice' },
          ]
        : [
            { label: 'DC No.', value: doc === 'OSP DC' ? 'OSP-99999' : 'JWDC-99999' },
            { label: 'Date', value: today },
            { label: 'Linked PO', value: 'IN-PO-99999' },
            { label: 'Vehicle', value: 'GJ-05-XX-9999' },
          ],
    lines: sampleLines(doc),
    opts: { testBanner: true },
  };

  if (isPo) {
    model.totals = {
      subtotal: inrFormat(100000),
      taxRows: [
        { label: 'SGST @ 9%', value: inrFormat(9000) },
        { label: 'CGST @ 9%', value: inrFormat(9000) },
      ],
      grand: inrFormat(118000),
      amountInWords: amountInWords(118000),
    };
  }

  return openDocPrintWindow(model);
}
