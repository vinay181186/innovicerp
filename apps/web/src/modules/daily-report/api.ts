import type {
  DailyReportMachineGroup,
  DailyReportQuery,
  DailyReportResponse,
} from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { fetchAllPages } from '@/lib/list-paging';

export const dailyReportKeys = {
  all: ['daily-report'] as const,
  view: (q: DailyReportQuery) =>
    [
      ...dailyReportKeys.all,
      q.date,
      q.machineId ?? null,
      q.limit ?? null,
      q.offset ?? null,
    ] as const,
};

function buildQs(q: DailyReportQuery): string {
  const p = new URLSearchParams();
  p.set('date', q.date);
  if (q.machineId) p.set('machineId', q.machineId);
  if (q.limit != null) p.set('limit', String(q.limit));
  if (q.offset != null) p.set('offset', String(q.offset));
  return p.toString();
}

/** A group's identity across pages (a text-only machine has no id). */
export function dailyGroupKey(g: DailyReportMachineGroup): string {
  return g.machineId ?? `__txt:${g.machineCode}`;
}

/**
 * The WHOLE day (every row of every machine), fetched page by page — for the
 * printed report, which must never hold just the 25 rows on screen.
 */
export async function fetchFullDailyReport(
  q: Pick<DailyReportQuery, 'date' | 'machineId'>,
): Promise<DailyReportResponse> {
  let last: DailyReportResponse | null = null;
  const tagged = await fetchAllPages(async (limit, offset) => {
    const res = await apiFetch<DailyReportResponse>(
      `/daily-report?${buildQs({ ...q, limit, offset })}`,
    );
    last = res;
    const items = res.groups.flatMap((g) => g.rows.map((row) => ({ g, row })));
    return { items, total: res.total ?? items.length };
  });
  const groups = new Map<string, DailyReportMachineGroup>();
  for (const { g, row } of tagged) {
    const key = dailyGroupKey(g);
    const grp = groups.get(key) ?? { ...g, rows: [] };
    grp.rows.push(row);
    groups.set(key, grp);
  }
  const base = last as DailyReportResponse | null;
  return {
    date: q.date,
    machineId: q.machineId ?? null,
    summary: base?.summary ?? { totalPieces: 0, logEntries: 0, machinesActive: 0, jcsActive: 0 },
    groups: Array.from(groups.values()),
    total: tagged.length,
  };
}

export function useDailyReport(query: DailyReportQuery) {
  return useQuery<DailyReportResponse>({
    queryKey: dailyReportKeys.view(query),
    queryFn: () => apiFetch<DailyReportResponse>(`/daily-report?${buildQs(query)}`),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}
