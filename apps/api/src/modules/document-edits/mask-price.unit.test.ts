// Price hiding on edit requests ("Can See Price"): a change that is a price by
// the one narrow list (./price-field.ts) has its before → after nulled for a
// viewer who may not see prices on that entry's form. Pure, no database: the
// registry and the price check are mocked. Run it via
// `pnpm --filter @innovic/api test:unit`.

import { describe, expect, it, vi } from 'vitest';
import type { DocumentEditChange, DocumentEditRow } from '@innovic/shared';
import type { AuthContext } from '../../db/with-user-context';
import { isPriceField } from './price-field';

const price = vi.hoisted(() => ({ visible: false, asked: [] as string[] }));
vi.mock('./registry', () => ({
  DOC_EDIT_REGISTRY: {
    Plan: { formKey: 'plan_create' },
    Item: { formKey: 'item_create' },
  },
}));
vi.mock('../../lib/access', () => ({
  canSeeFormPrice: vi.fn((_u: unknown, formKey: string) => {
    price.asked.push(formKey);
    return Promise.resolve(price.visible);
  }),
}));

const { maskPriceChanges } = await import('./helpers');

const user: AuthContext = {
  id: 'u-1',
  email: 'viewer@innovic.test',
  companyId: 'c-1',
  role: 'viewer',
  isActive: true,
};

const change = (field: string, label: string, before: unknown, after: unknown) =>
  ({ id: field, field, label, before, after }) as DocumentEditChange;

const row = (entity: 'Plan' | 'Item', changes: DocumentEditChange[]): DocumentEditRow =>
  ({
    id: `r-${entity}`,
    entity,
    entityId: 'd-1',
    docCode: 'X',
    status: 'pending',
    changes,
    decisions: [],
    isStale: true,
  }) as unknown as DocumentEditRow;

const planRow = (): DocumentEditRow =>
  row('Plan', [
    change('dpCost', 'Unit Cost', 120, 150),
    change('remarks', 'Plan Remarks', null, 'hi'),
  ]);

describe('isPriceField — the narrow list of price boxes', () => {
  it.each(['dpCost', 'foRate', 'hourRate', 'estCost', 'line:2f1c:rate', 'op:9a7b:outsourceCost'])(
    '%s is a price',
    (field) => {
      expect(isPriceField(field)).toBe(true);
    },
  );

  it.each([
    'gstPercent',
    'gstNumber',
    'gstCategory',
    'paymentDays',
    'paymentTermsDays',
    'name',
    'type',
    'foCostCenter',
    'line:2f1c:itemName',
    'op:add:0',
    'op:9a7b:operation',
    'rawMaterialItem',
  ])('%s is not a price', (field) => {
    expect(isPriceField(field)).toBe(false);
  });
});

describe('maskPriceChanges', () => {
  it('nulls only the price change for a price-blind viewer, and keeps isStale', async () => {
    price.visible = false;
    const [r] = await maskPriceChanges([planRow()], user);
    expect(r?.changes.map((c) => [c.field, c.before, c.after])).toEqual([
      ['dpCost', null, null],
      ['remarks', null, 'hi'],
    ]);
    expect(r?.isStale).toBe(true);
  });

  it('leaves prices for a viewer who may see them, asking once per entity type', async () => {
    price.visible = true;
    price.asked.length = 0;
    const rows = await maskPriceChanges([planRow(), planRow()], user);
    expect(rows[0]?.changes[0]?.after).toBe(150);
    expect(price.asked).toEqual(['plan_create']);
  });

  it('a request with no money change is never masked nor asked about', async () => {
    price.visible = false;
    price.asked.length = 0;
    const [r] = await maskPriceChanges(
      [row('Item', [change('name', 'Item Name', 'A', 'B')])],
      user,
    );
    expect(r?.changes[0]?.after).toBe('B');
    expect(price.asked).toEqual([]);
  });
});
