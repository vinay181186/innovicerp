// Raw Material Master — TanStack Query hooks for the TWO masters behind the one
// menu entry: material GRADE and material SIZE. They are deliberately
// independent (picking a grade never narrows the size list), so they get two
// separate key spaces and two separate endpoints. Mirror of modules/operators/api.ts.

import type {
  BulkCreateMaterialGradesInput,
  BulkCreateMaterialGradesResponse,
  BulkCreateMaterialSizesInput,
  BulkCreateMaterialSizesResponse,
  CreateMaterialGradeInput,
  CreateMaterialSizeInput,
  ListMaterialGradesQuery,
  ListMaterialGradesResponse,
  ListMaterialSizesQuery,
  ListMaterialSizesResponse,
  MaterialGrade,
  MaterialSize,
  UpdateMaterialGradeInput,
  UpdateMaterialSizeInput,
} from '@innovic/shared';
import { type UseQueryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const materialGradesKeys = {
  all: ['material-grades'] as const,
  lists: () => [...materialGradesKeys.all, 'list'] as const,
  list: (q: ListMaterialGradesQuery) => [...materialGradesKeys.lists(), q] as const,
};

export const materialSizesKeys = {
  all: ['material-sizes'] as const,
  lists: () => [...materialSizesKeys.all, 'list'] as const,
  list: (q: ListMaterialSizesQuery) => [...materialSizesKeys.lists(), q] as const,
};

// Both list queries share the same shape (search / isActive / limit / offset).
function toQueryString(q: ListMaterialGradesQuery | ListMaterialSizesQuery): string {
  const params = new URLSearchParams();
  if (q.search) params.set('search', q.search);
  if (typeof q.isActive === 'boolean') params.set('isActive', String(q.isActive));
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  return params.toString();
}

/* ─────────────────────────── GRADES ─────────────────────────── */

export function useMaterialGradesList(
  query: ListMaterialGradesQuery,
  options?: Omit<UseQueryOptions<ListMaterialGradesResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListMaterialGradesResponse>({
    queryKey: materialGradesKeys.list(query),
    queryFn: () => apiFetch<ListMaterialGradesResponse>(`/material-grades?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useCreateMaterialGrade() {
  const qc = useQueryClient();
  return useMutation<MaterialGrade, Error, CreateMaterialGradeInput>({
    mutationFn: (input) => apiFetch<MaterialGrade>('/material-grades', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: materialGradesKeys.lists() });
    },
  });
}

/** Whole-sheet Excel import: ONE request, ONE list reload at the end. Never a
 *  per-row loop — that ran at about one row per second on the live system,
 *  because every success also re-downloaded the whole master. */
export function useBulkCreateMaterialGrades() {
  const qc = useQueryClient();
  return useMutation<BulkCreateMaterialGradesResponse, Error, BulkCreateMaterialGradesInput>({
    mutationFn: (input) =>
      apiFetch<BulkCreateMaterialGradesResponse>('/material-grades/bulk', {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: materialGradesKeys.lists() });
    },
  });
}

export function useUpdateMaterialGrade() {
  const qc = useQueryClient();
  return useMutation<MaterialGrade, Error, { id: string; input: UpdateMaterialGradeInput }>({
    mutationFn: ({ id, input }) =>
      apiFetch<MaterialGrade>(`/material-grades/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: materialGradesKeys.lists() });
    },
  });
}

export function useSoftDeleteMaterialGrade() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/material-grades/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: materialGradesKeys.lists() });
    },
  });
}

/* ─────────────────────────── SIZES ─────────────────────────── */

export function useMaterialSizesList(
  query: ListMaterialSizesQuery,
  options?: Omit<UseQueryOptions<ListMaterialSizesResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<ListMaterialSizesResponse>({
    queryKey: materialSizesKeys.list(query),
    queryFn: () => apiFetch<ListMaterialSizesResponse>(`/material-sizes?${toQueryString(query)}`),
    placeholderData: (prev) => prev,
    ...options,
  });
}

export function useCreateMaterialSize() {
  const qc = useQueryClient();
  return useMutation<MaterialSize, Error, CreateMaterialSizeInput>({
    mutationFn: (input) => apiFetch<MaterialSize>('/material-sizes', { method: 'POST', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: materialSizesKeys.lists() });
    },
  });
}

/** Whole-sheet Excel import — see the note on useBulkCreateMaterialGrades. */
export function useBulkCreateMaterialSizes() {
  const qc = useQueryClient();
  return useMutation<BulkCreateMaterialSizesResponse, Error, BulkCreateMaterialSizesInput>({
    mutationFn: (input) =>
      apiFetch<BulkCreateMaterialSizesResponse>('/material-sizes/bulk', {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: materialSizesKeys.lists() });
    },
  });
}

export function useUpdateMaterialSize() {
  const qc = useQueryClient();
  return useMutation<MaterialSize, Error, { id: string; input: UpdateMaterialSizeInput }>({
    mutationFn: ({ id, input }) =>
      apiFetch<MaterialSize>(`/material-sizes/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: materialSizesKeys.lists() });
    },
  });
}

export function useSoftDeleteMaterialSize() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/material-sizes/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: materialSizesKeys.lists() });
    },
  });
}
