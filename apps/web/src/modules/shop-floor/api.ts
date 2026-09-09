import type { ShopFloorResponse } from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
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

// There is no stop hook here on purpose. /shop-floor/running/:id/stop was
// deleted: stopping a session is one action with one owner, and that is
// op-entry's useStopOp (POST /op-entry/running-ops/:id/stop), which also logs
// the quantity made. The By Machine view imports it directly. useStopOp
// invalidates shopFloorKeys.all, so this view still refreshes after a stop.
