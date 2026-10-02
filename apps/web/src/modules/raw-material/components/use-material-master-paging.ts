// Raw Material Master — the paging state BOTH tabs share (ADR-201): 25 rows a
// page, the All / Active / Inactive filter and the column ▾ Sort & Filter all
// run on the server. This hook only builds the query objects; each tab feeds
// them to its own list hook (grades or sizes):
//   - `pageQuery`  the 25 rows on screen
//   - `countQueries` three limit:1 calls whose `total`s are the dropdown counts,
//     under the same search + ▾ filters as the page (never counted from the
//     25 loaded rows).
// Any change of search / status / ▾ sends the list back to page 1.

import type { ListMaterialGradesQuery } from '@innovic/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LIST_PAGE_SIZE, pageOffset } from '@/lib/list-paging';
import { type ServerSortFilter, useServerSortFilter } from '@/ui/data/sort-filter/server-state';

export type MaterialStatusFilter = 'all' | 'active' | 'inactive';

/** Grades and sizes take the same list query shape. */
type MaterialListQuery = ListMaterialGradesQuery;

export interface MaterialMasterPaging {
  status: MaterialStatusFilter;
  setStatus: (s: MaterialStatusFilter) => void;
  sf: ServerSortFilter;
  pageQuery: MaterialListQuery;
  countQueries: { all: MaterialListQuery; active: MaterialListQuery; inactive: MaterialListQuery };
}

export function useMaterialMasterPaging(
  tableKey: string,
  term: string | undefined,
  page: number,
  onPage: (p: number) => void,
): MaterialMasterPaging {
  const [status, setStatusState] = useState<MaterialStatusFilter>('all');
  const toFirst = useCallback(() => onPage(1), [onPage]);
  const sf = useServerSortFilter(tableKey, toFirst);
  const setStatus = useCallback(
    (s: MaterialStatusFilter) => {
      setStatusState(s);
      toFirst();
    },
    [toFirst],
  );

  // A new search term → page 1 (the route owns the debounce).
  const lastTerm = useRef(term);
  useEffect(() => {
    if (lastTerm.current === term) return;
    lastTerm.current = term;
    toFirst();
  }, [term, toFirst]);

  return useMemo(() => {
    const base = {
      ...(term ? { search: term } : {}),
      ...(sf.param ? { sf: sf.param } : {}),
    };
    const count = (isActive?: boolean): MaterialListQuery => ({
      ...base,
      ...(isActive === undefined ? {} : { isActive }),
      limit: 1,
      offset: 0,
    });
    return {
      status,
      setStatus,
      sf,
      pageQuery: {
        ...base,
        ...(status === 'all' ? {} : { isActive: status === 'active' }),
        limit: LIST_PAGE_SIZE,
        offset: pageOffset(page),
      },
      countQueries: { all: count(), active: count(true), inactive: count(false) },
    };
  }, [term, sf, status, setStatus, page]);
}
