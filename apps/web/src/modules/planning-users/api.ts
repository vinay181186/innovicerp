// The Planning people, as configured in Access Control.
//
// `Assembled By` on the Assembly Tracker's Start panel used to be a free-text
// box, so whoever built a machine was whatever anyone typed — unsearchable,
// unlinkable, and spelled differently by every clerk. Access Control already
// knows who Planning is — the user configures it there — so that is the list
// the dropdown comes from.
//
// Who is in it (decided server-side): anyone Access Control granted the right
// to make a Planning entry — a Planning form grant, not a tier comparison —
// plus Full Access accounts. View-only tiers fall out on their own: they grant
// no entry. The list arrives already ordered with the real Planning team first.

import type { ListPlanningUserOptionsResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const planningUserKeys = {
  options: ['planning-user-options'] as const,
};

/** Shared by every "Assembled By" field, so the app fetches this once and
 *  reuses it. 60s stale window matches the Production and QC people-pickers
 *  (useProductionUserOptions / useQcUserOptions): Access Control changes are
 *  rare, and a new Planning user showing up a minute later is fine.
 *  No params — the response is small and the picker filters client-side. */
export function usePlanningUserOptions() {
  return useQuery<ListPlanningUserOptionsResponse>({
    queryKey: planningUserKeys.options,
    queryFn: () => apiFetch<ListPlanningUserOptionsResponse>('/access-control/planning-users'),
    staleTime: 60_000,
  });
}
