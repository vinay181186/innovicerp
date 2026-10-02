// Alerts drill-down page (T-041d Phase A). Mirrors legacy `_alertDrillDown`
// (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html L22374):
//   - modal title "<name> (<n> records)" (L22418) → the page `.section-hdr`
//   - legacy's header block (L22419-22422) dropped — it repeated the name and
//     count already in the title (R5 SH-N19)
//   - `.tbl-wrap > table` records table (L22423)
//
// Legacy rendered this as a `showModalLg` opened from the dashboard row; the
// port is a route (`/alerts/$code`). That divergence is deliberate.
//
// COLUMNS: legacy hard-codes a per-code column set inline (L22383-22416) and
// styles each cell by branch. The port drives columns from the server's
// `columns` array (registry definition per alert) — DATA-DRIVEN, so they differ
// per alert type. ADR-199 builds them with the engine's `dynamicColumns` helper
// so the generated column ids are stable (seeded off each column's `key`, never
// the loop index) and the user's saved layout survives a reload.
// Several legacy columns are not sourceable from our payload at all; they are
// reported rather than fabricated. See the refactor report / ISSUE-088.

import type { AlertColumn, AlertRow } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback } from 'react';
import { z } from 'zod';
import { fmtDate } from '@/lib/date';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, dynamicColumns, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useAlert } from '../api';

export const alertsDrillRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'alerts/$code',
  // ADR-201: the records page at 25 — only that page comes from the server.
  validateSearch: z.object({ page: pageSearchParam }),
  component: AlertDrillPage,
});

// The underlying document a record opens on (ADR-190): `navPage` is on the row,
// not a column. Returns the path string only when it is a real one.
function rowNavPage(row: AlertRow): string | null {
  const to = row['navPage'];
  return typeof to === 'string' && to ? to : null;
}

// Build the drill columns from the server's definition. Data-driven — the set
// differs per alert type — so the ids are seeded off each column's stable `key`
// via `dynamicColumns`. First column = the doc no (mono/bold cyan, opens the
// document on the row click); number columns right-align; dates format.
function buildColumns(cols: AlertColumn[]): DataTableColumn<AlertRow>[] {
  return dynamicColumns<AlertColumn, AlertRow>('alertDrill', cols, (c, i) => ({
    header: c.label,
    idSeed: c.key,
    key: c.key,
    kind: i === 0 ? 'code' : c.type === 'number' ? 'num' : c.type === 'date' ? 'date' : 'text',
    ...(c.type === 'number' ? { align: 'right' as const } : {}),
    className: i === 0 ? 'mono fw-700' : c.type === 'number' ? 'mono' : undefined,
    ...(i !== 0 && c.type !== 'number' && c.type !== 'date' ? { ellipsis: true } : {}),
    render: (row: AlertRow) => {
      const v = row[c.key];
      const display =
        v == null
          ? ''
          : c.type === 'number'
            ? Number(v).toLocaleString()
            : c.type === 'date'
              ? fmtDate(String(v), '')
              : String(v);
      return i === 0 ? <span style={{ color: 'var(--cyan)' }}>{display}</span> : display;
    },
  }));
}

function AlertDrillPage() {
  const { code } = alertsDrillRoute.useParams();
  const { page } = alertsDrillRoute.useSearch();
  const routeNavigate = alertsDrillRoute.useNavigate();
  const offset = pageOffset(page);
  const { data, isLoading, isError, error } = useAlert(code, LIST_PAGE_SIZE, offset);
  const navigate = useNavigate();
  const gotoPage = useCallback(
    (p: number) => void routeNavigate({ search: { page: p } }),
    [routeNavigate],
  );
  useClampPage(page, data?.alert.count, gotoPage);

  const notFound = error?.message?.toLowerCase().includes('not found') ?? false;

  return (
    <div>
      {/* Header — legacy's modal title bar (L22418). The Back link has no legacy
          counterpart (the modal had a close button); kept as the port's only
          in-page route back to the dashboard. */}
      <ListHeader
        title={data ? data.alert.name : 'Alert'}
        icon="🔔"
        count={data ? data.alert.count : undefined}
        noun="record"
        tools={
          <Link to="/alerts" className="btn btn-ghost btn-sm">
            ← Back to Alerts
          </Link>
        }
      />

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading…
          </div>
        </div>
      ) : isError || !data ? (
        <div className="panel">
          <div className="empty-state">
            <span style={{ color: 'var(--red2)' }}>
              {notFound
                ? 'Alert not found. Refresh the page.'
                : (error?.message ?? 'Could not load alert. Try again.')}
            </span>
          </div>
        </div>
      ) : (
        <>
          <Panel bodyPadding="none">
            <DataTable
              tableKey={TABLE_KEYS.alertDrill}
              columns={buildColumns(data.columns)}
              rows={data.alert.records}
              rowKey={(_, i) => `row-${offset + i}`}
              sortFilter={false}
              empty="✅ Nothing pending"
              isRowClickable={(row) => rowNavPage(row) !== null}
              onRowClick={(row) => {
                const to = rowNavPage(row);
                if (to) void navigate({ to });
              }}
            />
          </Panel>
          <ListFooter
            total={data.alert.count}
            noun="record"
            page={page}
            pageSize={LIST_PAGE_SIZE}
            onPage={gotoPage}
          />
        </>
      )}
    </div>
  );
}
