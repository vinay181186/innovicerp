// Item lookups for the Multi-Level BOM form — the same picker data path as
// bom-master/components/bom-form.tsx: one server-searched page of options,
// every row seeded into the item-detail cache, and every id the form refers
// to fetched by id once (no preloaded master page).

import type { Item } from '@innovic/shared';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { itemsKeys, useItemsList } from '@/modules/items/api';

function combineReferencedItems(results: { data?: Item | undefined }[]): Item[] {
  return results.flatMap((r) => (r.data ? [r.data] : []));
}

export interface ItemOption {
  id: string;
  code: string;
  name: string;
}

export function itemDisplayName(i: Item | null | undefined): string {
  if (!i) return '';
  return i.material ? `${i.name} [${i.material}]` : i.name;
}

export function useMlBomItems(referenced: string[]) {
  const [itemSearch, setItemSearch] = useState('');
  const { data: itemPage, isFetching: itemsFetching } = useItemsList({
    ...(itemSearch.trim() ? { search: itemSearch.trim() } : {}),
    limit: 50,
    offset: 0,
  });
  const itemOptions = useMemo<ItemOption[]>(
    () =>
      (itemPage?.items ?? []).map((i) => ({ id: i.id, code: i.code, name: itemDisplayName(i) })),
    [itemPage],
  );

  const queryClient = useQueryClient();
  useEffect(() => {
    for (const it of itemPage?.items ?? []) {
      if (!queryClient.getQueryData(itemsKeys.detail(it.id))) {
        queryClient.setQueryData(itemsKeys.detail(it.id), it);
      }
    }
  }, [itemPage, queryClient]);

  const referencedIds = useMemo(
    () => Array.from(new Set(referenced.filter(Boolean))).sort(),
    [referenced],
  );
  const referencedItems = useQueries({
    queries: referencedIds.map((id) => ({
      queryKey: itemsKeys.detail(id),
      queryFn: () => apiFetch<Item>(`/items/${id}`),
      staleTime: 5 * 60_000,
    })),
    combine: combineReferencedItems,
  });
  const itemById = useMemo(() => {
    const m = new Map<string, Item>();
    for (const i of referencedItems) m.set(i.id, i);
    for (const i of itemPage?.items ?? []) m.set(i.id, i);
    return m;
  }, [itemPage, referencedItems]);
  const itemsByCode = useMemo(() => {
    const m = new Map<string, Item>();
    for (const i of itemById.values()) m.set(i.code.toUpperCase(), i);
    return m;
  }, [itemById]);

  /** A typed exact code resolves to its item (paste-and-go, as bom-form). */
  const resolveCode = (typed: string): Item | null => {
    const key = typed.trim().toUpperCase();
    if (!key) return null;
    return itemsByCode.get(key) ?? null;
  };

  return { setItemSearch, itemsFetching, itemOptions, itemById, resolveCode };
}
