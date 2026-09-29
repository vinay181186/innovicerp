// Server-searched Item Code boxes — for the forms whose Item Code is a FREE-TEXT
// input (Plan, PO / PR lines, GRN lines) rather than a pick-only
// <SearchableSelect>. Those forms accept an off-master code on purpose, so they
// cannot become pick-only; but they used to feed their <datalist> and their
// "code → name / UOM" auto-fill from ONE fixed page of the Item Master
// (limit 500–1000). Every item past that page was unpickable, and typing its
// code exactly still failed to auto-fill because the page never held it.
//
// Now both halves ask the server with the typed text (`?search=`, a
// case-insensitive substring match on code / name / drawing / material…):
//
//   • useItemCodeSearch(code)   — the suggestions for the datalist, plus the
//                                 master row whose code EXACTLY matches what is
//                                 typed (drives read-only name, UOM hints…).
//   • useItemCodeResolver()     — an async `code → master row | null` lookup for
//                                 `useFieldCascade`'s `resolve`, sharing the same
//                                 query cache key, so a line does not fetch twice.
//
// The exact match is still EXACT and case-insensitive — never fuzzy — which is
// the rule the old in-memory `itemsByCode` map enforced.

import type { ListItemsQuery, ListItemsResponse } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useDebounce } from '@/lib/use-debounce';
import { fetchItemsList, itemsKeys, useItemsList } from './api';

/** Rows per search. The server orders by code, so a full code's own row sorts
 *  ahead of the longer codes that merely contain it. */
const PAGE = 50;
const DEBOUNCE_MS = 250;
/** The list endpoint refuses a `search` longer than this. */
const MAX_SEARCH = 100;

export type ItemMasterRow = ListItemsResponse['items'][number];

export interface ItemCodeSearchOptions {
  /** ADR-195: hide party-supplied material (buying / making pickers pass this). */
  excludePartyOwned?: boolean | undefined;
  /** False → no fetch at all (e.g. a read-only field). Default true. */
  enabled?: boolean | undefined;
}

function searchQuery(term: string, excludePartyOwned: boolean | undefined): ListItemsQuery {
  const search = term.trim().slice(0, MAX_SEARCH);
  return {
    ...(search ? { search } : {}),
    ...(excludePartyOwned ? { excludePartyOwned: true } : {}),
    limit: PAGE,
    offset: 0,
  };
}

/** The row whose code equals `code` (trimmed, case-insensitive), if any. */
export function findItemByExactCode(
  rows: readonly ItemMasterRow[],
  code: string,
): ItemMasterRow | undefined {
  const key = code.trim().toUpperCase();
  if (!key) return undefined;
  return rows.find((it) => it.code.trim().toUpperCase() === key);
}

export interface ItemCodeSearchResult {
  /** Suggestions for the typed text (server-searched, one page). */
  items: ItemMasterRow[];
  /** The master row whose code exactly equals the typed code, if the server has one. */
  match: ItemMasterRow | undefined;
  isFetching: boolean;
}

/** Suggestions + exact match for one free-text Item Code box. */
export function useItemCodeSearch(
  code: string,
  { excludePartyOwned, enabled = true }: ItemCodeSearchOptions = {},
): ItemCodeSearchResult {
  const term = useDebounce(code.trim(), DEBOUNCE_MS);
  const { data, isFetching } = useItemsList(searchQuery(term, excludePartyOwned), { enabled });
  const items = data?.items ?? [];
  return { items, match: findItemByExactCode(items, code), isFetching };
}

/** Async exact-code lookup for `useFieldCascade`'s `resolve`. Waits out the
 *  typing (the cascade aborts the previous call on every keystroke), then reads
 *  through the same query cache `useItemCodeSearch` fills. */
export function useItemCodeResolver({
  excludePartyOwned,
}: Pick<ItemCodeSearchOptions, 'excludePartyOwned'> = {}): (
  code: string,
  signal: AbortSignal,
) => Promise<ItemMasterRow | null> {
  const qc = useQueryClient();
  return useCallback(
    async (code: string, signal: AbortSignal): Promise<ItemMasterRow | null> => {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, DEBOUNCE_MS);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
      const query = searchQuery(code, excludePartyOwned);
      const res = await qc.fetchQuery({
        queryKey: itemsKeys.list(query),
        queryFn: () => fetchItemsList(query),
      });
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return findItemByExactCode(res.items, code) ?? null;
    },
    [qc, excludePartyOwned],
  );
}
