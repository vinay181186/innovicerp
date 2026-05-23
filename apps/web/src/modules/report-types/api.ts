import type {
  CreateReportTypeInput,
  ListReportTypesResponse,
  ReportType,
  UpdateReportTypeInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const reportTypesKeys = {
  all: ['report-types'] as const,
};

export function useReportTypes() {
  return useQuery<ListReportTypesResponse>({
    queryKey: reportTypesKeys.all,
    queryFn: () => apiFetch<ListReportTypesResponse>('/report-types'),
    placeholderData: (prev) => prev,
  });
}

export function useCreateReportType() {
  const qc = useQueryClient();
  return useMutation<ReportType, Error, CreateReportTypeInput>({
    mutationFn: (input) => apiFetch<ReportType>('/report-types', { method: 'POST', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: reportTypesKeys.all }),
  });
}

export function useUpdateReportType() {
  const qc = useQueryClient();
  return useMutation<ReportType, Error, { id: string; input: UpdateReportTypeInput }>({
    mutationFn: ({ id, input }) =>
      apiFetch<ReportType>(`/report-types/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: reportTypesKeys.all }),
  });
}

export function useDeleteReportType() {
  const qc = useQueryClient();
  return useMutation<{ id: string }, Error, string>({
    mutationFn: (id) => apiFetch<{ id: string }>(`/report-types/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: reportTypesKeys.all }),
  });
}
