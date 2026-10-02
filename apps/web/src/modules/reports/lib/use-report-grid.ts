// The report grid's own state (ADR-201): page, sort and column filters. They
// are sent to the server with the report filters — the server filters, sorts
// and totals EVERY row of the report and returns only the 25 on screen. Any
// sort / column-filter / report-filter change goes back to page 1.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LIST_PAGE_SIZE, pageOffset } from '@/lib/list-paging';
import type { ReportGridQuery } from '../api';
import { nextSort, type SortState } from './grid-model';

/** Typing in a column-filter box waits this long before asking the server. */
const FILTER_DEBOUNCE_MS = 300;

export interface ReportGridState {
  page: number;
  setPage: (p: number) => void;
  sort: SortState | null;
  toggleSort: (key: string) => void;
  showFilters: boolean;
  toggleFilters: () => void;
  /** What is typed in the boxes (shown at once). */
  terms: Record<string, string>;
  setTerm: (key: string, value: string) => void;
  /** Sort + column filters only (no page) — what the exports send. */
  viewQuery: ReportGridQuery;
  /** viewQuery plus this page — what the grid fetches. */
  pageQuery: ReportGridQuery;
}

/** `reportKey` = the report's slug (a new report starts with no sort and no
 *  column filters); `filtersKey` = its report filters (a change → page 1). */
export function useReportGrid(reportKey: string, filtersKey: string): ReportGridState {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [terms, setTerms] = useState<Record<string, string>>({});
  const [appliedTerms, setAppliedTerms] = useState<Record<string, string>>({});

  // Another report → start clean.
  useEffect(() => {
    setSort(null);
    setShowFilters(false);
    setTerms({});
    setAppliedTerms({});
  }, [reportKey]);
  // New report filters (or report) → page 1.
  useEffect(() => setPage(1), [reportKey, filtersKey]);

  useEffect(() => {
    const keys = Object.keys({ ...appliedTerms, ...terms });
    if (keys.every((k) => (appliedTerms[k] ?? '').trim() === (terms[k] ?? '').trim())) return;
    const id = window.setTimeout(() => {
      setAppliedTerms(terms);
      setPage(1);
    }, FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [terms, appliedTerms]);

  const toggleSort = useCallback((key: string) => {
    setSort((cur) => nextSort(cur, key));
    setPage(1);
  }, []);
  const toggleFilters = useCallback(() => {
    setShowFilters((v) => !v);
    setPage(1);
  }, []);
  const setTerm = useCallback((key: string, value: string) => {
    setTerms((cur) => ({ ...cur, [key]: value }));
  }, []);

  const viewQuery = useMemo<ReportGridQuery>(
    () => ({ sort, colFilters: showFilters ? appliedTerms : {} }),
    [sort, showFilters, appliedTerms],
  );
  const pageQuery = useMemo<ReportGridQuery>(
    () => ({ ...viewQuery, limit: LIST_PAGE_SIZE, offset: pageOffset(page) }),
    [viewQuery, page],
  );

  return {
    page,
    setPage,
    sort,
    toggleSort,
    showFilters,
    toggleFilters,
    terms,
    setTerm,
    viewQuery,
    pageQuery,
  };
}
