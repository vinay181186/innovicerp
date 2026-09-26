// Vendor Master list (UI-003-02; legacy parity pass 2026-07-15).
// Ports legacy renderVendors (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L27734) to Innovic chrome. Legacy columns, in order: Code | Name | Contact |
// Phone | Email | GST No. | Address | Rating | Status | PO/GRN | Actions.
//
// Two legacy columns/behaviours are DELTA (blocked on backend, not faked here):
//   * PO/GRN — legacy counts db.purchaseOrders/db.grn client-side because it
//     holds the whole DB in memory. Our Vendor payload carries no counts, and
//     deriving them here would mean fetching every PO+GRN to count in the
//     browser (Rule 1 / N+1). Needs an aggregate on the vendors list endpoint.
//   * Rating — legacy shows an auto-computed grade+score (_calcVendorRating,
//     L27784) and opens a scorecard modal (_showVendorScore, L27814). Our
//     `rating` is a manually-entered letter, so we render the badge only. The
//     legacy badge's cursor:pointer + title="Click for details" are deliberately
//     NOT copied — there is no scorecard to open.
//
// PHASE 4 — composed exactly like the reference list
// (modules/clients/routes/list.tsx), which this screen is the twin of:
//
//   <ListHeader>            title · count · SearchInput · ⟳ Updating… · primary
//     <StatStrip>           counts that double as the status filter
//   </ListHeader>
//   <Banner>                import result (dismissible)
//   <Panel><DataTable>      THE ruled sheet — loading + empty are its own states
//   <ListFooter>            count line · 💡 hint · Excel template / import
//   <PageState>             no-access and load-failure
//
// Everything this file used to draw by hand — the sticky band, the search box,
// the <table>/<colgroup>/<thead>, the loading / error / empty rows, the two
// badges, the row-action buttons, the count line, the 💡 hint, the import
// notice and `confirm()` — now comes from apps/web/src/ui/. The only things
// left here are the DATA and the RULES: the query, the client-side status
// split, the permission gates and the import.
//
// What did NOT change: the route and its search params, the 300ms debounce on
// the URL write, normalizeSearchTerm, the single un-filtered fetch (so the
// strip can count all three tiles), perms -> canAdd/canEdit/canDelete, the
// one-request bulk import, row click -> detail, Code cell -> detail.

import type { ListVendorsQuery, Vendor } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Button, Icon, StatusBadge } from '@/ui/core';
import { DataTable, Panel, StatStrip, type DataTableColumn } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useBulkCreateVendors, useSoftDeleteVendor, useVendorsList } from '../api';
import { downloadVendorTemplate, parseVendorImportFile } from '../lib/import-export';

// No pagination — Vendors is a master list, so it mirrors the SO/WO list: one
// fetch, everything in a single scrolling list (styling skill, Rule 4). The
// vendors list endpoint caps `limit` at 1000 (packages/shared vendor schema,
// raised from 200 to match the SO master); ListFooter flags a larger set.
const LIST_LIMIT = 1000;

// Join a list of import warnings/failures for the status line, capping at 50 so
// a huge sheet can't produce an unbounded banner, but still showing far more
// than the old 3-item cap that hid most problems.
function fmtList(items: string[]): string {
  const shown = items.slice(0, 50).join('; ');
  return items.length > 50 ? `${shown} … (+${items.length - 50} more)` : shown;
}

const listSearchSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
});

export const vendorsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'vendors',
  validateSearch: listSearchSchema,
  component: VendorsListPage,
});

function VendorsListPage(): React.JSX.Element {
  const search = vendorsListRoute.useSearch();
  const navigate = vendorsListRoute.useNavigate();

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  Shree  Steel " and "Shree Steel" are one query, one cache entry, one URL.
    //
    // The debounce stays HERE, not on <SearchInput debounceMs>: what is being
    // delayed is the URL write, and the box must show the keystroke at once.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  // One fetch of every vendor matching the search (no isActive server filter):
  // the Active/Inactive split is derived + filtered client-side so the StatStrip
  // can show real counts for all three tiles.
  const query: ListVendorsQuery = useMemo(
    () => ({
      search: search.search,
      limit: LIST_LIMIT,
      offset: 0,
    }),
    [search.search],
  );

  const { data, isLoading, isFetching, isError, error } = useVendorsList(query);
  // Tier-driven, per department (vendor_create sits in Purchase). Replaces the
  // old admin/manager flag, which collapsed all seven tiers into two.
  //   Add / Excel import -> entry  (L2 Data Entry and up)
  //   Edit               -> edit   (L3 Editor and up; L2 creates but cannot alter)
  //   Del                -> edit AND approve. Delete is not one of the four tier
  //     actions, so it is expressed as the pair only L5 Department Admin and
  //     above hold: L3 has edit without approve, L4 has approve without edit.
  //     Previously admin-only, which locked out the tier meant to run the dept.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'vendor_create');
  const canAdd = perms.entry;
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  const setStatus = useCallback(
    (status: 'active' | 'inactive' | undefined) => {
      void navigate({ search: (prev) => ({ ...prev, status }), replace: true });
    },
    [navigate],
  );

  const softDelete = useSoftDeleteVendor();

  // Excel import — the WHOLE sheet goes in one request, and the list reloads
  // once at the end.
  //
  // It used to loop the single-create mutation over the rows: one round trip per
  // vendor, and because each success invalidated the list query, the browser
  // re-downloaded the entire vendor master after every row — so the import got
  // slower the longer it ran. Measured on the live system at ~1 vendor/second,
  // which put a 500-row sheet at about nine minutes.
  //
  // The duplicate-name guard moved to the server with it. It used to compare
  // against `data.vendors`, i.e. the page of vendors currently loaded on screen,
  // so anything past that page read as "new" and was created a second time.
  const bulkCreate = useBulkCreateVendors();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function onImportFile(file: File): Promise<void> {
    setImporting(true);
    setImportMsg(null);
    try {
      const { payloads, errors } = await parseVendorImportFile(file);
      if (payloads.length === 0) {
        setImportMsg(
          errors.length
            ? `Nothing to import. ${errors.length} row issue(s): ${fmtList(errors)}`
            : 'Nothing to import — the sheet has no vendor rows.',
        );
        return;
      }
      const res = await bulkCreate.mutateAsync({ vendors: payloads });
      const skips = res.skipped.map((s) => `Row ${s.index} "${s.name}": ${s.reason}`);
      setImportMsg(
        `Imported ${res.created}/${payloads.length} vendor(s).` +
          (skips.length ? ` ${skips.length} skipped: ${fmtList(skips)}` : '') +
          (errors.length ? ` ${errors.length} row warning(s): ${fmtList(errors)}` : ''),
      );
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : 'Could not import file. Try again.');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  // All rows matching the search; the Active/Inactive filter is client-side.
  const allRows = useMemo(() => data?.vendors ?? [], [data?.vendors]);
  const activeCount = useMemo(() => allRows.filter((v) => v.isActive).length, [allRows]);
  const inactiveCount = allRows.length - activeCount;
  const visibleRows = useMemo(() => {
    if (search.status === 'active') return allRows.filter((v) => v.isActive);
    if (search.status === 'inactive') return allRows.filter((v) => !v.isActive);
    return allRows;
  }, [allRows, search.status]);

  const total = data?.total ?? 0;

  // The sheet's columns. Widths are `%` and must sum to 100 WITH the Action
  // column (rowActionsWidth below): 4+8+15+9+8+11+12+10+6+6 = 89, + 11 = 100,
  // so the table never scrolls sideways. Centred by the standard; only Name is
  // left-aligned so the vendor names share one edge, and the long free-text
  // columns ellipsize with the full value on hover rather than wrapping the
  // row taller.
  const columns = useMemo<DataTableColumn<Vendor>[]>(
    () => [
      { header: 'Sr No', width: '4%', className: 'text3', render: (_v, i) => i + 1 },
      {
        header: 'Code',
        width: '8%',
        nowrap: true,
        // A real link, so the code can be ctrl/middle-clicked into a new tab.
        // stopPropagation sits on the link (not the cell) so clicking the rest
        // of the cell still opens the row, exactly as before.
        render: (v) => (
          <Link
            to="/vendors/$id"
            params={{ id: v.id }}
            className="td-code"
            style={{ textDecoration: 'none' }}
            onClick={(e) => e.stopPropagation()}
          >
            {v.code}
          </Link>
        ),
      },
      {
        header: 'Vendor Name',
        width: '15%',
        align: 'left',
        className: 'fw-700',
        ellipsis: true,
        key: 'name',
      },
      {
        header: 'Contact Person',
        width: '9%',
        ellipsis: true,
        render: (v) => v.contactPerson ?? '—',
        title: (v) => v.contactPerson ?? '',
      },
      { header: 'Phone', width: '8%', nowrap: true, render: (v) => v.phone ?? '—' },
      {
        header: 'Email',
        width: '11%',
        className: 'text3',
        ellipsis: true,
        render: (v) => v.email ?? '—',
        title: (v) => v.email ?? '',
      },
      { header: 'GST No.', width: '12%', nowrap: true, render: (v) => v.gstNumber ?? '—' },
      {
        header: 'Address',
        width: '10%',
        className: 'text3',
        ellipsis: true,
        render: (v) => v.addressLine1 ?? '—',
        title: (v) => v.addressLine1 ?? '',
      },
      {
        header: 'Rating',
        width: '6%',
        nowrap: true,
        // Same letter->colour map the hand-rolled ratingBadgeClass carried
        // (A green · B blue · C amber · D red), and the same one the vendor
        // detail page already draws, so list and detail cannot disagree.
        render: (v) => <StatusBadge kind="rating" status={v.rating} />,
      },
      {
        header: 'Vendor Status',
        width: '6%',
        nowrap: true,
        render: (v) => <StatusBadge kind="active" status={String(v.isActive)} />,
      },
    ],
    [],
  );

  // "Hide page" (Access Control → Config): once access has loaded, a user
  // whose VIEW was removed for this page sees the no-access panel, not the
  // page. `eff` is undefined only while access is still loading — don't block
  // then, or every legitimate user flashes this panel on cold load.
  if (eff && !perms.view) {
    return <PageState as="page" state="noaccess" />;
  }

  return (
    <div>
      {/* The frozen header band: title, count, search, primary action and the
          StatStrip stay put while the rows scroll underneath. */}
      <ListHeader
        title="Vendor Master"
        icon="🏭"
        count={total}
        noun="vendor"
        filterNote={search.status}
        search={searchInput}
        onSearch={setSearchInput}
        updating={isFetching && !isLoading}
        primary={
          canAdd ? (
            <Link to="/vendors/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> New Vendor
            </Link>
          ) : null
        }
      >
        {/* Counts double as the status filter (styling skill, Rule 3). Active
            state = coloured label + underline, handled inside <StatStrip>. */}
        <StatStrip
          items={[
            {
              key: 'all',
              label: 'All Vendors',
              count: total,
              color: 'var(--cyan)',
              active: search.status === undefined,
              onClick: () => setStatus(undefined),
            },
            {
              key: 'active',
              label: 'Active',
              count: activeCount,
              color: 'var(--green)',
              active: search.status === 'active',
              onClick: () => setStatus('active'),
            },
            {
              key: 'inactive',
              label: 'Inactive',
              count: inactiveCount,
              color: 'var(--text3)',
              active: search.status === 'inactive',
              onClick: () => setStatus('inactive'),
            },
          ]}
        />
      </ListHeader>

      {importMsg ? (
        <Banner tone="info" onDismiss={() => setImportMsg(null)}>
          {importMsg}
        </Banner>
      ) : null}

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load vendors. Try again.'}
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            columns={columns}
            rows={visibleRows}
            loading={isLoading}
            emptyText={
              search.status
                ? `No ${search.status} vendors`
                : 'No vendors. Add vendors to create Purchase Orders.'
            }
            onRowClick={(v) => void navigate({ to: '/vendors/$id', params: { id: v.id } })}
            rowActionsWidth="11%"
            rowActions={(v) => (
              <RowActions
                // View and Edit are ROUTES, so they stay real links —
                // ctrl-click / middle-click still open a new tab.
                viewTo={`/vendors/${v.id}`}
                editTo={canEdit ? `/vendors/${v.id}/edit` : undefined}
                renderLink={(p) => <Link {...p} />}
                // The PROMISE is handed back, not swallowed. The confirm
                // dialog then owns the wait: both its buttons go dead, "Moving
                // to Trash…" shows on the button, and it closes only once the
                // vendor really is in the Trash. A failure stays on screen as
                // an error in the dialog — which is what the old `confirm()`
                // could not do at all.
                onDelete={canDelete ? (): Promise<void> => softDelete.mutateAsync(v.id) : undefined}
                // And every OTHER row's Delete greys out while one is in
                // flight, exactly as `disabled={softDelete.isPending}` did.
                deleteDisabled={softDelete.isPending}
                deleteConfirm={{
                  title: `Move vendor ${v.name} to Trash?`,
                  message: `${v.code} — ${v.name} stops appearing in the Vendor Master and in every vendor picker.`,
                  confirmLabel: 'Move to Trash',
                  pendingLabel: 'Moving to Trash…',
                }}
              />
            )}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        shown={visibleRows.length}
        noun="vendor"
        limit={LIST_LIMIT}
        hint="Click a row to open the vendor. Click a count above to filter by status."
        // Legacy L27776-27779: Excel template + import sit below the count
        // line. The file input is hidden and only opened by the button.
        actions={
          canAdd ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon name="download" size={12} />}
                onClick={() => downloadVendorTemplate()}
              >
                Download Excel Template
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Icon name="upload" size={12} />}
                loading={importing}
                onClick={() => fileRef.current?.click()}
              >
                Import from Excel
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onImportFile(f);
                }}
              />
            </>
          ) : null
        }
      />
    </div>
  );
}
