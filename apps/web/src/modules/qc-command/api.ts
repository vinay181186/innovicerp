import type {
  QcAssignInput,
  QcAssignmentResult,
  QcCommandResponse,
  QcPickUpInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const qcCommandKeys = {
  all: ['qc-command'] as const,
};

export function useQcCommand() {
  return useQuery<QcCommandResponse>({
    queryKey: qcCommandKeys.all,
    queryFn: () => apiFetch<QcCommandResponse>('/qc-command'),
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
