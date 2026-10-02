import type {
  CreateReportTypeInput,
  ListReportTypesQuery,
  ListReportTypesResponse,
  ReportType,
  UpdateReportTypeInput,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const reportTypesKeys = {
  all: ['report-types'] as const,
};

/** One page of report types (ADR-201) + the total under the same filters. */
export function useReportTypes(query: ListReportTypesQuery) {
  return useQuery<ListReportTypesResponse>({
    queryKey: [...reportTypesKeys.all, 'list', query],
    queryFn: () => {
      const p = new URLSearchParams();
      if (query.sf) p.set('sf', query.sf);
      p.set('limit', String(query.limit));
      p.set('offset', String(query.offset));
      return apiFetch<ListReportTypesResponse>(`/report-types?${p.toString()}`);
    },
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
