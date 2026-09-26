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
// TABS (migration 0116): this one screen holds TWO masters — the machines
// themselves and the Machine Group master they are picked from (VMC, CNC…) —
// behind a Machines | Machine Groups strip, exactly as Raw Material Master
// holds Grade | Size. The tab lives in the URL (?tab=groups) so it is
// bookmarkable. A Group column sits beside the existing free-text Type column;
// Type is unchanged and was NOT replaced.
//
// PHASE 4 — migrated onto apps/web/src/ui/ with the Client Master list
// (modules/clients/routes/list.tsx) as the reference:
//
//   <TabStrip>              Machines | Machine Groups, inside the header band
//   <ListHeader>            title · count · SearchInput · status filter · primary
//   <Panel><DataTable>      THE ruled sheet — loading + empty are its own states
//   <ListFooter>            the count line and the Prev / Page n / Next pager
//   <PageState>             no-access and load-failure
//
// The hand-written sticky band, search box, status <select>, <table>/
// <colgroup>/<thead>, loading / error / empty rows, status badge, row-action
// buttons, count line and pager are all gone. The Machine GROUPS tab is a
// separate component (components/machine-group-tab.tsx) and is untouched.
//
// What did NOT change: the route and its search params (tab, search, status,
// page), the 300ms debounce on the URL write, normalizeSearchTerm, the 25-row
// server page, the group lookup, the `priceVisible` column drop for L1
// Viewers, perms -> canAdd/canEdit, row click -> detail, Code cell -> detail,
// and the tab switch clearing the machine filters.

import type { ListMachinesQuery, Machine } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Icon, StatusBadge } from '@/ui/core';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageHeader, PageState, RowActions } from '@/ui/layout';
import { TabStrip } from '@/ui/navigation';
import { useMachineGroupLookup, useMachinesList } from '../api';
import { MachineGroupTab } from '../components/machine-group-tab';

const PAGE_SIZE = 25;
const STATUSES = ['Idle', 'Running', 'Down', 'Maintenance'] as const;

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
];

export const machinesListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'machines',
  validateSearch: listSearchSchema,
  component: MachinesListPage,
});

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
    return <PageState as="page" state="noaccess" />;
  }

  // Machines | Machine Groups switch — one strip, rendered inside whichever
  // header band the active tab carries, so the page keeps ONE band.
  const tabs = (
    <TabStrip
      label="Machine master"
      tabs={TABS}
      activeKey={tab}
      onChange={(k) =>
        void navigate({
          // Switching master clears the machine filters — a machine search
          // means nothing on the group list.
          search: () => (k === 'groups' ? { tab: 'groups' as const, page: 1 } : { page: 1 }),
          replace: true,
        })
      }
    />
  );

  if (tab === 'groups') {
    return (
      <div>
        {/* The groups tab owns its own toolbar inside MachineGroupTab, so the
            shell carries only the page title and the tab strip. */}
        <PageHeader title="Machine Master">{tabs}</PageHeader>
        <MachineGroupTab />
      </div>
    );
  }

  return <MachinesTab tabs={tabs} />;
}

function MachinesTab({ tabs }: { tabs: React.ReactNode }): React.JSX.Element {
  const search = machinesListRoute.useSearch();
  const navigate = machinesListRoute.useNavigate();

  const [searchInput, setSearchInput] = useState(search.search ?? '');
  useEffect(() => {
    setSearchInput(search.search ?? '');
  }, [search.search]);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  VMC  01 " and "VMC 01" are one query, one cache entry, one URL.
    //
    // The debounce stays HERE, not on <SearchInput debounceMs>: what is being
    // delayed is the URL write, and the box must show the keystroke at once.
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

  const rows = data?.machines ?? [];
  const total = data?.total ?? 0;
  const currentPage = search.page;

  // The sheet's columns, unchanged from the hand-written <colgroup>: the widths
  // are `%` and must sum to 100 WITH the Action column (rowActionsWidth below).
  // With ₹/hr shown: 5+12+26+11+10+9+9+10 = 92, + 8 = 100. With it hidden its
  // 9% goes to Name (35%) and the sum still lands on 100. Centred by the
  // standard; only Name is left-aligned (a name reads from its left edge).
  const columns = useMemo<DataTableColumn<Machine>[]>(
    () => [
      {
        header: 'Sr No',
        width: '5%',
        className: 'text3',
        // Server-paged list: the serial number continues across pages.
        render: (_m, i) => (currentPage - 1) * PAGE_SIZE + i + 1,
      },
      {
        header: 'Code',
        width: '12%',
        nowrap: true,
        // A real link, so the code can be ctrl/middle-clicked into a new tab.
        // stopPropagation sits on the link (not the cell) so clicking the rest
        // of the cell still opens the row, exactly as before.
        render: (m) => (
          <Link
            to="/machines/$id"
            params={{ id: m.id }}
            className="td-code"
            title="Open this machine"
            style={{ textDecoration: 'none' }}
            onClick={(e) => e.stopPropagation()}
          >
            {m.code}
          </Link>
        ),
      },
      {
        header: 'Name',
        width: priceHidden ? '35%' : '26%',
        align: 'left',
        className: 'fw-700',
        ellipsis: true,
        key: 'name',
      },
      {
        header: 'Machine Type',
        width: '11%',
        className: 'text2',
        render: (m) => m.machineType ?? '—',
      },
      {
        header: 'Machine Group',
        width: '10%',
        className: 'text2',
        // A machine with no group is normal — every row created before the
        // group master existed. Show an em dash.
        render: (m) => (m.machineGroupId ? groupLookup.get(m.machineGroupId)?.code : null) ?? '—',
      },
      {
        header: 'Capacity / Shift',
        width: '9%',
        className: 'mono',
        nowrap: true,
        render: (m) => (m.capacityPerShift != null ? `${m.capacityPerShift}h` : '—'),
      },
      // Legacy: <th style="color:var(--green)">₹/hr</th> (L13107).
      ...(priceHidden
        ? []
        : [
            {
              header: 'Rate (₹/hr)',
              width: '9%',
              headColor: 'var(--green)',
              className: 'mono green',
              nowrap: true,
              render: (m: Machine) => (m.hourRate ? `₹${m.hourRate.toFixed(0)}` : '—'),
            },
          ]),
      {
        header: 'Machine Status',
        width: '10%',
        nowrap: true,
        // kind="machine" carries this screen's own four colours — Running blue,
        // Idle grey, Maintenance amber, Down red — the map the local
        // statusBadgeClass() held, now shared with the machine detail page so
        // the two cannot disagree.
        render: (m) => <StatusBadge kind="machine" status={m.status} />,
      },
    ],
    [currentPage, priceHidden, groupLookup],
  );

  // The page title, the tab strip and the "Hide page" access gate all come from
  // the shell above; the title sits in this band so the page keeps ONE header.
  return (
    <div>
      {/* The frozen header band: title, count, search, the status filter and
          the primary action stay put while the rows scroll underneath. */}
      <ListHeader
        title="Machine Master"
        // Count comes from the list response's `total` — the only aggregate
        // GET /machines returns.
        count={total}
        noun="machine"
        filterNote={search.status}
        search={searchInput}
        onSearch={setSearchInput}
        // Placeholder stays generic on purpose: naming columns here is what
        // dated the old wording, and GET /machines matches across the columns
        // the table shows.
        updating={isFetching && !isLoading}
        tools={
          <Select
            aria-label="Machine Status"
            fieldWidth="md"
            value={search.status ?? ''}
            options={[
              { value: '', label: 'All statuses' },
              ...STATUSES.map((s) => ({ value: s, label: s })),
            ]}
            onChange={(e) => {
              const v = e.target.value as (typeof STATUSES)[number] | '';
              void navigate({
                search: (prev) => ({ ...prev, status: v === '' ? undefined : v, page: 1 }),
                replace: true,
              });
            }}
          />
        }
        primary={
          canAdd ? (
            <Link to="/machines/new" className="btn btn-primary">
              <Icon name="plus" size={14} /> Add Machine
            </Link>
          ) : null
        }
      >
        {tabs}
      </ListHeader>

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Failed to load machines'}
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            columns={columns}
            rows={rows}
            loading={isLoading}
            emptyText="No machines"
            onRowClick={(m) => void navigate({ to: '/machines/$id', params: { id: m.id } })}
            rowActionsWidth="8%"
            rowActions={(m) => (
              // View and Edit are ROUTES, so they stay real links — ctrl-click
              // / middle-click still open a new tab. Delete is not offered on
              // this list; it lives on the machine detail page.
              <RowActions
                viewTo={`/machines/${m.id}`}
                editTo={canEdit ? `/machines/${m.id}/edit` : undefined}
                renderLink={(p) => <Link {...p} />}
              />
            )}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="machine"
        // Server-paged register: `page` switches the footer to the Prev/Next
        // pager, the same one this screen drew by hand.
        page={currentPage}
        pageSize={PAGE_SIZE}
        onPage={(p) => void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true })}
      />
    </div>
  );
}
