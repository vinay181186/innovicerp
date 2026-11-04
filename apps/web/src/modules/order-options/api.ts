// One order picker's data (owner 2026-11-04): the SO / JWSO options behind the
// dropdown beside the list search and the QC Documents pickers. GET
// /order-options. Read-only, so there is nothing to invalidate here.

import type { OrderOptionsQuery, OrderOptionsResponse, QcDossierOrderKind } from '@innovic/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

export interface OrderOptionsArgs {
  search: string;
  /** Leave out for both SOs and JWSOs. */
  kind?: QcDossierOrderKind | undefined;
  cancelled?: OrderOptionsQuery['cancelled'] | undefined;
}

export const orderOptionKeys = {
  all: ['order-options'] as const,
  list: (a: OrderOptionsArgs) =>
    [...orderOptionKeys.all, 'list', a.search, a.kind ?? 'both', a.cancelled ?? 'include'] as const,
};

export function useOrderOptions(args: OrderOptionsArgs) {
  return useQuery<OrderOptionsResponse>({
    queryKey: orderOptionKeys.list(args),
    queryFn: () => {
      const p = new URLSearchParams();
      if (args.search) p.set('search', args.search);
      if (args.kind) p.set('kind', args.kind);
      if (args.cancelled) p.set('cancelled', args.cancelled);
      const s = p.toString();
      return apiFetch<OrderOptionsResponse>(`/order-options${s ? `?${s}` : ''}`);
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}
