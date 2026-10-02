// SO Cycle Time report service. Mirror of legacy renderSOCycleTime (L18176).
// Per SO: phase-transition durations, plus the averages over the filtered set
// (legacy recomputes them over whatever the filter shows).
//
// ADR-201 (2026-10-02): the screen pages at 25. The Show filter, the search,
// Sort & Filter and the page run HERE over every SO, and the averages are
// worked out over every MATCHING SO — never over the page the screen holds.
// The durations are computed per SO in TypeScript (lib/so-phase-data.ts), so
// the filter / sort run over those rows (sf-memory.ts), not in SQL.

import type {
  SoCycleTimeResponse,
  SoCycleTimeRow,
  SoDurations,
  soCycleTimeQuerySchema,
} from '@innovic/shared';
import type { z } from 'zod';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError } from '../../lib/errors';
import { readSf } from '../../lib/list-query';
import { loadSoPhaseData } from '../../lib/so-phase-data';
import { memSfFilter, memSfSort, type MemSfColumnMap } from './sf-memory';

export type SoCycleTimeQueryParsed = z.output<typeof soCycleTimeQuerySchema>;

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

/** Sort & Filter fields — each the value the screen's column shows. The SO
 *  Status column shows "Completed" once dispatched, so it filters on that. */
const SCT_SF_COLUMNS: MemSfColumnMap<SoCycleTimeRow> = {
  soNo: { type: 'text', get: (r) => r.soNo },
  customer: { type: 'text', get: (r) => r.customer },
  soType: { type: 'list', get: (r) => r.type },
  soStatus: { type: 'list', get: (r) => (r.phases.dispatched ? 'completed' : r.status) },
  design: { type: 'num', get: (r) => r.durations.design },
  material: { type: 'num', get: (r) => r.durations.materialProc },
  production: { type: 'num', get: (r) => r.durations.production },
  qc: { type: 'num', get: (r) => r.durations.qc },
  assembly: { type: 'num', get: (r) => r.durations.assembly },
  dispatch: { type: 'num', get: (r) => r.durations.assemblyToDispatch },
  total: { type: 'num', get: (r) => r.durations.total },
};

function matchesShow(r: SoCycleTimeRow, show: SoCycleTimeQueryParsed['show']): boolean {
  if (show === 'all') return true;
  if (show === 'completed') return Boolean(r.phases.dispatched);
  if (show === 'active') return !r.phases.dispatched;
  return r.type === show;
}

export async function getSoCycleTime(
  user: AuthContext,
  input: SoCycleTimeQueryParsed = { show: 'all', offset: 0 },
): Promise<SoCycleTimeResponse> {
  const companyId = requireCompany(user);
  const sf = readSf(input.sf);
  return withUserContext(user, async (tx) => {
    const data = await loadSoPhaseData(tx, companyId);
    const all: SoCycleTimeRow[] = data.map((d) => ({
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
    const needle = (input.search ?? '').trim().toLowerCase();
    const matching = memSfSort(
      memSfFilter(
        all.filter(
          (r) =>
            matchesShow(r, input.show) &&
            (needle === '' || `${r.soNo} ${r.customer ?? ''}`.toLowerCase().includes(needle)),
        ),
        SCT_SF_COLUMNS,
        sf,
      ),
      SCT_SF_COLUMNS,
      sf,
      // SO No. newest first (as loaded), then id — SO codes are unique.
      (a, b) => (a.soNo === b.soNo ? a.soId.localeCompare(b.soId) : a.soNo < b.soNo ? 1 : -1),
    );
    const averages = Object.fromEntries(AVG_KEYS.map((k) => [k, average(matching, k)])) as Record<
      AvgKey,
      number
    >;
    const rows =
      input.limit === undefined
        ? matching.slice(input.offset)
        : matching.slice(input.offset, input.offset + input.limit);
    return { rows, total: matching.length, averages };
  });
}
