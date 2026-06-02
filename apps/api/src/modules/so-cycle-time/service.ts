// SO Cycle Time report service. Mirror of legacy renderSOCycleTime (L18176).
// Returns every SO with its phase-transition durations + the set averages.
// Filtering + search are client-side (legacy recomputes averages over the
// filtered set on each render); the averages here cover the full set.

import type { SoCycleTimeResponse, SoCycleTimeRow, SoDurations } from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { loadSoPhaseData } from '../../lib/so-phase-data';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

type AvgKey = 'design' | 'production' | 'qc' | 'assembly' | 'total';
const AVG_KEYS: readonly AvgKey[] = ['design', 'production', 'qc', 'assembly', 'total'];

function average(rows: SoCycleTimeRow[], key: AvgKey): number {
  let sum = 0;
  let count = 0;
  for (const r of rows) {
    const v = (r.durations as SoDurations)[key];
    if (v != null) {
      sum += v;
      count += 1;
    }
  }
  return count ? Math.round(sum / count) : 0;
}

export async function getSoCycleTime(user: AuthContext): Promise<SoCycleTimeResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const data = await loadSoPhaseData(tx, companyId);
    const rows: SoCycleTimeRow[] = data.map((d) => ({
      soId: d.soId,
      soNo: d.soNo,
      customer: d.customer,
      type: d.type,
      status: d.status,
      orderQty: d.orderQty,
      dueDate: d.dueDate,
      phases: d.phases,
      durations: d.durations,
    }));
    const averages = Object.fromEntries(AVG_KEYS.map((k) => [k, average(rows, k)])) as Record<
      AvgKey,
      number
    >;
    return { rows, averages };
  });
}
