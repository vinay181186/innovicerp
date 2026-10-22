// The "may not see prices" rule on the shared print sheet: a viewer without the
// Price right gets the PO column set with NO Rate / Amount columns, no money
// rows and no amount-in-words — never a column of dashes. Print, preview and
// ⬇ PDF all render through buildSheetHtml, so this covers all three.

import { describe, expect, it } from 'vitest';
import { buildSheetHtml, type SheetPrintModel } from './sheet-print';

function model(over: Partial<SheetPrintModel> = {}): SheetPrintModel {
  return {
    title: 'Purchase Order',
    windowTitle: 'Purchase Order',
    columns: 'po',
    blocks: {},
    data: {},
    company: { name: 'Innovic', addressLines: [] },
    recipient: { label: 'Vendor', fields: [] },
    document: { label: 'Order', fields: [] },
    lines: [
      {
        itemCode: 'ITM-1',
        pol: '20',
        hsn: '8483',
        uom: 'NOS',
        qty: '10',
        rate: '150.00',
        amount: '1,500.00',
      },
    ],
    totalQty: '10',
    totalUom: 'NOS',
    money: {
      subtotal: '1,500.00',
      taxRows: [],
      grand: '1,500.00',
      amountInWords: 'Indian Rupees One Thousand Five Hundred Only',
    },
    ...over,
  };
}

const headerCount = (html: string): number => (html.match(/class="colh/g) ?? []).length;

describe('buildSheetHtml — hideMoney', () => {
  it('prints Rate, Amount and the money block when prices are visible', () => {
    const html = buildSheetHtml(model());
    expect(html).toContain('>Rate</td>');
    expect(html).toContain('>Amount</td>');
    expect(html).toContain('150.00');
    expect(html).toContain('Amount in Words');
    // Sr No, POL, Item Code, UOM, HSN, Qty, Rate, Amount
    expect(headerCount(html)).toBe(8);
    expect(html).toContain('colspan="8"');
  });

  it('drops the Rate / Amount columns, money rows and words when hidden', () => {
    const html = buildSheetHtml(model({ hideMoney: true }));
    expect(html).not.toContain('>Rate</td>');
    expect(html).not.toContain('>Amount</td>');
    expect(html).not.toContain('150.00');
    expect(html).not.toContain('Amount in Words');
    expect(html).not.toContain('Subtotal');
    expect(html).not.toContain('—</td>');
    // Every full-width row spans the 6 remaining columns.
    expect(headerCount(html)).toBe(6);
    expect(html).toContain('colspan="6"');
    expect(html).not.toContain('colspan="8"');
  });

  it('leaves the non-money column sets alone', () => {
    const challan = model({ columns: 'challan' });
    delete challan.money;
    expect(buildSheetHtml({ ...challan, hideMoney: true })).toBe(buildSheetHtml(challan));
  });
});
