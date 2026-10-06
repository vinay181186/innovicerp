// The Production people, as configured in Access Control.
//
// The "Issued To" box on Issue from Store used to be a list of OPERATOR names
// plus a typed name. Operators are shop-floor machinists, and a typed name links
// the issue to nobody. Access Control already knows who Production is — the user
// configures it there — so that is the list the dropdown comes from.
//
// Who is in it (decided server-side): anyone Access Control granted the right to
// make a Production entry, plus Full Access accounts. View-only tiers fall out on
// their own — they grant no entry. The list arrives already ordered with the real
// Production team first.

import type { ListProductionUserOptionsResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const productionUserKeys = {
  options: ['production-user-options'] as const,
};

/** Shared by every "Issued To" field, so the app fetches this once and reuses it.
 *  60s stale window matches the QC people-picker (useQcUserOptions): Access
 *  Control changes are rare, and a new Production user showing up a minute later
 *  is fine. */
export function useProductionUserOptions() {
  return useQuery<ListProductionUserOptionsResponse>({
    queryKey: productionUserKeys.options,
    queryFn: () =>
      apiFetch<ListProductionUserOptionsResponse>('/access-control/production-users'),
    staleTime: 60_000,
  });
}
