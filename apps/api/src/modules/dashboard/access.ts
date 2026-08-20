// Dashboard dept-access helper. Mirror of legacy _hasDeptAccess / _getUserAccess.
// Admin/manager see everything; otherwise fullAccess or the per-dept flag.

import { type EffectiveAccess, normalizeDeptsMap } from '@innovic/shared';
import type { AuthContext } from '../../db/with-user-context';
import { getMyAccess } from '../access-control/service';

export interface DashAccess {
  role: string;
  isAdmin: boolean;
  isManager: boolean;
  eff: EffectiveAccess;
}

export async function loadAccess(user: AuthContext): Promise<DashAccess> {
  const eff = await getMyAccess(user);
  return {
    role: user.role,
    isAdmin: user.role === 'admin',
    isManager: user.role === 'manager',
    eff,
  };
}

export function hasDept(a: DashAccess, dept: string | null): boolean {
  if (!dept) return true;
  if (a.isAdmin || a.isManager) return true;
  if (a.eff.fullAccess) return true;
  // L7 Auditor reads every department by definition (0100).
  if (a.eff.auditor) return true;
  // Since 0100 the map holds a tier key, not `true` — any tier means the
  // department is theirs. `normalizeDeptsMap` also accepts pre-0100 rows.
  return normalizeDeptsMap(a.eff.departments ?? {})[dept] !== undefined;
}

// First department the user has access to, in legacy priority order
// (_detectPrimaryDept L2522). Null if none.
const PRIMARY_DEPT_ORDER = [
  'qc',
  'purchase',
  'design',
  'sales',
  'store',
  'production',
  'finance',
  'planning',
] as const;

export function detectPrimaryDept(a: DashAccess): string | null {
  const depts = normalizeDeptsMap(a.eff.departments ?? {});
  for (const d of PRIMARY_DEPT_ORDER) {
    if (depts[d]) return d;
  }
  return null;
}
