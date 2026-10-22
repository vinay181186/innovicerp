// The Cost Summary tile (PO spend in rupees) needs the Price right on Purchase
// Orders, not just the Finance department. Pure — no database; run it via
// `pnpm --filter @innovic/api test:unit`.

import { DASHBOARD_WIDGETS, type EffectiveAccess } from '@innovic/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../access-control/service', () => ({ getMyAccess: vi.fn() }));

const { canSeeWidget } = await import('./access');

const cost = DASHBOARD_WIDGETS.find((w) => w.key === 'cost_summary');
if (!cost) throw new Error('cost_summary widget missing');

const dash = (departments: EffectiveAccess['departments'], isAdmin = false) => ({
  role: isAdmin ? 'admin' : 'manager',
  isAdmin,
  isManager: !isAdmin,
  eff: { fullAccess: false, auditor: false, drawingDownload: false, departments, forms: {} },
});

describe('Cost Summary tile', () => {
  it('Finance alone is not enough — PO Price decides', () => {
    expect(canSeeWidget(dash({ finance: 'L5' }), cost)).toBe(false);
    expect(canSeeWidget(dash({ finance: 'L5', purchase: 'L1' }), cost)).toBe(false);
    expect(canSeeWidget(dash({ finance: 'L5', purchase: 'L2' }), cost)).toBe(true);
  });

  it('admin always sees it', () => {
    expect(canSeeWidget(dash({}, true), cost)).toBe(true);
  });
});
