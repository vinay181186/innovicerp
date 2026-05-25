import type {
  EffectivePrintTemplate,
  ListPrintTemplateRevisionsResponse,
  ListPrintTemplatesResponse,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const printTemplatesKeys = {
  all: ['print-templates'] as const,
  list: () => [...printTemplatesKeys.all, 'list'] as const,
  revisions: (key: string) => [...printTemplatesKeys.all, 'revisions', key] as const,
};

export function usePrintTemplates(
  options?: Omit<UseQueryOptions<ListPrintTemplatesResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListPrintTemplatesResponse>({
    queryKey: printTemplatesKeys.list(),
    queryFn: () => apiFetch<ListPrintTemplatesResponse>('/print-templates'),
    ...options,
  });
}

export function usePrintTemplateRevisions(key: string | null) {
  return useQuery<ListPrintTemplateRevisionsResponse>({
    queryKey: printTemplatesKeys.revisions(key ?? '__none__'),
    queryFn: () =>
      apiFetch<ListPrintTemplateRevisionsResponse>(
        `/print-templates/${encodeURIComponent(key as string)}/revisions`,
      ),
    enabled: Boolean(key),
  });
}

export function useSavePrintTemplate() {
  const qc = useQueryClient();
  return useMutation<EffectivePrintTemplate, Error, { key: string; content: string }>({
    mutationFn: ({ key, content }) =>
      apiFetch<EffectivePrintTemplate>(`/print-templates/${encodeURIComponent(key)}`, {
        method: 'PUT',
        json: { content },
      }),
    onSuccess: (_res, { key }) => {
      void qc.invalidateQueries({ queryKey: printTemplatesKeys.list() });
      void qc.invalidateQueries({ queryKey: printTemplatesKeys.revisions(key) });
    },
  });
}

export function useRestorePrintTemplateDefault() {
  const qc = useQueryClient();
  return useMutation<EffectivePrintTemplate, Error, string>({
    mutationFn: (key) =>
      apiFetch<EffectivePrintTemplate>(
        `/print-templates/${encodeURIComponent(key)}/restore-default`,
        { method: 'POST' },
      ),
    onSuccess: (_res, key) => {
      void qc.invalidateQueries({ queryKey: printTemplatesKeys.list() });
      void qc.invalidateQueries({ queryKey: printTemplatesKeys.revisions(key) });
    },
  });
}
