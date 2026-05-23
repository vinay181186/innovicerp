import type {
  CreateQcDocumentInput,
  ListQcDocumentsQuery,
  ListQcDocumentsResponse,
  QcDocument,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';
import { supabase } from '@/lib/supabase';

const BUCKET = 'qc-docs';

export const qcDocumentsKeys = {
  all: ['qc-documents'] as const,
  list: (q: ListQcDocumentsQuery) => [...qcDocumentsKeys.all, 'list', q] as const,
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

/** Uploads the file to the qc-docs Storage bucket; returns its storage path. */
export async function uploadQcFile(file: File, companyId: string): Promise<string> {
  const safe = file.name.replace(/[^\w.-]+/g, '_');
  const path = `${companyId}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return path;
}

/** Issues a short-lived signed URL for downloading/viewing a stored file. */
export async function signedUrlFor(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 120);
  if (error || !data) throw new Error(`Could not open file: ${error?.message ?? 'unknown'}`);
  return data.signedUrl;
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
