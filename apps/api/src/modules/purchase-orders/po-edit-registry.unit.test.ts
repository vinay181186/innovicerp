// Edit-approval on a live PO: every field the PO edit form can change becomes an
// approvable box — nothing is dropped on approval. Pure, no database: the writer
// and the price check are mocked, and the one read applyEdit makes (the PO's
// current lines) is served by a tiny fake transaction. Run it via
// `pnpm --filter @innovic/api test:unit`.

import { describe, expect, it, vi } from 'vitest';
import type { PurchaseOrderLineInput, UpdatePurchaseOrderInput } from '@innovic/shared';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { diffFields } from '../../lib/audit-trail';
import type { DocEditTarget } from '../document-edits/registry';

const writer = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('./service', () => ({
  updatePurchaseOrderTx: vi.fn((_tx: unknown, _id: string, input: unknown) => {
    writer.calls.push(input);
    return Promise.resolve({});
  }),
}));
vi.mock('../../lib/access', () => ({ canSeeFormPrice: vi.fn(() => Promise.resolve(true)) }));

const { poEditRegistryEntry: entry } = await import('./po-edit-registry');

const user: AuthContext = {
  id: 'u-1',
  email: 'buyer@innovic.test',
  companyId: 'c-1',
  role: 'manager',
  isActive: true,
};

/** Every select resolves to the next queued result, whatever the chain. */
function fakeTx(results: unknown[][]): DbTransaction {
  const select = (): unknown => {
    const b: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'leftJoin', 'orderBy', 'limit', 'for']) b[m] = () => b;
    b['then'] = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(results.shift() ?? []).then(res, rej);
    return b;
  };
  return { select } as unknown as DbTransaction;
}

const LINE = {
  id: 'l-1',
  lineNo: 1,
  itemId: null,
  itemCodeText: 'BRK-01',
  itemCode: 'BRK-01',
  itemName: 'Bracket',
  qty: '10.000',
  rate: '50.00',
  dueDate: '2026-11-01',
  ramRemark: null,
  lineRemarks: 'old note',
  sourcePrId: null,
  sourcePrCode: null,
  sourceSoLineId: null,
  sourceJcOpId: null,
  sourceNcId: null,
};

const target: DocEditTarget = {
  doc: {
    poDate: '2026-10-01',
    vendorId: null,
    vendorCodeText: 'VEN-A',
    vendorCode: 'VEN-A',
    poType: 'standard',
    dueDate: null,
    prCodeText: null,
    remarks: null,
    approvalRemarks: null,
    sgstPct: '9.00',
    cgstPct: '9.00',
    igstPct: '0.00',
    lines: [LINE],
  },
  updatedAt: '2026-10-01T00:00:00.000Z',
  docCode: 'IN-MPO-00001/R1',
  isLive: true,
};

const proposedLine = (over: Partial<PurchaseOrderLineInput>): PurchaseOrderLineInput => ({
  id: 'l-1',
  itemCodeText: 'BRK-01',
  itemName: 'Bracket',
  qty: 10,
  rate: 50,
  dueDate: '2026-11-01',
  lineRemarks: 'old note',
  ...over,
});

async function changesFor(input: UpdatePurchaseOrderInput) {
  const after = await entry.afterSnapshot(fakeTx([]), 'c-1', input, user, target);
  return diffFields(entry.beforeSnapshot(target), after, entry.diffFields(target, input));
}

describe('PO edit-approval — line paperwork fields are boxes', () => {
  it('Due Date, Item Name, Ram Remark and Remarks each become one box', async () => {
    const changes = await changesFor({
      header: {},
      lines: [
        proposedLine({
          itemName: 'Bracket LH',
          dueDate: '2026-11-15',
          ramRemark: 'urgent',
          lineRemarks: 'new note',
        }),
      ],
    });
    expect(changes.map((c) => [c.field, c.label])).toEqual([
      ['line:l-1:itemName', 'Line 1 · Item Name'],
      ['line:l-1:dueDate', 'Line 1 · Due Date'],
      ['line:l-1:ramRemark', 'Line 1 · Ram Remark'],
      ['line:l-1:lineRemarks', 'Line 1 · Remarks'],
    ]);
  });

  it('an unchanged resend is "nothing changed", not a box', async () => {
    expect(await changesFor({ header: {}, lines: [proposedLine({})] })).toEqual([]);
  });

  it('stray spaces on either side never make a box', async () => {
    const spaced: DocEditTarget = {
      ...target,
      doc: { ...target.doc, lines: [{ ...LINE, itemName: 'Bracket ', lineRemarks: ' old note' }] },
    };
    const input: UpdatePurchaseOrderInput = {
      header: {},
      lines: [proposedLine({ itemName: ' Bracket', lineRemarks: 'old note ' })],
    };
    const after = await entry.afterSnapshot(fakeTx([]), 'c-1', input, user, spaced);
    expect(
      diffFields(entry.beforeSnapshot(spaced), after, entry.diffFields(spaced, input)),
    ).toEqual([]);
  });

  it('an omitted paperwork field is not a change (the writer leaves it alone)', async () => {
    const withoutPaperwork = proposedLine({});
    delete withoutPaperwork.dueDate;
    delete withoutPaperwork.lineRemarks;
    const changes = await changesFor({ header: {}, lines: [withoutPaperwork] });
    expect(changes).toEqual([]);
  });
});

describe('PO edit-approval — header', () => {
  it('Approval Remarks is a box and is carried to the writer', async () => {
    const input: UpdatePurchaseOrderInput = { header: { approvalRemarks: 'ok by MD' } };
    const changes = await changesFor(input);
    expect(changes.map((c) => c.label)).toEqual(['Approval Remarks']);
    const filtered = entry.buildFilteredInput(input, new Set(['approvalRemarks'])) as {
      header: Record<string, unknown>;
    };
    expect(filtered.header).toEqual({ approvalRemarks: 'ok by MD' });
  });

  it('a free-text vendor change (no master id) is a Vendor box', async () => {
    const changes = await changesFor({ header: { vendorCodeText: 'VEN-B' } });
    expect(changes).toEqual([
      { field: 'vendorId', label: 'Vendor', before: 'VEN-A', after: 'VEN-B' },
    ]);
  });
});

describe('PO edit-approval — applyEdit writes only the approved line attrs', () => {
  it('approved Ram Remark is written; rejected Item Name keeps its current value', async () => {
    writer.calls.length = 0;
    const input: UpdatePurchaseOrderInput = {
      header: {},
      lines: [proposedLine({ itemName: 'Bracket LH', ramRemark: 'urgent' })],
    };
    const filtered = entry.buildFilteredInput(input, new Set(['line:l-1:ramRemark']));
    const current = {
      id: 'l-1',
      lineNo: 1,
      itemId: null,
      itemCodeText: 'BRK-01',
      itemName: 'Bracket',
      qty: '10.000',
      rate: '50.00',
      dueDate: '2026-11-01',
      sourcePrId: null,
      sourceJcOpId: null,
      sourceSoLineId: null,
      ramRemark: null,
      lineRemarks: 'old note',
    };
    await entry.applyEdit(fakeTx([[current]]), 'c-1', 'po-1', filtered, 'tok', user);
    const sent = writer.calls[0] as UpdatePurchaseOrderInput;
    expect(sent.lines).toHaveLength(1);
    expect(sent.lines?.[0]).toMatchObject({
      id: 'l-1',
      itemName: 'Bracket',
      ramRemark: 'urgent',
      lineRemarks: 'old note',
      dueDate: '2026-11-01',
    });
  });
});
