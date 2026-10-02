// Cross-order line search for SO/JWSO Planning (PL-4b), on the shared FIT table
// (ADR-199, TABLE_KEYS.planningLineSearch). One row per SO LINE the term hits,
// in list order, across the orders on the list page shown (ADR-201: the server
// found the matching orders over every order and sent one 25-row page; the old
// "first 20 orders" cap is gone — the page is the cap). Loads each SO's detail through the same query the single-SO view
// uses, so clicking a row opens that SO from cache with no second fetch. Split
// out of routes/workflow.tsx so that file stays under the 400-line rule.
//
// ADR-203: the matching lines are the "Matching lines" TAB beside "Orders"
// (shown only while a term is typed). The lookup is the `useMatchingLines` hook
// so the page can put the line count on the tab even while Orders is open; the
// <SearchResults> panel only draws its answer, filling the screen.

import type { PlanningSoListItem } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { itemCodeWithRev } from '@/lib/item-code';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { DataTable, Panel } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { usePlanningSoDetails } from '../api';
import { lineRowTint, lineSearchColumns, type LineSearchRow } from './line-search-columns';

export interface MatchingLines {
  rows: LineSearchRow[];
  /** How many orders contributed a line. */
  orderCount: number;
  anyLoading: boolean;
  failedCount: number;
  failedMsg: string;
}

/** Every SO line the term hits across `sos` (pass `[]` when there is no term —
 *  nothing is fetched then). */
export function useMatchingLines(term: string, sos: PlanningSoListItem[]): MatchingLines {
  // One detail fetch per order on the page (at most 25).
  const details = usePlanningSoDetails(sos.map((so) => so.soId));
  const anyLoading = details.some((d) => d.isLoading);
  // A failed detail (expired session, 500, network) must not silently drop its
  // SO — the list still shows it, so a quiet "no lines match" would be a
  // confident wrong answer. Surface it the way the single-SO view does.
  const failed = details.filter((d) => d.isError);
  const firstError = failed[0]?.error;
  const failedMsg =
    firstError instanceof Error
      ? firstError.message
      : failed.length > 0
        ? 'Could not load SO. Try again.'
        : '';

  const groups = sos.flatMap((so, i) => {
    const data = details[i]?.data;
    if (!data) return [];
    const hits = data.lines.filter((line) =>
      matchesSearchTerm(
        [
          so.soCode,
          so.customerName,
          `L${line.lineNo}`,
          line.lineNo,
          itemCodeWithRev(line.itemCode, line.itemRevision, ''),
          line.itemCode,
          line.itemName,
        ],
        term,
      ),
    );
    // The list matched this SO on its `itemsText`, which is built from the SO
    // line's typed `itemCodeText` / `partName`; the detail's `itemCode` /
    // `itemName` prefer the item master's code/name, and the two can differ.
    // If none of the lines hit on the detail's fields, show them all rather
    // than let an SO that is in the list go silent here.
    const lines = hits.length > 0 ? hits : data.lines;
    return [{ so, lines }];
  });

  // Flatten to one row per (SO × line) for the FIT table.
  const rows = groups.flatMap((g) => g.lines.map((line) => ({ so: g.so, line })));
  return { rows, orderCount: groups.length, anyLoading, failedCount: failed.length, failedMsg };
}

export function SearchResults({
  term,
  sos,
  totalOrders,
  onPick,
  match,
}: {
  term: string;
  /** The orders on the list page shown. */
  sos: PlanningSoListItem[];
  /** Every order the search matched (server total). */
  totalOrders: number;
  onPick: (soId: string) => void;
  /** The page's `useMatchingLines(term, sos)` answer. */
  match: MatchingLines;
}): JSX.Element {
  const { rows, orderCount, anyLoading, failedCount, failedMsg } = match;
  const lineCount = rows.length;
  const columns = useMemo(() => lineSearchColumns(), []);

  return (
    <Panel
      fill
      bodyPadding="none"
      title={
        <>
          Matching lines: {lineCount} line{lineCount === 1 ? '' : 's'} in {orderCount} order
          {orderCount === 1 ? '' : 's'} for “{term}”
          {totalOrders > sos.length ? (
            <span
              className="text3"
              style={{ display: 'block', fontSize: 12, fontWeight: 400, marginTop: 2 }}
            >
              Lines of the {sos.length} orders on this page ({totalOrders} orders match) — use Next
              for the rest
            </span>
          ) : null}
        </>
      }
    >
      {anyLoading ? (
        <div style={{ padding: 24 }}>
          <Loader2 className="inline-block animate-spin" /> Loading…
        </div>
      ) : null}
      {failedCount > 0 ? (
        <div className="empty-state" style={{ color: 'var(--red2)', padding: 12 }}>
          Could not load {failedCount} of {sos.length} orders — {failedMsg}
        </div>
      ) : null}
      {!anyLoading && failedCount === 0 && lineCount === 0 ? (
        <div className="empty-state">No lines match “{term}”</div>
      ) : null}
      {lineCount > 0 ? (
        <DataTable
          tableKey={TABLE_KEYS.planningLineSearch}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.line.soLineId}
          onRowClick={(r) => onPick(r.so.soId)}
          rowClassName={(r) => lineRowTint(r.line)}
        />
      ) : null}
    </Panel>
  );
}
