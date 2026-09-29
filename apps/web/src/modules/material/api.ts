// Material view (ADR-193 phase 3b) — what a Job Card / assembly SO needs, what
// was issued, returned and is still to issue. Derived on the server; read-only.
import type {
  JcMaterial,
  ReleaseAssemblyPartsInput,
  ReserveAssemblyPartsInput,
  SoMaterial,
} from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export function useJcMaterial(jobCardId: string | undefined) {
  return useQuery<JcMaterial>({
    queryKey: ['material', 'jc', jobCardId ?? ''],
    queryFn: () => apiFetch<JcMaterial>(`/material/job-cards/${jobCardId}`),
    enabled: Boolean(jobCardId),
  });
}

export function useSoMaterial(salesOrderId: string | undefined) {
  return useQuery<SoMaterial>({
    queryKey: ['material', 'so', salesOrderId ?? ''],
    queryFn: () => apiFetch<SoMaterial>(`/material/sales-orders/${salesOrderId}`),
    enabled: Boolean(salesOrderId),
  });
}

/** Stock reserved / released → material views, stock screens and the tracker re-read. */
function invalidateStock(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: ['material'] });
  void qc.invalidateQueries({ queryKey: ['store-inventory'] });
  void qc.invalidateQueries({ queryKey: ['items'] });
  void qc.invalidateQueries({ queryKey: ['assemblies'] });
}

// ADR-193 3c — hold free stock for an assembly SO's BOM parts.
export function useReserveParts(salesOrderId: string) {
  const qc = useQueryClient();
  return useMutation<SoMaterial, Error, ReserveAssemblyPartsInput>({
    mutationFn: (input) =>
      apiFetch<SoMaterial>(`/material/sales-orders/${salesOrderId}/reserve`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => invalidateStock(qc),
  });
}

// ADR-193 3c — give this SO's own reservation of one part back to free stock.
export function useReleaseParts(salesOrderId: string) {
  const qc = useQueryClient();
  return useMutation<SoMaterial, Error, ReleaseAssemblyPartsInput>({
    mutationFn: (input) =>
      apiFetch<SoMaterial>(`/material/sales-orders/${salesOrderId}/release`, {
        method: 'POST',
        json: input,
      }),
    onSuccess: () => invalidateStock(qc),
  });
}
