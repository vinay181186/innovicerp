import type {
  QcAssignInput,
  QcAssignmentResult,
  QcCommandQueryInput,
  QcCommandResponse,
  QcPickUpInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const qcCommandKeys = {
  all: ['qc-command'] as const,
};

/** The board, each table cut to its page on the server (ADR-201). */
export function useQcCommand(params: QcCommandQueryInput) {
  return useQuery<QcCommandResponse>({
    queryKey: [...qcCommandKeys.all, params],
    queryFn: () => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
      return apiFetch<QcCommandResponse>(`/qc-command?${qs.toString()}`);
    },
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
  });
}

export function usePickUpQc() {
  const qc = useQueryClient();
  return useMutation<QcAssignmentResult, Error, QcPickUpInput>({
    mutationFn: (input) =>
      apiFetch<QcAssignmentResult>('/qc-command/pickup', { method: 'POST', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qcCommandKeys.all }),
  });
}

export function useAssignQc() {
  const qc = useQueryClient();
  return useMutation<QcAssignmentResult, Error, QcAssignInput>({
    mutationFn: (input) =>
      apiFetch<QcAssignmentResult>('/qc-command/assign', { method: 'POST', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qcCommandKeys.all }),
  });
}
