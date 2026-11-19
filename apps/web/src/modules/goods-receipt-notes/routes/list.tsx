// GRN list (UI-003-05). Ports legacy renderGRN L26444.
//
// ADR-199 table standard: ONE shared FIT table (<DataTable tableKey=…>).
// ADR-303 (2026-11-16): ONE ROW PER GRN again, read from GET
// /goods-receipt-notes (ADR-261 had made it one row per line; /lines stays for
// export). The QC-status dropdown counts are GRN counts; the QC Status cell is
// the receipt's ONE status rolled up from its lines (server-side).
//
// Pagination is KEPT (unlike SO/WO masters): the GRN API is paginated and the
// receipt book grows every day, so the list stays a pager register (ListFooter
// pager mode) rather than a one-fetch scroll.

import { Icon } from '@/ui/core';
import {
  DOC_QC_STATUSES,
  GRN_QC_STATUSES,
  type DocQcStatus,
  type GoodsReceiptNoteListItem,
  type GrnSummary,
  type ListGoodsReceiptNotesQuery,
} from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { CancelDocDialog } from '@/modules/cancel-requests/components/cancel-doc-dialog';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIVE_FALLBACK_POLL_MS } from '@/lib/live-updates/constants';
import { usePendingEditIds } from '@/modules/document-edits/api';
import { AssignTaskModal } from '@/modules/tasks/components/assign-task-modal';
import { authenticatedRoute } from '@/routes/_authenticated';
import { OrderSfFilter } from '@/modules/order-options/components/order-sf-filter';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useGoodsReceiptNotesList } from '../api';
import {
  goodsReceiptNoteListColumns,
  grnTypeLabel,
  isGrnCancelled,
} from '../components/grn-list-columns';
import { DOC_QC_LABELS } from '../components/doc-qc-badge';
import { useGrnPrint } from '../components/use-grn-print';
import { GRN_QC_STATUS_LABELS } from '../lib/grn-labels';
import { grnExportSpec } from '../lib/export';

// Pagination is KEPT here (unlike SO Master): the GRN API is paginated and the
// receipt book grows every day, so the whole list is not loaded in one go.
const PAGE_SIZE = 25;

// The receipt's QC status → row tint (ADR-199 ROW_TINT): Pending reads as
// pending work, Done is done; Partly done is the active middle, untinted.
const ROW_TINT_BY_QC: Record<DocQcStatus, string | undefined> = {
  pending: ROW_TINT.pending,
  partly_done: undefined,
  done: ROW_TINT.done,
};

const listSearchSchema = z.object({
  search: z.string().optional(),
  // ADR-303 — the QC Status dropdown: the receipt's ONE status (the column).
  docQc: z.enum(DOC_QC_STATUSES).optional(),
  // Old links / bookmarks (per-line QC values): still honoured by the server.
  qcStatus: z.enum(GRN_QC_STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

export const goodsReceiptNotesListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'goods-receipt-notes',
  validateSearch: listSearchSchema,
  component: GoodsReceiptNotesListPage,
});

function GoodsReceiptNotesListPage(): React.JSX.Element {
  const search = goodsReceiptNotesListRoute.useSearch();
  const navigate = goodsReceiptNotesListRoute.useNavigate();
  // Tier-driven, per department (Store). Was `role === admin || manager`, which
  // handed a Purchase manager the Store's receipt book and locked out the L2
  // storekeeper whose job this is.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'grn_create');

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    // Adopt a URL term the box did not produce (Back, a pasted link); keep the
    // raw draft (a typed trailing space) when it already normalises to it.
    setSearchInput((prev) =>
      normalizeSearchTerm(prev) === (search.search ?? '') ? prev : (search.search ?? ''),
    );
  }, [search.search]);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  IN-GRN  00012 " and "IN-GRN 00012" are one query, one cache entry, one URL.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  // Sort & Filter runs on the SERVER here (ADR-200): the list is paged, so
  // filtering only the loaded page would miss GRNs. Every change goes to page 1.
  const sf = useServerSortFilter(TABLE_KEYS.grnList, () => {
    void navigate({ search: (prev) => ({ ...prev, page: 1 }), replace: true });
  });

  const query: ListGoodsReceiptNotesQuery = useMemo(
    () => ({
      search: search.search,
      qcStatus: search.qcStatus,
      docQcStatus: search.docQc,
      sf: sf.param,
      // ADR-235 — Cancelled GRNs stay on the list, washed and marked Cancelled.
      includeCancelled: true,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [sf.param, search.search, search.qcStatus, search.docQc, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useGoodsReceiptNotesList(query, {
    refetchInterval: LIVE_FALLBACK_POLL_MS,
  });
  const qcActive = search.docQc !== undefined || search.qcStatus !== undefined;
  const filtered = sf.filtering || Boolean(search.search) || qcActive;

  const rows = data?.items ?? [];

  // ADR-202 — GRN ids with a pending edit; their status cell reads "Draft".
  const draftIds = usePendingEditIds('GoodsReceiptNote');
  const columns = useMemo(
    () => goodsReceiptNoteListColumns((search.page - 1) * PAGE_SIZE + 1, draftIds),
    [search.page, draftIds],
  );
  // ADR-310 — the shared Export: every row matching the search / filters /
  // Sort & Filter, in the columns the user sees.
  const exportSpec = useMemo(
    () =>
      grnExportSpec({
        columns,
        draftIds,
        tableKey: TABLE_KEYS.grnList,
        search: search.search,
        qcStatus: search.qcStatus,
        docQcStatus: search.docQc,
        sfParam: sf.param,
        hideMoney: !perms.price,
      }),
    [columns, draftIds, search.search, search.qcStatus, search.docQc, sf.param, perms.price],
  );

  // ⋯ row menu — Assign Task (link a task to this GRN), the same gate the
  // retired card used: shown only while a line still awaits QC
  // (qcPendingCount > 0). ADR-232: shown only to a user holding this page's
  // Advance right.
  const canAssign = perms.advance;
  const [assignGrn, setAssignGrn] = useState<GoodsReceiptNoteListItem | null>(null);
  // Cancel GRN -> Edit OR Approve (ADR-235, the ONE standard Cancel): Edit
  // sends a Cancel Request, Approve decides it. The dialog reads the server's
  // preview, which says which of the two this user may press. A Cancelled
  // GRN's ⋯ offers only Preview / Download PDF.
  const canCancel = perms.edit || perms.approve;
  const [cancelGrn, setCancelGrn] = useState<GoodsReceiptNoteListItem | null>(null);
  // Preview / Download PDF print the same sheet the detail page does
  // (use-grn-print.ts) — on every row, since printing follows View.
  const grnPrint = useGrnPrint();
  const rowActions = (grn: GoodsReceiptNoteListItem): React.JSX.Element => {
    const doc = { id: grn.id, code: grn.code, vendorId: grn.vendorId };
    return (
      <RowActions
        renderLink={(p) => <Link {...p} />}
        items={[
          {
            key: 'preview',
            label: 'Preview',
            icon: 'eye',
            onSelect: () => void grnPrint('preview', doc, draftIds.has(doc.id)),
          },
          {
            key: 'download',
            label: 'Download PDF',
            icon: 'download',
            onSelect: () => grnPrint('download', doc, draftIds.has(doc.id)),
          },
          {
            key: 'assign',
            label: 'Assign Task',
            icon: 'user-round',
            group: 'assign',
            hidden: !(grn.qcPendingCount > 0 && canAssign) || isGrnCancelled(grn),
            onSelect: () => setAssignGrn(grn),
          },
          {
            key: 'cancel',
            label: 'Cancel GRN',
            icon: 'x',
            group: 'danger',
            hidden: !canCancel || isGrnCancelled(grn),
            onSelect: () => setCancelGrn(grn),
          },
        ]}
      />
    );
  };

  const total = data?.total ?? 0;

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view GRNs. Ask an admin.
      </div>
    );
  }

  return (
    // `page-fill` (ADR-202): the page fills the content area and the TABLE is the
    // only scrollbox, so the column header cannot ride off the top at the last row.
    <div className="page-fill">
      {/* THE list header (ui/layout ListHeader): title · count · + New GRN, then
          the filter bar (search · QC status with counts · Clear), with the
          read-only "Today" tile inside the same band. */}
      <ListHeader
        exportSpec={exportSpec}
        orderFilter={<OrderSfFilter sf={sf} field="soCode" />}
        title="GRN"
        icon="📥"
        count={total}
        noun="GRN"
        filterNote={
          search.docQc
            ? DOC_QC_LABELS[search.docQc]
            : search.qcStatus
              ? GRN_QC_STATUS_LABELS[search.qcStatus]
              : undefined
        }
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search GRN no., PO, vendor, item, SO, DC, invoice…"
        updating={isFetching && !isLoading}
        filters={
          // ADR-303 — QC status = the QC Status column (the receipt's ONE
          // status, server-side), with the summary's live-GRN counts. An old
          // `qcStatus` link is shown as "All" here but still filters.
          <select
            className="innovic-select"
            aria-label="QC status"
            title="QC status"
            value={search.docQc ?? ''}
            onChange={(e) => {
              const v = e.target.value as DocQcStatus | '';
              void navigate({
                search: (prev) => ({
                  ...prev,
                  docQc: v === '' ? undefined : v,
                  qcStatus: undefined,
                  page: 1,
                }),
                replace: true,
              });
            }}
          >
            <option value="">{withCount('All', data?.summary?.total)}</option>
            {DOC_QC_STATUSES.map((s) => (
              <option key={s} value={s}>
                {withCount(DOC_QC_LABELS[s], qcCountFor(s, data?.summary))}
              </option>
            ))}
          </select>
        }
        onClearFilters={() => {
          sf.clearFilters();
          setSearchInput('');
          void navigate({
            search: (prev) => ({
              ...prev,
              search: undefined,
              qcStatus: undefined,
              docQc: undefined,
              page: 1,
            }),
            replace: true,
          });
        }}
        filtersActive={sf.filtering || qcActive || searchInput !== ''}
        primary={
          perms.entry ? (
            <Link to="/goods-receipt-notes/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> New GRN
            </Link>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load GRNs. Try again.'}
        />
      ) : (
        <Panel fill bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.grnList}
            columns={columns}
            rows={rows}
            loading={isLoading}
            emptyText={filtered ? 'No GRNs match.' : 'No GRNs yet.'}
            rowKey={(l) => l.id}
            sortFilterServer={sf}
            onRowClick={(l) =>
              void navigate({ to: '/goods-receipt-notes/$id', params: { id: l.id } })
            }
            rowClassName={(l) =>
              isGrnCancelled(l)
                ? ROW_TINT.cancelled
                : l.docQcStatus
                  ? ROW_TINT_BY_QC[l.docQcStatus]
                  : undefined
            }
            rowActions={(l) => rowActions(l)}
          />
        </Panel>
      )}

      {/* Legacy L26502-26503 — the tip line under the register. GRN keeps the
          Prev/Next pager (ListFooter pager mode) — an unbounded register. */}
      <ListFooter
        total={total}
        noun="GRN"
        page={search.page}
        pageSize={PAGE_SIZE}
        onPage={(p) =>
          void navigate({
            search: (prev) => ({
              ...prev,
              page: Math.min(Math.max(1, Math.ceil(total / PAGE_SIZE)), Math.max(1, p)),
            }),
            replace: true,
          })
        }
        hint="Only QC-accepted qty goes into stock."
      />

      {assignGrn ? (
        <AssignTaskModal
          linkedRef={{
            type: 'GRN',
            id: assignGrn.id,
            display: assignGrn.code,
            // ADR-251: Incoming QC lists only GRNs Against PO; an OSP / NC
            // return is inspected on the QC Call Register.
            navPage: ['Against NC', 'Against JW PO / DC'].includes(grnTypeLabel(assignGrn) ?? '')
              ? '/qc-call-register'
              : '/incoming-qc',
          }}
          suggestedTitle={`Inspect ${assignGrn.code}`}
          onClose={() => setAssignGrn(null)}
        />
      ) : null}
      {cancelGrn ? (
        <CancelDocDialog
          docType="grn"
          docId={cancelGrn.id}
          docCode={cancelGrn.code}
          onClose={() => setCancelGrn(null)}
        />
      ) : null}
    </div>
  );
}

// PL-GRN-1b — legacy renderGRN L26483–26488 showed four tiles. Total / QC
// Pending / QC Cleared filtered by qcStatus; they are now the counts in the
// QC-status dropdown (2026-09-26 filter bar). "Today" never filtered; its
// read-only tile was dropped 2026-11-03 (owner: no tile row above any list).

/** "Label (N)" when a count is known, bare label otherwise. */
function withCount(label: string, n: number | undefined): string {
  return n === undefined ? label : `${label} (${n})`;
}

/** ADR-303 — the count behind one QC status: live GRNs with that ONE status. */
function qcCountFor(s: DocQcStatus, summary: GrnSummary | undefined): number | undefined {
  if (!summary) return undefined;
  if (s === 'pending') return summary.docQcPending;
  if (s === 'partly_done') return summary.docQcPartlyDone;
  return summary.docQcDone;
}
