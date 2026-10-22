// Saved Reports never hand money to a user without the Price right on the
// source's page: the Rate / Amount fields leave the source picker, a run drops
// those columns, and a report that filters / sorts / groups / totals by money
// is refused. getMyAccess, the DB context and the SQL runner are replaced, so
// this file never touches a database; run it via
// `pnpm --filter @innovic/api test:unit`.

import type { AdHocSpec, EffectiveAccess } from '@innovic/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../../db/with-user-context';

const state = vi.hoisted(() => ({
  access: null as EffectiveAccess | null,
  ranWith: null as AdHocSpec | null,
}));

vi.mock('../access-control/service', () => ({
  getMyAccess: vi.fn(async () => state.access),
}));
vi.mock('../../db/with-user-context', () => ({
  withUserContext: vi.fn(async (_u: unknown, fn: (tx: unknown) => unknown) => fn({})),
}));
vi.mock('./runner', () => ({
  runAdHoc: vi.fn(async (spec: AdHocSpec) => {
    state.ranWith = spec;
    return { columns: [], rows: [], summary: null, summaryFunction: null, summaryColumn: null };
  }),
}));

const { createSavedReport, listSources, previewAdHocSpec } = await import('./service');
const { AuthorizationError } = await import('../../lib/errors');

const user: AuthContext = {
  id: 'u1',
  email: 'u1@innovic.test',
  companyId: '00000000-0000-0000-0000-0000000000c1',
  role: 'viewer',
  isActive: true,
};

const salesAt = (tier: 'L1' | 'L2'): EffectiveAccess => ({
  fullAccess: false,
  auditor: false,
  drawingDownload: false,
  departments: { sales: tier },
  forms: {},
});

const spec = (p: Partial<AdHocSpec>): AdHocSpec => ({
  sourceKey: 'sales-orders',
  columns: ['so_code', 'qty', 'rate', 'amount'],
  filters: [],
  groupBy: null,
  sumCol: null,
  sumFn: 'SUM',
  sort: [],
  ...p,
});

beforeEach(() => {
  state.access = null;
  state.ranWith = null;
});

describe('saved reports — price-hidden user', () => {
  it('the SO source offers no Rate / Amount to a Sales L1 Viewer', async () => {
    state.access = salesAt('L1');
    const so = (await listSources(user)).sources.find((s) => s.sourceKey === 'sales-orders');
    const keys = so?.fields.map((f) => f.key) ?? [];
    expect(keys).toContain('qty');
    expect(keys).not.toContain('rate');
    expect(keys).not.toContain('amount');
  });

  it('a run drops the money columns and keeps the rest', async () => {
    state.access = salesAt('L1');
    await previewAdHocSpec(spec({}), user);
    expect(state.ranWith?.columns).toEqual(['so_code', 'qty']);
  });

  it('filtering, sorting, grouping or totalling by money is refused', async () => {
    state.access = salesAt('L1');
    const tries: Partial<AdHocSpec>[] = [
      { filters: [{ field: 'rate', op: 'gt', value: '100' }] },
      { sort: [{ field: 'amount', dir: 'desc' }] },
      { sumCol: 'amount', groupBy: 'so_code' },
      { columns: ['rate'] },
    ];
    for (const t of tries) {
      await expect(previewAdHocSpec(spec(t), user)).rejects.toBeInstanceOf(AuthorizationError);
    }
    expect(state.ranWith).toBeNull();
  });

  it('a per-customer COUNT may name a money column — a count reveals nothing', async () => {
    state.access = salesAt('L1');
    await previewAdHocSpec(spec({ groupBy: 'client_name', sumFn: 'COUNT', sumCol: 'rate' }), user);
    expect(state.ranWith?.columns).toEqual(['so_code', 'qty']);
  });

  it('a price-hidden user cannot SAVE a report that uses money', async () => {
    state.access = salesAt('L1');
    const s = spec({ columns: ['so_code', 'rate'] });
    await expect(
      createSavedReport(
        { name: 'x', description: '', sourceKey: s.sourceKey, spec: s, isShared: false },
        user,
      ),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('a Sales L2 (sees price) gets the report unchanged', async () => {
    state.access = salesAt('L2');
    await previewAdHocSpec(spec({ sort: [{ field: 'rate', dir: 'asc' }] }), user);
    expect(state.ranWith?.columns).toEqual(['so_code', 'qty', 'rate', 'amount']);
    const so = (await listSources(user)).sources.find((s) => s.sourceKey === 'sales-orders');
    expect(so?.fields.map((f) => f.key)).toContain('rate');
  });
});
