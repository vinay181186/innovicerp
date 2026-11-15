// Engineering Change (ECR, ADR-291) — TanStack Query hooks.
//
// Contract: packages/shared/src/schemas/engineering-change.ts. Every write is
// a server decision: the server numbers the ECR (ADR-227), builds the impact
// list and the holds on Submit, checks each approver's department tier, and
// answers 409 when someone acted first (§20). The screen never guesses.
//
// CLAUDE.md §22: every key is built from ecrKeys.all; the root is 'poll' in
// REFRESH_POLICY (other people's approvals change an open ECR). Every save
// refreshes the ECR screens, Approvals, the home page, the JC board, the Job
// Card / Production Order screens (holds, new PRO / JC) and the Drawing Revs.

import type {
  CreateEcrInput,
  DecideEcrInput,
  Ecr,
  EcrActionInput,
  ListEcrQuery,
  ListEcrResponse,
  SetEcrDispositionsInput,
  SubmitEcrInput,
  UpdateEcrInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { LIVE_FALLBACK_POLL_MS } from '@/lib/live-updates/constants';
import { type SaveKey, withSaveKey } from '@/lib/use-save-key';
import { approvalsKeys } from '@/modules/approvals/api';
import { dashboardKeys, notificationKeys } from '@/modules/dashboard/api';
import { itemRevisionKeys } from '@/modules/item-revisions/api';
import { jcOpsBoardKeys } from '@/modules/jc-ops/api';
import { jobCardsKeys } from '@/modules/job-cards/api';
import { productionOrdersKeys } from '@/modules/production-orders/api';

export const ecrKeys = {
  all: ['ecrs'] as const,
  lists: () => [...ecrKeys.all, 'list'] as const,
  list: (q: ListEcrQuery) => [...ecrKeys.lists(), q] as const,
  details: () => [...ecrKeys.all, 'detail'] as const,
  detail: (id: string) => [...ecrKeys.details(), id] as const,
};

function toQueryString(q: ListEcrQuery): string {
  const p = new URLSearchParams();
  if (q.search) p.set('search', q.search);
  if (q.status) p.set('status', q.status);
  if (q.sf) p.set('sf', q.sf);
  p.set('limit', String(q.limit));
  p.set('offset', String(q.offset));
  return p.toString();
}

export function useEcrList(q: ListEcrQuery) {
  return useQuery<ListEcrResponse>({
    queryKey: ecrKeys.list(q),
    queryFn: () => apiFetch<ListEcrResponse>(`/ecrs?${toQueryString(q)}`),
    placeholderData: (prev) => prev,
    // ADR-230 safety refresh: approvals and holds change by other people.
    refetchInterval: LIVE_FALLBACK_POLL_MS,
  });
}

export function useEcr(id: string | undefined) {
  return useQuery<Ecr>({
    queryKey: ecrKeys.detail(id ?? '__missing__'),
    queryFn: () => apiFetch<Ecr>(`/ecrs/${id}`),
    enabled: Boolean(id),
    refetchInterval: LIVE_FALLBACK_POLL_MS,
  });
}

/** Every screen an ECR write can change (§22.4 — imported factories only). */
export function invalidateEcrScreens(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: ecrKeys.all });
  void qc.invalidateQueries({ queryKey: approvalsKeys.all });
  void qc.invalidateQueries({ queryKey: dashboardKeys.home() });
  void qc.invalidateQueries({ queryKey: notificationKeys.all });
  void qc.invalidateQueries({ queryKey: jcOpsBoardKeys.all });
  void qc.invalidateQueries({ queryKey: jobCardsKeys.all });
  void qc.invalidateQueries({ queryKey: productionOrdersKeys.all });
  void qc.invalidateQueries({ queryKey: itemRevisionKeys.all });
}

function useEcrMutation<V>(
  call: (v: V, headers: Record<string, string> | undefined) => Promise<Ecr>,
  saveKey?: SaveKey,
) {
  const qc = useQueryClient();
  return useMutation<Ecr, Error, V>({
    mutationFn: (v) => withSaveKey(saveKey, (headers) => call(v, headers)),
    onSuccess: (ecr) => {
      invalidateEcrScreens(qc);
      qc.setQueryData(ecrKeys.detail(ecr.id), ecr);
    },
  });
}

const opts = (headers: Record<string, string> | undefined) => (headers ? { headers } : {});

export function useCreateEcr(saveKey?: SaveKey) {
  return useEcrMutation<CreateEcrInput>(
    (input, h) => apiFetch<Ecr>('/ecrs', { method: 'POST', json: input, ...opts(h) }),
    saveKey,
  );
}

export function useUpdateEcr(id: string, saveKey?: SaveKey) {
  return useEcrMutation<UpdateEcrInput>(
    (input, h) => apiFetch<Ecr>(`/ecrs/${id}`, { method: 'PATCH', json: input, ...opts(h) }),
    saveKey,
  );
}

export function useSubmitEcr(id: string, saveKey?: SaveKey) {
  return useEcrMutation<SubmitEcrInput>(
    (input, h) => apiFetch<Ecr>(`/ecrs/${id}/submit`, { method: 'POST', json: input, ...opts(h) }),
    saveKey,
  );
}

export function useSetEcrDispositions(id: string, saveKey?: SaveKey) {
  return useEcrMutation<SetEcrDispositionsInput>(
    (input, h) =>
      apiFetch<Ecr>(`/ecrs/${id}/dispositions`, { method: 'PUT', json: input, ...opts(h) }),
    saveKey,
  );
}

/** One sign-off (Design / Quality / Production). Also used by the Approvals
 *  page for kind 'ecr' rows. */
export function useDecideEcr() {
  return useEcrMutation<{ id: string } & DecideEcrInput>(({ id, ...input }) =>
    apiFetch<Ecr>(`/ecrs/${id}/decide`, { method: 'POST', json: input }),
  );
}

export function useImplementEcr(id: string, saveKey?: SaveKey) {
  return useEcrMutation<{ expectedUpdatedAt: string }>(
    (input, h) =>
      apiFetch<Ecr>(`/ecrs/${id}/implement`, { method: 'POST', json: input, ...opts(h) }),
    saveKey,
  );
}

/** Cancel or Close — same input (ecrActionInputSchema). */
export function useEcrAction(action: 'cancel' | 'close') {
  return useEcrMutation<{ id: string } & EcrActionInput>(({ id, ...input }) =>
    apiFetch<Ecr>(`/ecrs/${id}/${action}`, { method: 'POST', json: input }),
  );
}
