// ADR-310 — the shared Export for the Drawing Register and the Drawing Rev
// Fix List (copies the JWSO pilot). One sheet each.
//
// Drawing Register: server-paged, so every Drawing Rev matching the search /
// status / column filters. Item Code (a link), Drawing File (✓), the Drawing
// Rev Status badge and "● Waiting" are components → plain values.
// Fix List: one unpaged read; the sheet is the open tab's rows after the
// search box. RC No. (a link), the RC Status badge and the SO No. link → plain.

import {
  type DrawingRegisterRow,
  type FixListLine,
  type FixListRouteCard,
  type FixListStock,
  type ListDrawingRegisterQuery,
  REV_RELEASE_STATUS_LABELS,
  ROUTE_CARD_APPROVAL_LABEL,
  type RevReleaseStatus,
} from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchDrawingRegisterPage } from '../api';

type Ev<T> = Record<string, (r: T) => string | number | null>;

function withValues<T>(columns: DataTableColumn<T>[], ev: Ev<T>): DataTableColumn<T>[] {
  return columns.map((c) => {
    const f = c.id ? ev[c.id] : undefined;
    return f ? { ...c, exportValue: f } : c;
  });
}

const REGISTER_EV: Ev<DrawingRegisterRow> = {
  item_code: (r) => r.label,
  drawing_file: (r) => (r.hasFile ? 'Yes' : 'No'),
  release_status: (r) => REV_RELEASE_STATUS_LABELS[r.releaseStatus],
  pending_correction: (r) => (r.pendingCorrection ? 'Waiting' : null),
};

export const withRegisterExportValues = (
  columns: DataTableColumn<DrawingRegisterRow>[],
): DataTableColumn<DrawingRegisterRow>[] => withValues(columns, REGISTER_EV);

export function drawingRegisterExportSpec(a: {
  columns: DataTableColumn<DrawingRegisterRow>[];
  tableKey: string;
  search: string | undefined;
  status: RevReleaseStatus | undefined;
  sfParam: string | undefined;
}): ListExportSpec<DrawingRegisterRow> {
  const words = [
    a.search ? `search "${a.search}"` : null,
    a.status ? `Drawing Rev Status: ${REV_RELEASE_STATUS_LABELS[a.status]}` : null,
    a.sfParam ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  const base: Partial<ListDrawingRegisterQuery> = {
    ...(a.search ? { search: a.search } : {}),
    ...(a.status ? { status: a.status } : {}),
    ...(a.sfParam ? { sf: a.sfParam } : {}),
  };
  return {
    fileName: 'Drawing Register',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    filterSummary: words.join(' · ') || undefined,
    fetchPage: async (limit, offset) => {
      const res = await fetchDrawingRegisterPage({ ...base, limit, offset });
      return { items: res.items, total: res.total };
    },
  };
}

const RC_LABEL: Record<string, string> = ROUTE_CARD_APPROVAL_LABEL;

export const withFixRouteCardExportValues = (
  columns: DataTableColumn<FixListRouteCard>[],
): DataTableColumn<FixListRouteCard>[] =>
  withValues(columns, {
    rc_no: (r) => r.routeCardCode,
    rc_status: (r) => RC_LABEL[r.approvalStatus] ?? r.approvalStatus,
  });

export const withFixLineExportValues = (
  columns: DataTableColumn<FixListLine>[],
): DataTableColumn<FixListLine>[] =>
  withValues(columns, {
    so_no: (r) => r.docCode,
    drawing: (r) => (r.hasDrawing ? 'Yes' : 'No'),
  });

/** The open Fix List tab as one sheet: the rows the user sees after the search. */
export function fixListExportSpec<T extends FixListRouteCard | FixListLine | FixListStock>(a: {
  tabLabel: string;
  tableKey: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  search: string;
}): ListExportSpec<T> {
  const term = a.search.trim();
  return {
    fileName: 'Drawing Rev Fix List',
    tableKey: a.tableKey,
    columns: a.columns,
    rows: a.rows,
    rowKey: a.rowKey,
    filterSummary: [`Tab: ${a.tabLabel}`, term ? `search "${term}"` : null]
      .filter((w): w is string => w !== null)
      .join(' · '),
  };
}
