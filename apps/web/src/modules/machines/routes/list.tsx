// Machine Master list (UI-003-02).
// Ports legacy renderMachines (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html
// L13070-13111) to Innovic chrome.
//
// Legacy renders 10 columns: Machine ID | Name | Type | Cap/Shift | ₹/hr |
// Status | Avail Qty | Pending Hrs | 🔧 Maint | Actions. We render 7 — the
// three DELTA columns need data this page's API does not return:
//   • Avail Qty / Pending Hrs — calc-engine machineLoad (legacy L1703-1715).
//     Computed today by the machine-loading module (machineLoadCardSchema:
//     totalAvailQty, pendingHrs) but NOT by GET /machines; wiring a second
//     endpoint in is out of this UI-only pass. See ISSUES ISSUE-018.
//   • 🔧 Maint — legacy derives it from m.lastMaintDate + m.maintCycleDays
//     (L13074-13083); neither column exists in our machines table.
// Legacy's 🔧 Log-Maintenance and Del row actions are likewise DELTA (no
// maint_log table; delete lives on the detail page).
//
// The "Shifts" column previously rendered here is not a legacy column —
// legacy carries shifts on the machine FORM only — so it is dropped and its
// slot returns to legacy's ₹/hr.
//
// TABS (migration 0116): this one screen now holds TWO masters — the machines
// themselves and the Machine Group master they are picked from (VMC, CNC…) —
// behind a Machines | Machine Groups strip, exactly as Raw Material Master
// holds Grade | Size. The tab lives in the URL (?tab=groups) so it is
// bookmarkable. A Group column sits beside the existing free-text Type column;
// Type is unchanged and was NOT replaced.
//
// SHEET (2026-09-21): the list renders on the ruled sheet (`tbl-grid`) the SO
// Master List view uses — Sr No first, Action last, fixed % widths that add up
// to 100 so nothing scrolls sideways, a sticky toolbar band above it. The
// per-column sort (TanStack + SortableHead) is gone: the SO standard has none,
// and it only ever re-ordered the 25 rows on screen.

import type { ListMachinesQuery } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, Eye, Loader2, Pencil, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useMachineGroupLookup, useMachinesList } from '../api';
import { MachineGroupTab } from '../components/machine-group-tab';

const PAGE_SIZE = 25;
const STATUSES = ['Idle', 'Running', 'Down', 'Maintenance'] as const;
// Sr No | Machine ID | Name | Type | Group | Cap/Shift | ₹/hr | Status | Action.
// ₹/hr is dropped for L1 Viewers (the API withholds money), so the live count
// is one less for them — see `columnCount` below.
const COLUMN_COUNT = 9;

const listSearchSchema = z.object({
  // Absent = the machines tab, so every existing /machines link still lands on
  // the machines list.
  tab: z.enum(['groups']).optional(),
  search: z.string().optional(),
  status: z.enum(STATUSES).optional(),
  page: z.coerce.number().int().positive().default(1),
});

const TABS = [
  { key: 'machines', label: '🏭 Machines' },
  { key: 'groups', label: '🗂 Machine Groups' },
] as const;

export const machinesListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'machines',
  validateSearch: listSearchSchema,
  component: MachinesListPage,
});

function statusBadgeClass(status: string): string {
  if (status === 'Running') return 'b-blue';
  if (status === 'Idle') return 'b-grey';
  if (status === 'Maintenance') return 'b-amber';
  if (status === 'Down') return 'b-red';
  return 'b-grey';
}

function MachinesListPage(): React.JSX.Element {
  const search = machinesListRoute.useSearch();
  const navigate = machinesListRoute.useNavigate();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'machine_create');
  const tab = search.tab ?? 'machines';

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load. Checked once here, so it covers both
  // tabs.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
      </div>
    );
  }

  return (
    <div>
      <div className="section-hdr">Machine Master</div>

      {/* Machines | Machine Groups switch — the same strip as Raw Material
          Master's Grade | Size. */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border)',
          marginBottom: 14,
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() =>
              void navigate({
                // Switching master clears the machine filters — a machine
                // search means nothing on the group list.
                search: () => (t.key === 'groups' ? { tab: 'groups', page: 1 } : { page: 1 }),
                replace: true,
              })
            }
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid var(--cyan)' : '2px solid transparent',
              color: tab === t.key ? 'var(--cyan)' : 'var(--text3)',
              fontSize: 12,
              fontWeight: 700,
              padding: '6px 12px',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'groups' ? <MachineGroupTab /> : <MachinesTab />}
    </div>
  );
}

function MachinesTab(): React.JSX.Element {
  const search = machinesListRoute.useSearch();
  const navigate = machinesListRoute.useNavigate();

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  VMC  01 " and "VMC 01" are one query, one cache entry, one URL.
    const trimmed = normalizeSearchTerm(searchInput);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === search.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, search.search, navigate]);

  const query: ListMachinesQuery = useMemo(
    () => ({
      search: search.search,
      status: search.status,
      limit: PAGE_SIZE,
      offset: (search.page - 1) * PAGE_SIZE,
    }),
    [search.search, search.status, search.page],
  );

  const { data, isLoading, isFetching, isError, error } = useMachinesList(query);
  // A machine stores only the group's id, so the whole (small) group master
  // comes down once — the same cached fetch the detail page and the machine
  // form use.
  const groupLookup = useMachineGroupLookup();
  // Tier-driven, per department (machine_create sits in Production). Replaces
  // the old admin/manager flag, which collapsed all seven tiers into two.
  //   Add   -> entry (L2 Data Entry and up)
  //   Edit  -> edit  (L3 Editor and up; L2 creates but cannot alter)
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'machine_create');
  const canAdd = perms.entry;
  const canEdit = perms.edit;
  // Money hidden for L1 Viewers: the API nulls hourRate, so the ₹/hr column is
  // dropped entirely for them.
  // Told by the server, not inferred from a null money field: a null also means
  // "no value yet", so probing it hid money from users entitled to see it.
  const priceHidden = data ? !data.priceVisible : false;
  const columnCount = priceHidden ? COLUMN_COUNT - 1 : COLUMN_COUNT;

  const rows = data?.machines ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = search.page;

  // The page title and the "Hide page" access gate now live in the tab shell
  // above, so they cover both tabs and are not repeated here.
  return (
    <div>
      {/* Sticky toolbar band — the same shape as the SO Master list's: pinned
          to #content's top so the count, search, status filter and + Add stay
          put while the sheet scrolls underneath. Opaque `--bg` so rows do not
          show through. The page title sits in the tab shell above (it covers
          both tabs), so the band's left side carries the count line only. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: 'var(--bg)',
          paddingBottom: 8,
          marginBottom: 10,
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          {/* Count comes from the list response's `total` — the only aggregate
              GET /machines returns. */}
          <div className="text3" style={{ fontSize: 12, marginTop: 2 }}>
            {total} machine{total === 1 ? '' : 's'}
            {search.status ? (
              <>
                {' '}
                · <span className="text2">{search.status}</span> only
              </>
            ) : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* Placeholder stays generic on purpose: naming columns here is what
                dated the old wording, and GET /machines matches across the
                columns the table shows. */}
            <input
              className="innovic-input"
              placeholder="Search this list…"
              title="Search this list"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              style={{ width: 220, fontSize: 12 }}
            />
            <select
              className="innovic-select"
              value={search.status ?? ''}
              onChange={(e) => {
                const v = e.target.value as (typeof STATUSES)[number] | '';
                void navigate({
                  search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                  replace: true,
                });
              }}
              style={{ width: 140, fontSize: 12 }}
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {isFetching && !isLoading ? (
              <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
              </span>
            ) : null}
            {canAdd ? (
              <Link to="/machines/new" className="btn btn-primary">
                <Plus size={14} /> Add Machine
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {/* The ruled sheet (tbl-grid): every column centred by the standard,
          Name left-aligned (a name reads from its left edge). Widths live only
          in the colgroup and sum to 100 — with ₹/hr hidden its 9% goes to
          Name. */}
      <div className="tbl-wrap" style={{ overflowX: 'hidden' }}>
        <table className="innovic-table tbl-grid">
          <colgroup>
            <col style={{ width: '5%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: priceHidden ? '35%' : '26%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '9%' }} />
            {priceHidden ? null : <col style={{ width: '9%' }} />}
            <col style={{ width: '10%' }} />
            <col style={{ width: '8%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Sr No</th>
              <th>Machine ID</th>
              <th style={{ textAlign: 'left' }}>Name</th>
              <th>Type</th>
              <th>Group</th>
              <th>Cap/Shift</th>
              {/* Legacy: <th style="color:var(--green)">₹/hr</th> (L13107). */}
              {priceHidden ? null : (
                <th>
                  <span style={{ color: 'var(--green)' }}>₹/hr</span>
                </th>
              )}
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columnCount} className="empty-state">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                  Loading…
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={columnCount} className="empty-state" style={{ color: 'var(--red)' }}>
                  {error instanceof Error ? error.message : 'Failed to load machines'}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="empty-state">
                  No machines
                </td>
              </tr>
            ) : (
              rows.map((m, i) => (
                <tr
                  key={m.id}
                  onClick={() => void navigate({ to: '/machines/$id', params: { id: m.id } })}
                  style={{ cursor: 'pointer' }}
                >
                  <td className="text3">{(currentPage - 1) * PAGE_SIZE + i + 1}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <Link
                      to="/machines/$id"
                      params={{ id: m.id }}
                      className="td-code"
                      title="Open this machine"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {m.code}
                    </Link>
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <div
                      className="fw-700"
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={m.name}
                    >
                      {m.name}
                    </div>
                  </td>
                  <td className="text2">{m.machineType ?? '—'}</td>
                  {/* A machine with no group is normal — every row created
                      before the group master existed. Show an em dash. */}
                  <td className="text2">
                    {(m.machineGroupId ? groupLookup.get(m.machineGroupId)?.code : null) ?? '—'}
                  </td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    {m.capacityPerShift != null ? `${m.capacityPerShift}h` : '—'}
                  </td>
                  {priceHidden ? null : (
                    <td className="mono green" style={{ whiteSpace: 'nowrap' }}>
                      {m.hourRate ? `₹${m.hourRate.toFixed(0)}` : '—'}
                    </td>
                  )}
                  <td>
                    <span className={`badge ${statusBadgeClass(m.status)}`}>{m.status}</span>
                  </td>
                  <td>
                    {/* Icon buttons only, one row, hover names the action.
                        View is open to everyone who can see the page; Edit
                        needs the edit right. The row itself navigates, so the
                        block stops the click. */}
                    <div
                      style={{ display: 'flex', gap: 4, justifyContent: 'center' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Link
                        to="/machines/$id"
                        params={{ id: m.id }}
                        className="btn btn-ghost btn-sm btn-icon"
                        title="View"
                        aria-label="View"
                      >
                        <Eye size={14} />
                      </Link>
                      {canEdit ? (
                        <Link
                          to="/machines/$id/edit"
                          params={{ id: m.id }}
                          className="btn btn-ghost btn-sm btn-icon"
                          title="Edit"
                          aria-label="Edit"
                        >
                          <Pencil size={14} />
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 8,
          fontSize: 12,
          color: 'var(--text3)',
        }}
      >
        <span>
          {total === 0
            ? 'No machines'
            : `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, total)} of ${total}`}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={currentPage <= 1}
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.max(1, currentPage - 1) }),
                replace: true,
              })
            }
          >
            <ChevronLeft size={14} /> Prev
          </button>
          <span style={{ fontFamily: 'var(--mono)', padding: '0 8px' }}>
            Page {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={currentPage >= totalPages}
            onClick={() =>
              void navigate({
                search: (prev) => ({ ...prev, page: Math.min(totalPages, currentPage + 1) }),
                replace: true,
              })
            }
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
