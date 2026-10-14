// ADR-231 — the fifth action, `advance` (move a saved record to its next step).
//
// requireFormAccess is generic over the action; this proves the new one is
// wired through: an L1 Viewer is refused with the Advance wording, an L2 Entry
// hand passes. getMyAccess is replaced so the file never touches a database;
// run it via `pnpm --filter @innovic/api test:unit`.

import type { EffectiveAccess } from '@innovic/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../db/with-user-context';

const access = vi.hoisted(() => ({ current: null as EffectiveAccess | null }));

vi.mock('../modules/access-control/service', () => ({
  getMyAccess: vi.fn(async () => access.current),
}));

const { requireFormAccess } = await import('./access');
const { AuthorizationError } = await import('./errors');

const user: AuthContext = {
  id: 'u1',
  email: 'u1@innovic.test',
  companyId: '00000000-0000-0000-0000-0000000000c1',
  role: 'viewer',
  isActive: true,
};

const productionAt = (tier: 'L1' | 'L2'): EffectiveAccess => ({
  fullAccess: false,
  auditor: false,
  drawingDownload: false,
  departments: { production: tier },
  forms: {},
});

beforeEach(() => {
  access.current = null;
});

describe('requireFormAccess — advance (ADR-231)', () => {
  it('refuses an L1 Viewer, naming the Advance tick', async () => {
    access.current = productionAt('L1');
    const attempt = requireFormAccess(user, 'prodorder_create', 'advance');
    await expect(attempt).rejects.toBeInstanceOf(AuthorizationError);
    await expect(requireFormAccess(user, 'prodorder_create', 'advance')).rejects.toThrow(
      /move records forward in Production Orders.*tick Advance/,
    );
  });

  it('passes an L2 Entry user', async () => {
    access.current = productionAt('L2');
    await expect(requireFormAccess(user, 'prodorder_create', 'advance')).resolves.toBeUndefined();
  });

  it('L2 still cannot edit — Advance does not bring Edit with it', async () => {
    access.current = productionAt('L2');
    await expect(requireFormAccess(user, 'prodorder_create', 'edit')).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
