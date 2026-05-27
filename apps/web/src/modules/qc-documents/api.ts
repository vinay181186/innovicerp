import type {
  CreateQcDocumentInput,
  ListQcDocumentsQuery,
  ListQcDocumentsResponse,
  ListQcMatrixSosResponse,
  QcDocument,
  QcLineDetailResponse,
  QcMatrixResponse,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { signedUrl, uploadFile } from '@/lib/storage';

export const qcDocumentsKeys = {
  all: ['qc-documents'] as const,
  list: (q: ListQcDocumentsQuery) => [...qcDocumentsKeys.all, 'list', q] as const,
  soList: () => [...qcDocumentsKeys.all, 'so-list'] as const,
  matrix: (soId: string) => [...qcDocumentsKeys.all, 'matrix', soId] as const,
  lineDetail: (jcId: string) => [...qcDocumentsKeys.all, 'line-detail', jcId] as const,
};

function toQuery(q: ListQcDocumentsQuery): string {
  const p = new URLSearchParams();
  if (q.category) p.set('category', q.category);
  if (q.jobCardId) p.set('jobCardId', q.jobCardId);
  if (q.search) p.set('search', q.search);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function useQcDocuments(query: ListQcDocumentsQuery) {
  return useQuery<ListQcDocumentsResponse>({
    queryKey: qcDocumentsKeys.list(query),
    queryFn: () => apiFetch<ListQcDocumentsResponse>(`/qc-documents${toQuery(query)}`),
    placeholderData: (prev) => prev,
  });
}

/** Uploads a QC document file; returns its storage path. Thin wrapper over the
 *  shared Storage helper (kept for the QC Documents call sites). */
export function uploadQcFile(file: File, companyId: string): Promise<string> {
  return uploadFile(file, companyId);
}

/** Issues a short-lived signed URL for a stored QC document. */
export function signedUrlFor(storagePath: string): Promise<string> {
  return signedUrl(storagePath);
}

/** SO selector for the QC-completion matrix (legacy renderQCDocuments). */
export function useQcMatrixSos() {
  return useQuery<ListQcMatrixSosResponse>({
    queryKey: qcDocumentsKeys.soList(),
    queryFn: () => apiFetch<ListQcMatrixSosResponse>('/qc-documents/so-list'),
    placeholderData: (prev) => prev,
  });
}

/** SO-pivoted QC-completion matrix for one SO. */
export function useQcMatrix(salesOrderId: string | undefined) {
  return useQuery<QcMatrixResponse>({
    queryKey: qcDocumentsKeys.matrix(salesOrderId ?? ''),
    queryFn: () =>
      apiFetch<QcMatrixResponse>(
        `/qc-documents/matrix?salesOrderId=${encodeURIComponent(salesOrderId ?? '')}`,
      ),
    enabled: !!salesOrderId,
    placeholderData: (prev) => prev,
  });
}

/** Per-JC line-detail (batches + per-doc-type sections) for the modal. */
export function useQcLineDetail(jobCardId: string | undefined) {
  return useQuery<QcLineDetailResponse>({
    queryKey: qcDocumentsKeys.lineDetail(jobCardId ?? ''),
    queryFn: () =>
      apiFetch<QcLineDetailResponse>(
        `/qc-documents/line-detail?jobCardId=${encodeURIComponent(jobCardId ?? '')}`,
      ),
    enabled: !!jobCardId,
  });
}

export function useCreateQcDocument() {
  const qc = useQueryClient();
  return useMutation<QcDocument, Error, CreateQcDocumentInput>({
    mutationFn: (input) => apiFetch<QcDocument>('/qc-documents', { method: 'POST', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qcDocumentsKeys.all }),
  });
}

export function useDeleteQcDocument() {
  const qc = useQueryClient();
  return useMutation<{ id: string }, Error, string>({
    mutationFn: (id) => apiFetch<{ id: string }>(`/qc-documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qcDocumentsKeys.all }),
  });
}
