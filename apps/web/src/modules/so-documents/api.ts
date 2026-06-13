// SO Documents — TanStack Query hooks (ADR-047). Reads the unified file
// registry; uploads go direct to Storage then register metadata via POST.

import type {
  CreateSoDocumentInput,
  SoDocumentDetailResponse,
  SoDocumentFile,
  SoDocumentOverviewResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { signedUrl, uploadFile } from '@/lib/storage';

export const soDocumentsKeys = {
  all: ['so-documents'] as const,
  overview: () => [...soDocumentsKeys.all, 'overview'] as const,
  detail: (soId: string) => [...soDocumentsKeys.all, 'detail', soId] as const,
};

/** Uploads a file to the SO-docs folder; returns its storage path. */
export function uploadSoDocFile(file: File, companyId: string): Promise<string> {
  return uploadFile(file, companyId, { folder: 'so-docs' });
}

/** Short-lived signed URL for viewing/downloading a stored SO document. */
export function soDocSignedUrl(storagePath: string): Promise<string> {
  return signedUrl(storagePath);
}

export function useSoDocOverview() {
  return useQuery<SoDocumentOverviewResponse>({
    queryKey: soDocumentsKeys.overview(),
    queryFn: () => apiFetch<SoDocumentOverviewResponse>('/so-documents/overview'),
    placeholderData: (prev) => prev,
  });
}

export function useSoDocDetail(salesOrderId: string | undefined) {
  return useQuery<SoDocumentDetailResponse>({
    queryKey: soDocumentsKeys.detail(salesOrderId ?? ''),
    queryFn: () =>
      apiFetch<SoDocumentDetailResponse>(
        `/so-documents/detail?salesOrderId=${encodeURIComponent(salesOrderId ?? '')}`,
      ),
    enabled: !!salesOrderId,
    placeholderData: (prev) => prev,
  });
}

export function useCreateSoDocument() {
  const qc = useQueryClient();
  return useMutation<SoDocumentFile, Error, CreateSoDocumentInput>({
    mutationFn: (input) => apiFetch<SoDocumentFile>('/so-documents', { method: 'POST', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: soDocumentsKeys.all }),
  });
}

export function useDeleteSoDocument() {
  const qc = useQueryClient();
  return useMutation<{ id: string }, Error, string>({
    mutationFn: (id) => apiFetch<{ id: string }>(`/so-documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: soDocumentsKeys.all }),
  });
}
