// ADR-310 — the Plans list's shared Export (copies the JWSO Master pilot).
//
// One sheet "Plans": the list's own columns as the user sees them. Plan Type
// draws an icon beside its word, so it gets a plain `exportValue`. There is no
// Lines sheet: the API has no per-line plan list endpoint.

import type { ListPlansQuery, ListPlansResponse } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchPlansPage } from '../api';
import { STATUS_BADGE, TYPE_LABEL } from '../components/plans-list-columns';
import { DERIVED_LABEL } from './derived-status';

/** The status word the Plans filter shows (stored or route-card state). */
function planStatusWord(s: NonNullable<ListPlansQuery['status']>): string {
  return (
    (STATUS_BADGE as Record<string, { label: string } | undefined>)[s]?.label ??
    (DERIVED_LABEL as Record<string, string | undefined>)[s] ??
    s
  );
}

type PlanRow = ListPlansResponse['items'][number];

export function withPlanExportValues(
  columns: DataTableColumn<PlanRow>[],
): DataTableColumn<PlanRow>[] {
  const values: Record<string, (p: PlanRow) => string | number | null> = {
    // The cell is "<icon> <word>".
    plan_type: (p) => TYPE_LABEL[p.planType],
    // Only route-card plans carry a Pending; the others show "—".
    pending_qty: (p) => (p.derivedStatus ? p.pendingQty : null),
  };
  return columns.map((c) => {
    const fn = c.id ? values[c.id] : undefined;
    return fn ? { ...c, exportValue: fn } : c;
  });
}

export interface PlansExportArgs {
  columns: DataTableColumn<PlanRow>[];
  tableKey: string;
  search: string | undefined;
  status: ListPlansQuery['status'];
  planType: ListPlansQuery['planType'];
  pending: boolean;
  sfParam: string | undefined;
}

export function plansExportSpec(a: PlansExportArgs): ListExportSpec<PlanRow> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.status ? `Plan Status ${planStatusWord(a.status)}` : null,
    a.planType ? `Plan Type ${TYPE_LABEL[a.planType]}` : null,
    a.pending ? 'Pending only' : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Plans',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (p) => p.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: (limit, offset) =>
      fetchPlansPage({
        search: a.search,
        status: a.status,
        planType: a.planType,
        ...(a.pending ? { poPending: true } : {}),
        sf: a.sfParam,
        limit,
        offset,
      }),
  };
}
