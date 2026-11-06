// ADR-279 — the Planning list's Party GRN Status: the grnPlanPending filter, the
// Sort & Filter field and the search word, with no database.

import type { PartyGrnStatus, PlanningLineListItem } from '@innovic/shared';
import { describe, expect, it } from 'vitest';
import { pagePlanningLines, toPlanningLinePageRow } from './list-lines-page';

const row = (lineNo: number, partyGrnStatus: PartyGrnStatus, remaining = 5, source = 'jw') =>
  toPlanningLinePageRow(
    {
      soId: '11111111-1111-4111-8111-111111111111',
      soCode: 'IN-JW-00001',
      soInternalNo: null,
      source: source as 'so' | 'jw',
      customerName: 'Acme',
      soType: 'job_work',
      soLineId: '22222222-2222-4222-8222-222222222222',
      itemRevisionId: null,
      drawingRev: null,
      lineNo,
      clientPoLineNo: null,
      createdAt: '2026-11-01T05:00:00.000Z',
      createdByName: null,
      itemId: null,
      itemCode: 'ITM-1',
      itemRevision: null,
      itemName: 'Shaft',
      orderQty: 10,
      dueDate: null,
      itemProcurementType: 'make',
      prQty: 0,
      prs: [],
      plans: [],
      totalPlanned: 10 - remaining,
      directJcQty: 0,
      directJcCodes: [],
      remaining,
      shortClosed: false,
      partyGrnStatus,
      lineStatus: 'unplanned',
    } as PlanningLineListItem,
    { itemCodeText: null, partName: null },
  );

const lineNos = (r: { items: Array<{ lineNo: number }> }) => r.items.map((i) => i.lineNo);

const ROWS = [
  row(1, 'done'),
  row(2, 'part_done'),
  row(3, 'not_done'),
  row(4, 'none'),
  row(5, 'done', 0), // fully planned: nothing left to plan
  row(6, 'none', 5, 'so'),
];

describe('grnPlanPending', () => {
  it('keeps only material received (Done / Part Done) with To Plan above 0', () => {
    const out = pagePlanningLines(ROWS, { grnPlanPending: '1' });
    expect(lineNos(out)).toEqual([1, 2]);
    expect(out.total).toBe(2);
  });

  it('without it every line stays', () => {
    expect(lineNos(pagePlanningLines(ROWS, {}))).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('Party GRN Status', () => {
  it('is a tick-list Sort & Filter field', () => {
    const out = pagePlanningLines(ROWS, {
      sf: JSON.stringify({
        filters: [{ field: 'partyGrnStatus', kind: 'values', values: ['not_done', 'part_done'] }],
      }),
    });
    expect(lineNos(out)).toEqual([2, 3]);
  });

  it('stays out of the search box: "not" or "one" must not match every Not Done line', () => {
    expect(pagePlanningLines(ROWS, { search: 'not done' }).total).toBe(0);
  });
});
