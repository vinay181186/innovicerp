// Edit-approval on a live Plan: Unit Cost (dpCost) and Rate (foRate) are boxes
// for a caller who may see prices, and a vendor box carries the vendor's id with
// its code. Pure, no database: the Plan service and the price check are mocked.
// Run it via `pnpm --filter @innovic/api test:unit`.

import { describe, expect, it, vi } from 'vitest';
import type { UpdatePlanInput } from '@innovic/shared';
import type { AuthContext, DbTransaction } from '../../db/with-user-context';
import { diffFields } from '../../lib/audit-trail';
import type { DocEditTarget } from '../document-edits/registry';

const price = vi.hoisted(() => ({ visible: true }));
vi.mock('./service', () => ({
  EDITABLE_STATUSES: ['in_planning', 'planned'],
  planEditFields: () => [
    { key: 'dpVendorCodeText', label: 'Vendor' },
    { key: 'dpRemarks', label: 'Buy Remarks' },
    { key: 'foVendorCodeText', label: 'JW Vendor' },
    { key: 'remarks', label: 'Plan Remarks' },
  ],
  updatePlanTx: vi.fn(() => Promise.resolve({})),
}));
vi.mock('../../lib/access', () => ({
  canSeeFormPrice: vi.fn(() => Promise.resolve(price.visible)),
}));

const { planEditRegistryEntry: entry } = await import('./plan-edit-registry');

const user: AuthContext = {
  id: 'u-1',
  email: 'planner@innovic.test',
  companyId: 'c-1',
  role: 'manager',
  isActive: true,
};
const noReadsTx = {} as DbTransaction;

const target: DocEditTarget = {
  doc: {
    dpVendorId: 'v-1',
    dpVendorCodeText: 'VEN-A',
    dpCost: '120.00',
    dpRemarks: null,
    foVendorId: null,
    foVendorCodeText: null,
    foRate: null,
    remarks: null,
  },
  updatedAt: '2026-10-01T00:00:00.000Z',
  docCode: 'PLN-0001',
  isLive: true,
};

async function changesFor(input: UpdatePlanInput) {
  const after = await entry.afterSnapshot(noReadsTx, 'c-1', input, user, target);
  return diffFields(entry.beforeSnapshot(target), after, entry.diffFields(target, input));
}

describe('Plan edit-approval — money boxes', () => {
  it('Unit Cost sits right after the buy Vendor, Rate right after the JW Vendor', () => {
    expect(entry.diffFields(target).map((f) => f.key)).toEqual([
      'dpVendorCodeText',
      'dpCost',
      'dpRemarks',
      'foVendorCodeText',
      'foRate',
      'remarks',
    ]);
  });

  it('a Unit Cost / Rate change is a box for a caller who may see prices', async () => {
    price.visible = true;
    const changes = await changesFor({ dpCost: 150, foRate: 30 });
    expect(changes.map((c) => [c.label, c.before, c.after])).toEqual([
      ['Unit Cost', 120, 150],
      ['Rate', null, 30],
    ]);
  });

  it('the same cost resent as a number is not a change', async () => {
    price.visible = true;
    expect(await changesFor({ dpCost: 120 })).toEqual([]);
  });

  it('the decide-time snapshot keeps the cost even for a price-blind approver', async () => {
    price.visible = false;
    const after = await entry.afterSnapshot(noReadsTx, 'c-1', { dpCost: 150 }, user, target, {
      allPrices: true,
    });
    expect(after['dpCost']).toBe(150);
    price.visible = true;
  });

  it('a price-blind caller never stages a cost (their form posts null)', async () => {
    price.visible = false;
    expect(await changesFor({ dpCost: null, foRate: null })).toEqual([]);
    price.visible = true;
  });
});

describe('Plan edit-approval — vendor travels as id + code', () => {
  it('an approved Vendor box carries dpVendorId with the code text', () => {
    const input: UpdatePlanInput = { dpVendorId: 'v-2', dpVendorCodeText: 'VEN-B' };
    expect(entry.buildFilteredInput(input, new Set(['dpVendorCodeText']))).toEqual({
      dpVendorId: 'v-2',
      dpVendorCodeText: 'VEN-B',
    });
  });

  it('an approved Unit Cost box carries dpCost', () => {
    expect(entry.buildFilteredInput({ dpCost: 150 }, new Set(['dpCost']))).toEqual({
      dpCost: 150,
    });
  });
});
