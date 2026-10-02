// Cross-order line search for SO/JWSO Planning (PL-4b), on the shared FIT table
// (ADR-199, TABLE_KEYS.planningLineSearch). One row per SO LINE the term hits,
// in list order. Loads each SO's detail through the same query the single-SO view
// uses, so clicking a row opens that SO from cache with no second fetch. Split
// out of routes/workflow.tsx so that file stays under the 400-line rule.

import type { PlanningSoListItem } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { itemCodeWithRev } from '@/lib/item-code';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { DataTable, Panel } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { usePlanningSoDetails } from '../api';
import { lineRowTint, lineSearchColumns, type LineSearchRow } from './line-search-columns';
import { MAX_SEARCH_SOS } from './planning-shared';

export function SearchResults({
  term,
  sos,
  onPick,
}: {
  term: string;
  sos: PlanningSoListItem[];
  onPick: (soId: string) => void;
}): JSX.Element {
  const capped = sos.slice(0, MAX_SEARCH_SOS);
  const details = usePlanningSoDetails(capped.map((so) => so.soId));
  const anyLoading = details.some((d) => d.isLoading);
  // A failed detail (expired session, 500, network) must not silently drop its
  // SO — the list above still shows it, so a quiet "no lines match" would be a
  // confident wrong answer. Surface it the way the single-SO view does.
  const failed = details.filter((d) => d.isError);
  const firstError = failed[0]?.error;
  const failedMsg =
    firstError instanceof Error
      ? firstError.message
      : failed.length > 0
        ? 'Could not load SO. Try again.'
        : '';

  const groups = capped.flatMap((so, i) => {
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
  const rows = useMemo<LineSearchRow[]>(
    () => groups.flatMap((g) => g.lines.map((line) => ({ so: g.so, line }))),
    [groups],
  );
  const lineCount = rows.length;
  const columns = useMemo(() => lineSearchColumns(), []);

  return (
    <Panel
      style={{ marginTop: 14 }}
      bodyPadding="none"
      title={
        <>
          Matching lines: {lineCount} line{lineCount === 1 ? '' : 's'} in {groups.length} order
          {groups.length === 1 ? '' : 's'} for “{term}”
          {sos.length > MAX_SEARCH_SOS ? (
            <span
              className="text3"
              style={{ display: 'block', fontSize: 12, fontWeight: 400, marginTop: 2 }}
            >
              Showing first {MAX_SEARCH_SOS} of {sos.length} matching orders — refine your search
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
      {failed.length > 0 ? (
        <div className="empty-state" style={{ color: 'var(--red2)', padding: 12 }}>
          Could not load {failed.length} of {capped.length} orders — {failedMsg}
        </div>
      ) : null}
      {!anyLoading && failed.length === 0 && lineCount === 0 ? (
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
