// ADR-250 — which department's blocks come first on the home. The caller's
// Access Control main department; else the department where they hold the
// highest tier (ties by the fixed order below); an admin / Full Access account
// with no main department gets no derived one — just the fixed order.

import { ACCESS_TIER_KEYS, normalizeDeptsMap } from '@innovic/shared';
import type { DashAccess } from '../access';

export const DEPT_ORDER = [
  'purchase',
  'store',
  'qc',
  'planning',
  'production',
  'sales',
  'design',
  'finance',
] as const;

const rank = (dept: string): number => {
  const i = (DEPT_ORDER as readonly string[]).indexOf(dept);
  return i < 0 ? DEPT_ORDER.length : i;
};

export function resolveMainDept(stored: string | null, a: DashAccess): string | null {
  if (stored && stored.trim()) return stored.trim();
  if (a.isAdmin || a.eff.fullAccess) return null;
  const tiers = normalizeDeptsMap(a.eff.departments ?? {});
  let best: { dept: string; tier: number } | null = null;
  for (const dept of DEPT_ORDER) {
    const t = tiers[dept];
    if (!t) continue;
    const tier = (ACCESS_TIER_KEYS as readonly string[]).indexOf(t);
    if (!best || tier > best.tier) best = { dept, tier };
  }
  return best?.dept ?? null;
}

/** Main department first, then the fixed order; stable within a department. */
export function orderByDept<T extends { dept: string }>(
  items: readonly T[],
  main: string | null,
): T[] {
  return items
    .map((it, i) => ({ it, i }))
    .sort((x, y) => {
      const rx = x.it.dept === main ? -1 : rank(x.it.dept);
      const ry = y.it.dept === main ? -1 : rank(y.it.dept);
      return rx - ry || x.i - y.i;
    })
    .map(({ it }) => it);
}
