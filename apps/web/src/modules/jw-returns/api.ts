import type {
  CreateJwReturnChallanInput,
  JwReturnChallan,
  ListJwReturnChallansResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const jwReturnsKeys = {
  all: ['jw-returns'] as const,
  list: () => [...jwReturnsKeys.all, 'list'] as const,
};

export function useJwReturnsList() {
  return useQuery<ListJwReturnChallansResponse>({
    queryKey: jwReturnsKeys.list(),
    queryFn: () => apiFetch<ListJwReturnChallansResponse>('/jw-returns'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useCreateJwReturnChallan() {
  const qc = useQueryClient();
  return useMutation<JwReturnChallan, Error, CreateJwReturnChallanInput>({
    mutationFn: (input) =>
      apiFetch<JwReturnChallan>('/jw-returns', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: jwReturnsKeys.all });
      // Returning goods may flip the JWSO status to dispatched.
      void qc.invalidateQueries({ queryKey: ['job-work-orders'] });
    },
  });
}
