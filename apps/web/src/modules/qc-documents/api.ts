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
import { drawingViewUrl, saveDrawing } from '@/lib/drawing-url';
import { uploadFile } from '@/lib/storage';

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

/** Link for LOOKING at a stored QC document.
 *
 *  Minted by the server since 2026-09-11, not by the browser. Two things follow:
 *  every open is written to the access log, and the link carries an INLINE
 *  disposition, so it shows rather than saves. Everyone with the page may use
 *  it — looking was never the restricted act. */
export function qcDocViewUrl(storagePath: string, refCode?: string | null): Promise<string> {
  return drawingViewUrl({
    path: storagePath,
    source: 'qc_document',
    ...(refCode ? { refCode } : {}),
  });
}

/** Link for SAVING a stored QC document, and the save itself.
 *
 *  The server refuses this to anyone without the per-person drawing-download
 *  tick, so the buttons that call it are hidden from those people too — see
 *  canDownloadDrawings. Fixes ISSUE-037 on the way past: the old bulk actions
 *  merely re-opened inline links, so a button marked Download did not download. */
export function saveQcDoc(
  storagePath: string,
  fileName?: string | null,
  refCode?: string | null,
): Promise<void> {
  return saveDrawing({
    path: storagePath,
    source: 'qc_document',
    ...(fileName ? { fileName } : {}),
    ...(refCode ? { refCode } : {}),
  });
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
