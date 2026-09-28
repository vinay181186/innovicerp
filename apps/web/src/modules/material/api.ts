// Material view (ADR-193 phase 3b) — what a Job Card / assembly SO needs, what
// was issued, returned and is still to issue. Derived on the server; read-only.
import type { JcMaterial, SoMaterial } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
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
