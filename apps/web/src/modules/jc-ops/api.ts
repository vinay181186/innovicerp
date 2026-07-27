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
      q.limit,
      q.offset,
    ] as const,
};

function buildQs(q: ListJcOpsBoardQuery): string {
  const p = new URLSearchParams();
  if (q.jcCode) p.set('jcCode', q.jcCode);
  if (q.search) p.set('search', q.search);
  p.set('limit', String(q.limit));
  p.set('offset', String(q.offset));
  return p.toString();
}

export function useJcOpsBoard(query: ListJcOpsBoardQuery) {
  return useQuery<ListJcOpsBoardResponse>({
    queryKey: jcOpsBoardKeys.list(query),
    queryFn: () => apiFetch<ListJcOpsBoardResponse>(`/jc-ops?${buildQs(query)}`),
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
