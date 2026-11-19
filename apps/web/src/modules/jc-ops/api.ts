import type {
  ChangeJcOpMachineInput,
  ListJcOpsBoardQuery,
  ListJcOpsBoardResponse,
  OutsourceOpBalanceInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const jcOpsBoardKeys = {
  all: ['jc-ops-board'] as const,
  list: (q: ListJcOpsBoardQuery) =>
    [
      ...jcOpsBoardKeys.all,
      'list',
      q.jcCode ?? null,
      q.search ?? null,
      q.sf ?? null,
      q.limit,
      q.offset,
    ] as const,
};

function buildQs(q: ListJcOpsBoardQuery): string {
  const p = new URLSearchParams();
  if (q.jcCode) p.set('jcCode', q.jcCode);
  if (q.search) p.set('search', q.search);
  if (q.sf) p.set('sf', q.sf);
  p.set('limit', String(q.limit));
  p.set('offset', String(q.offset));
  return p.toString();
}

/** One page of GET /jc-ops — the board hook's fetcher, also used by the
 *  shared Export (ADR-310). */
export function fetchJcOpsBoardPage(query: ListJcOpsBoardQuery): Promise<ListJcOpsBoardResponse> {
  return apiFetch<ListJcOpsBoardResponse>(`/jc-ops?${buildQs(query)}`);
}

export function useJcOpsBoard(query: ListJcOpsBoardQuery) {
  return useQuery<ListJcOpsBoardResponse>({
    queryKey: jcOpsBoardKeys.list(query),
    queryFn: () => fetchJcOpsBoardPage(query),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useChangeJcOpMachine() {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, Error, { id: string; input: ChangeJcOpMachineInput }>({
    mutationFn: ({ id, input }) =>
      apiFetch<{ ok: true }>(`/jc-ops/${id}/machine`, { method: 'PATCH', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jcOpsBoardKeys.all });
    },
  });
}

// ADR-081 dual-lane — outsource the remaining qty of an in-house process op.
export function useOutsourceOpBalance() {
  const qc = useQueryClient();
  return useMutation<
    { prId: string; prCode: string },
    Error,
    { id: string; input: OutsourceOpBalanceInput }
  >({
    mutationFn: ({ id, input }) =>
      apiFetch<{ prId: string; prCode: string }>(`/jc-ops/${id}/outsource-balance`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jcOpsBoardKeys.all });
    },
  });
}
