// Test-print for the Print Templates editor. Mirrors legacy _ptSampleData
// (L14619) + _pteTestPrint (L15034): renders the selected document with the
// currently-effective template blocks + SAMPLE data, with a "TEST PRINT"
// banner. Real-data prints (P2) use the same `@/lib/print` builder but feed
// live PO/DC data — this file only supplies the sample model.

import { type EffectivePrintTemplate, type PrintDocType } from '@innovic/shared';
import { format } from 'date-fns';
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
  if (doc === 'PO') {
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

// Build a sample DocPrintModel for the editor's Test Print button.
export function openTestPrint(doc: PrintDocType, templates: EffectivePrintTemplate[]): boolean {
  const data = sampleDataFor(doc);
  const today = data.date ?? format(new Date(), 'dd-MM-yyyy');
  const isPo = doc === 'PO';

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
          name: 'Sample Vendor Pvt Ltd',
          lines: ['Industrial Area, Phase 2, Vadodara', 'GSTIN: 24AAACS1234D1Z5', 'Mr. Sample, +91 90000 00000'],
        }
      : {
          label: 'Recipient',
          name: 'Sample Process House',
          lines: ['GIDC, Vadodara, Gujarat'],
        },
    meta: isPo
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
