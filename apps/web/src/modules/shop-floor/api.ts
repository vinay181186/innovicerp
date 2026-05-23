import type { ShopFloorResponse } from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export const shopFloorKeys = {
  all: ['shop-floor'] as const,
  view: () => [...shopFloorKeys.all, 'view'] as const,
};

export function useShopFloor() {
  return useQuery<ShopFloorResponse>({
    queryKey: shopFloorKeys.view(),
    queryFn: () => apiFetch<ShopFloorResponse>('/shop-floor'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });
}

export function useStopRunningOp() {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, Error, string>({
    mutationFn: (id) =>
      apiFetch<{ ok: true }>(`/shop-floor/running/${id}/stop`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: shopFloorKeys.all });
    },
  });
}
