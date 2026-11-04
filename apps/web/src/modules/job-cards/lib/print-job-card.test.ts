import type { JcOpEnriched, JobCardListItem } from '@innovic/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpFlowRow } from '@/modules/flow-views/types';

const captured = vi.hoisted(() => ({ html: '' }));
vi.mock('@/lib/print/sheet-print', async (orig) => ({
  ...(await orig<typeof import('@/lib/print/sheet-print')>()),
  openSheetHtmlWindow: (_t: string, html: string) => {
    captured.html = html;
    return true;
  },
}));

import { printJobCard } from './print-job-card';

const jc = (over: Partial<JobCardListItem> = {}): JobCardListItem =>
  ({
    code: 'IN-JC-26-00031',
    itemCode: 'SHAFT-4471',
    itemName: 'Drive Shaft',
    itemRevision: 'C',
    drawingRev: 'C',
    drawingNo: 'DRG-1',
    orderQty: 20,
    priority: 'high',
    jcDate: '2026-10-21',
    dueDate: '2026-11-05',
    customerDispatchDate: '2026-11-10',
    remarks: null,
    clientPoLineNo: '20',
    routeCardCode: 'IN-RC-00042',
    routeCardRevision: 3,
    rawMaterialItemCode: 'EN19-RB-55',
    rawMaterialGradeText: 'EN19',
    rawMaterialSizeText: 'dia 55',
    parentJobCardCode: null,
    parentNcCode: null,
    createdByName: 'Mayur Patel',
    sourceLink: {
      type: 'so',
      salesOrderLineId: 'x',
      code: 'IN-SO-00077',
      internalSoNo: 'SO-1188',
      lineNo: 11,
      partName: null,
    },
    ...over,
  }) as JobCardListItem;

const op = {
  id: 'op1',
  opSeq: 1,
  operation: 'Turning',
  opType: 'process',
  machineCode: 'VMC-01',
  machines: [],
} as unknown as JcOpEnriched;
const flow = [{ jcOpId: 'op1', acceptedQty: 18, deviatedQty: 2, reworkedQty: 1 }] as OpFlowRow[];

const print = (j = jc()) =>
  printJobCard({
    jc: j,
    ops: [op],
    flow,
    company: null,
    actualSize: 'dia 55 x 412',
    productionOrderCode: 'IN-PRO-26-00007',
  });
const thead = () =>
  captured.html.slice(captured.html.indexOf('<thead>'), captured.html.indexOf('</thead>'));
const body = () => captured.html.slice(captured.html.indexOf('<tbody>'));
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('printJobCard', () => {
  beforeEach(() => {
    captured.html = '';
  });

  it('the repeating top block carries Item, Material, Job Card, Source, Remarks and the note', () => {
    print(jc({ remarks: 'Handle with care' }));
    const t = text(thead());
    for (const s of ['Item', 'Material', 'Job Card', 'Source']) expect(t).toContain(s);
    expect(t).toContain('Drawing No. DRG-1');
    expect(t).toContain('Drawing Rev C');
    expect(t).toContain('Remarks Handle with care');
    expect(t.indexOf('Remarks')).toBeLessThan(t.indexOf('Use released drawing only'));
  });

  it('dates run JC Date, Due Date, Dispatch Date, in DD-MM-YYYY', () => {
    print();
    expect(text(thead())).toContain(
      'JC Date 21-10-2026 Due Date 05-11-2026 Dispatch Date 10-11-2026',
    );
  });

  it('Remarks always prints, blank when the card has none', () => {
    print();
    expect(text(thead())).toMatch(/Remarks\s+Use released/);
  });

  it('quantities are the JC screen figures; a zero is blank; Operation is the name only', () => {
    print();
    expect(text(body())).toContain('Turning VMC-01');
    expect(text(body())).toContain('18 2 1');
    printJobCard({
      jc: jc(),
      ops: [op],
      flow: [{ ...flow[0]!, deviatedQty: 0 }],
      company: null,
    });
    expect(text(body())).not.toContain('18 0 1');
  });

  it('Parent JC + NC No. only on a rework card', () => {
    print();
    expect(thead()).not.toContain('Parent JC');
    print(jc({ parentJobCardCode: 'IN-JC-26-00001', parentNcCode: 'NC-00001' }));
    expect(text(thead())).toContain('Parent JC IN-JC-26-00001 NC No. NC-00001');
  });

  it('a JWSO card says JWSO No. and has no Internal SO No.', () => {
    print(
      jc({
        sourceLink: {
          type: 'jw',
          jobWorkOrderLineId: 'x',
          code: 'IN-JW-1',
          lineNo: 2,
          partName: null,
        } as JobCardListItem['sourceLink'],
      }),
    );
    const t = text(thead());
    expect(t).toContain('JWSO No. IN-JW-1');
    expect(t).not.toContain('Internal SO No.');
  });

  it('removed: Heat / Lot, Sign Date, the bottom footer, the old column name', () => {
    print();
    for (const gone of ['Heat / Lot', 'Sign Date', 'jfoot', 'Created By']) {
      expect(captured.html).not.toContain(gone);
    }
  });

  it('a Cancelled card has no flow rows: the op figures print, with the stamp', () => {
    printJobCard({
      jc: jc(),
      ops: [{ ...op, completedQty: 7, qcRejectedQty: 0 } as JcOpEnriched],
      flow: [],
      company: null,
      cancelled: true,
    });
    expect(captured.html).toContain('is-cancelled');
    expect(text(body())).toContain('Turning VMC-01 7');
  });

  it('blank rows continue from the highest step, so a gap never repeats a number', () => {
    printJobCard({ jc: jc(), ops: [{ ...op, opSeq: 4 } as JcOpEnriched], flow, company: null });
    const t = text(body());
    expect(t).toContain('40 Turning');
    expect(t).toContain('50');
    expect(t).toContain('60');
  });

  it('values are escaped', () => {
    print(jc({ remarks: '<b>x</b>' }));
    expect(thead()).not.toContain('<b>x</b>');
  });
});
