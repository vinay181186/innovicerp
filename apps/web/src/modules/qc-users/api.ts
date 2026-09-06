// The QC people, as configured in Access Control.
//
// Every "QC By" box used to be free text or a list of OPERATORS. Operators are
// shop-floor machinists — they run the machines, they do not sign off an
// inspection — so that list named the wrong people, and a typed name linked the
// inspection to nobody. The user already tells the system who the QC people are
// when they set up Access Control, so that is the list the dropdown comes from.
//
// Who is in it (decided server-side): anyone with a Quality tier of L2 or above,
// plus Full Access accounts. L1 is left out on purpose — L1 is view-only, so an
// L1 person may read Quality screens but may not sign off an inspection. The
// list arrives already ordered with the real QC team first.

import type { ListQcUserOptionsResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const qcUserKeys = {
  options: ['qc-user-options'] as const,
};

/** Shared by every QC By field, so the app fetches this once and reuses it.
 *  60s stale window matches the other people-picker (tasks' useTaskUserOptions):
 *  Access Control changes are rare, and a new QC user showing up a minute later
 *  is fine. */
export function useQcUserOptions() {
  return useQuery<ListQcUserOptionsResponse>({
    queryKey: qcUserKeys.options,
    queryFn: () => apiFetch<ListQcUserOptionsResponse>('/access-control/qc-users'),
    staleTime: 60_000,
  });
}
