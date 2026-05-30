import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export type TrashEntityType =
  | 'Sales Order'
  | 'Job Work Order'
  | 'Job Card'
  | 'Item'
  | 'Client'
  | 'Vendor'
  | 'Machine'
  | 'Operator'
  | 'Purchase Request'
  | 'Purchase Order'
  | 'Goods Receipt Note'
  | 'Delivery Challan'
  | 'NC Register'
  | 'BOM Master'
  | 'Route Card'
  | 'Cost Center'
  | 'QC Process';

export interface TrashListItem {
  id: string;
  type: TrashEntityType;
  label: string;
  deletedAt: string;
  deletedById: string | null;
  deletedByName: string | null;
}

export interface ListTrashResponse {
  items: TrashListItem[];
  total: number;
  byType: Record<string, number>;
  limit: number;
  offset: number;
}

export interface ListTrashQuery {
  type?: TrashEntityType | undefined;
  limit: number;
  offset: number;
}

export const trashKeys = {
  all: ['trash'] as const,
  list: (q: ListTrashQuery) => [...trashKeys.all, 'list', q] as const,
};

function toQueryString(q: ListTrashQuery): string {
  const params = new URLSearchParams();
  if (q.type) params.set('type', q.type);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

export function useTrash(query: ListTrashQuery) {
  return useQuery<ListTrashResponse>({
    queryKey: trashKeys.list(query),
    queryFn: () => apiFetch<ListTrashResponse>(`/trash?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
  });
}

export function useRestoreFromTrash() {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, Error, { type: TrashEntityType; id: string }>({
    mutationFn: (input) =>
      apiFetch<{ ok: true }>('/trash/restore', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: trashKeys.all });
    },
  });
}

export function usePermDeleteTrash() {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, Error, { type: TrashEntityType; id: string }>({
    mutationFn: (input) =>
      apiFetch<{ ok: true }>('/trash/perm-delete', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: trashKeys.all });
    },
  });
}

export function useEmptyTrash() {
  const qc = useQueryClient();
  return useMutation<{ deleted: number }, Error, void>({
    mutationFn: () => apiFetch<{ deleted: number }>('/trash/empty', { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: trashKeys.all });
    },
  });
}
