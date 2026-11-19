// Rev Substitutions (ADR-292) — an Engineering-approved permission to use
// stock of one Drawing Rev where an order / Job Card asks for another, up to a
// qty. Read by the Item Issue and Customer Dispatch Rev checks on the server.
//
// Contract: packages/shared/src/schemas/engineering-change.ts
// (revSubstitutionSchema, createRevSubstitutionInputSchema). The server checks
// the Engineering Change Approve tick and the qty; the screen only hides.
//
// CLAUDE.md §22: every key is built from revSubstitutionKeys.all; the root is
// 'on-open' in REFRESH_POLICY. A save refreshes this list plus the dispatch,
// Item Issue and Store stock screens whose Rev checks read it.

import type { CreateRevSubstitutionInput, RevSubstitution } from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { activityLogKeys } from '@/modules/activity-log/api';
import { dispatchKeys } from '@/modules/customer-dispatches/api';
import { storeIssuesKeys } from '@/modules/store-issues/api';

/** One list row. The display fields beyond revSubstitutionSchema are read
 *  when the server sends them (see the contract note in the report). */
export type RevSubstitutionRow = RevSubstitution & {
  itemCode?: string | null;
  itemName?: string | null;
  /** "IN-SO-00012 Ln 1" / "IN-JW-00004 Ln 2" / "IN-JC-00045". */
  scopeLabel?: string | null;
};

export interface ListRevSubstitutionsQuery {
  search?: string | undefined;
  sf?: string | undefined;
  limit: number;
  offset: number;
}

export interface ListRevSubstitutionsResponse {
  items: RevSubstitutionRow[];
  total: number;
}

export const revSubstitutionKeys = {
  all: ['rev-substitutions'] as const,
  list: (q: ListRevSubstitutionsQuery) =>
    [
      ...revSubstitutionKeys.all,
      'list',
      q.search ?? null,
      q.sf ?? null,
      q.limit,
      q.offset,
    ] as const,
};

function toQs(q: ListRevSubstitutionsQuery): string {
  const p = new URLSearchParams();
  if (q.search) p.set('search', q.search);
  if (q.sf) p.set('sf', q.sf);
  p.set('limit', String(q.limit));
  p.set('offset', String(q.offset));
  return p.toString();
}

/** One page of the list — the list hook's fetcher, also used by the shared
 *  Export (ADR-310). */
export function fetchRevSubstitutionsPage(
  q: ListRevSubstitutionsQuery,
): Promise<ListRevSubstitutionsResponse> {
  return apiFetch<ListRevSubstitutionsResponse>(`/rev-substitutions?${toQs(q)}`);
}

export function useRevSubstitutions(q: ListRevSubstitutionsQuery) {
  return useQuery<ListRevSubstitutionsResponse>({
    queryKey: revSubstitutionKeys.list(q),
    queryFn: () => fetchRevSubstitutionsPage(q),
    placeholderData: (prev) => prev,
  });
}

/** Every screen whose Rev check reads a substitution (§22.4 — imported roots). */
function invalidate(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: revSubstitutionKeys.all });
  void qc.invalidateQueries({ queryKey: dispatchKeys.all });
  void qc.invalidateQueries({ queryKey: storeIssuesKeys.all });
  void qc.invalidateQueries({ queryKey: activityLogKeys.all });
}

export function useCreateRevSubstitution(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<RevSubstitution, Error, CreateRevSubstitutionInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<RevSubstitution>('/rev-substitutions', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: () => invalidate(qc),
  });
}

export function useCancelRevSubstitution() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string }>({
    mutationFn: ({ id }) =>
      apiFetch(`/rev-substitutions/${id}/cancel`, { method: 'POST', json: {} }),
    onSuccess: () => invalidate(qc),
  });
}
