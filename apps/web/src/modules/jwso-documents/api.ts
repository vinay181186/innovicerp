// JWSO Documents — TanStack Query hooks (#8). Uploads go direct to Storage
// (folder `jw-docs` in the shared `qc-docs` bucket), then register metadata via
// POST /jwso-documents against the unified file_registry.

import type {
  CreateJwDocumentInput,
  JwDocumentFile,
  JwDocumentListResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { signedUrl, uploadFile } from '@/lib/storage';

export const jwsoDocumentsKeys = {
  all: ['jwso-documents'] as const,
  list: (jwId: string) => [...jwsoDocumentsKeys.all, 'list', jwId] as const,
};

/** Uploads a file to the JWSO-docs folder; returns its storage path. */
export function uploadJwDocFile(file: File, companyId: string): Promise<string> {
  return uploadFile(file, companyId, { folder: 'jw-docs' });
}

/** Short-lived signed URL for viewing/downloading a stored JWSO document. */
export function jwDocSignedUrl(storagePath: string): Promise<string> {
  return signedUrl(storagePath);
}

export function useJwDocuments(jobWorkOrderId: string | undefined) {
  return useQuery<JwDocumentListResponse>({
    queryKey: jwsoDocumentsKeys.list(jobWorkOrderId ?? ''),
    queryFn: () =>
      apiFetch<JwDocumentListResponse>(
        `/jwso-documents?jobWorkOrderId=${encodeURIComponent(jobWorkOrderId ?? '')}`,
      ),
    enabled: !!jobWorkOrderId,
    placeholderData: (prev) => prev,
  });
}

export function useCreateJwDocument() {
  const qc = useQueryClient();
  return useMutation<JwDocumentFile, Error, CreateJwDocumentInput>({
    mutationFn: (input) =>
      apiFetch<JwDocumentFile>('/jwso-documents', { method: 'POST', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: jwsoDocumentsKeys.all }),
  });
}

export function useDeleteJwDocument() {
  const qc = useQueryClient();
  return useMutation<{ id: string }, Error, string>({
    mutationFn: (id) => apiFetch<{ id: string }>(`/jwso-documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: jwsoDocumentsKeys.all }),
  });
}
