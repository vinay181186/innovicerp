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
      'jw-dc-outward',
      'vendor',
      'jw-dc-inward',
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
    expect(kinds).toEqual(['job-work-order', 'client', 'customer-dispatch', 'jw-return']);
  });

  it('capa needs BOTH nc_dispose and capa_create: hiding capa_create removes capa, keeps nc', () => {
    // Positive first: a plain QC L3 user gets both NC and CAPA.
    const qc = allowedSearchKinds({ role: 'viewer' }, base({ departments: { qc: 'L3' } }));
    expect(qc).toContain('capa');
    expect(qc).toContain('nc');
    const eff = base({
      departments: { qc: 'L3' },
      forms: { capa_create: perms({ viewOff: true }) },
    });
    const kinds = allowedSearchKinds({ role: 'viewer' }, eff);
    expect(kinds).toContain('nc');
    expect(kinds).not.toContain('capa');
  });

  it('tool-issue needs BOTH issue_create and toolissue_create: hiding toolissue_create keeps store-issue', () => {
    // Positive first: a plain Store L3 user gets both registers.
    const store = allowedSearchKinds({ role: 'viewer' }, base({ departments: { store: 'L3' } }));
    expect(store).toContain('tool-issue');
    expect(store).toContain('store-issue');
    const eff = base({
      departments: { store: 'L3' },
      forms: { toolissue_create: perms({ viewOff: true }) },
    });
    const kinds = allowedSearchKinds({ role: 'viewer' }, eff);
    expect(kinds).toContain('store-issue');
    expect(kinds).not.toContain('tool-issue');
  });

  it('task is gated by the Tasks department, not a form key', () => {
    // A tasks-only user sees task and nothing else …
    const tasksOnly = base({ departments: { tasks: 'L1' } });
    expect(allowedSearchKinds({ role: 'viewer' }, tasksOnly)).toEqual(['task']);
    // … and a purchase-only user does not see task.
    const purchaseOnly = base({ departments: { purchase: 'L3' } });
    expect(allowedSearchKinds({ role: 'viewer' }, purchaseOnly)).not.toContain('task');
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
