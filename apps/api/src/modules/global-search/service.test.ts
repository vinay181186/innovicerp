// Pure unit test for the global-search permission filter. Deliberately imports
// ONLY ./permissions (no db/client) so it runs without a database. Do not add
// an integration test here — the api suite hits the production database.

import { GLOBAL_SEARCH_KINDS, type AccessFormPerms, type EffectiveAccess } from '@innovic/shared';
import { describe, expect, it } from 'vitest';
import { allowedSearchKinds } from './permissions';

const perms = (p: Partial<AccessFormPerms>): AccessFormPerms => ({
  view: false,
  entry: false,
  edit: false,
  approve: false,
  price: false,
  priceOff: false,
  viewOff: false,
  entryOff: false,
  editOff: false,
  approveOff: false,
  ...p,
});

const base = (over: Partial<EffectiveAccess>): EffectiveAccess => ({
  fullAccess: false,
  auditor: false,
  drawingDownload: false,
  departments: {},
  forms: {},
  ...over,
});

const ALL = [...GLOBAL_SEARCH_KINDS];

describe('allowedSearchKinds', () => {
  it('admin sees every kind, even with no access row', () => {
    expect(allowedSearchKinds({ role: 'admin' }, null)).toEqual(ALL);
  });

  it('fullAccess (L6) sees every kind', () => {
    expect(allowedSearchKinds({ role: 'viewer' }, base({ fullAccess: true }))).toEqual(ALL);
  });

  it('purchase L3 sees exactly the purchase kinds and nothing else', () => {
    const eff = base({ departments: { purchase: 'L3' } });
    expect(allowedSearchKinds({ role: 'viewer' }, eff)).toEqual([
      'purchase-request',
      'purchase-order',
      'delivery-challan',
      'vendor',
    ]);
  });

  it('Hide page (viewOff) on so_create removes sales-order only for a sales L3 user', () => {
    const eff = base({
      departments: { sales: 'L3' },
      forms: { so_create: perms({ viewOff: true }) },
    });
    const kinds = allowedSearchKinds({ role: 'viewer' }, eff);
    expect(kinds).not.toContain('sales-order');
    // The other sales-department kinds stay visible.
    expect(kinds).toEqual(['job-work-order', 'client']);
  });

  it('auditor (read-everything flag) sees every kind', () => {
    expect(allowedSearchKinds({ role: 'viewer' }, base({ auditor: true }))).toEqual(ALL);
  });

  it('unconfigured access row sees nothing', () => {
    expect(allowedSearchKinds({ role: 'viewer' }, base({}))).toEqual([]);
  });

  it('null access (no row loaded) sees nothing', () => {
    expect(allowedSearchKinds({ role: 'viewer' }, null)).toEqual([]);
  });
});
