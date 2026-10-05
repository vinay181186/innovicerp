// Machine Master → MACHINE GROUPS tab. The master the shop floor types once —
// VMC, CNC, Lathe — and then picks from on every machine.
//
// PHASE — migrated onto the shared FIT table (ADR-199, table standard
// 2026-10-01): the ruled sheet is now <DataTable tableKey={machineGroups}>, so
// this list fits its width, drops the rightmost column into a ▸ detail row when
// too narrow, carries the Columns / density toolbar and saves the user's layout
// — the same table every other list uses. The hand-written <table>, loading /
// error / empty rows and count line are gone (DataTable + ListFooter own them).
//
// The header is the shared <ListHeader>: search, then an All / Active / Inactive
// dropdown whose labels carry the counts (owner's filter-bar decision
// 2026-09-26), then Clear. The New/Edit modal lives in machine-group-modal.tsx.
//
// A machine group has ONE value — `code` IS the word the user types (the master
// has no separate `name`, by its schema) — and there is no bulk-import endpoint,
// so there is no Name column and no Import action here.
//
// ADR-201: 25 groups a page (Prev / Next; the page lives in this tab's state —
// the tab has no route of its own). Search, the Active / Inactive filter and
// the column ▾ Sort & Filter run on the server over every group; the dropdown
// counts are server totals (limit:1 calls) under the same search + ▾ filters.
// Any change of those goes back to page 1. useMachineGroupLookup keeps its own
// whole-master query (limit 1000) and never shares this one.

import type { ListMachineGroupsQuery, MachineGroup } from '@innovic/shared';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { useSaveKey } from '@/lib/use-save-key';
import { isStagedResult, useDocumentEdits } from '@/modules/document-edits/api';
import { StatusBadge } from '@/ui/core';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ConfirmDialog } from '@/ui/feedback';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import {
  useCreateMachineGroup,
  useMachineGroupsList,
  useSoftDeleteMachineGroup,
  useUpdateMachineGroup,
} from '../api';
import { MachineGroupModal } from './machine-group-modal';

type ModalState = { kind: 'none' } | { kind: 'new' } | { kind: 'edit'; row: MachineGroup };
type StatusFilter = 'all' | 'active' | 'inactive';

const ACTIVE_OPTIONS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

export function MachineGroupTab({ tabs }: { tabs: React.ReactNode }): React.JSX.Element {
  // Same department form as the machines themselves (machine_create sits in
  // Production): Add = entry, Edit = edit, Del = the edit+approve pair only
  // L5 Department Admin and above hold.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'machine_create');
  const canAdd = perms.entry;
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  // The tab owns its own search box (the machines tab's box filters machines,
  // and a machine search means nothing on the group list). Debounced into the
  // query so a keystroke is not a request.
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const next = searchInput.trim();
    if (next === term) return;
    const id = window.setTimeout(() => {
      setTerm(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput, term]);
  const sf = useServerSortFilter(TABLE_KEYS.machineGroups, () => setPage(1));
  const [status, setStatus] = useState<StatusFilter>('all');

  // The page on screen: search + Active filter + ▾ on the server.
  const base = useMemo(
    () => ({ ...(term ? { search: term } : {}), ...(sf.param ? { sf: sf.param } : {}) }),
    [term, sf.param],
  );
  const query: ListMachineGroupsQuery = useMemo(
    () => ({
      ...base,
      ...(status === 'all' ? {} : { isActive: status === 'active' }),
      limit: LIST_PAGE_SIZE,
      offset: pageOffset(page),
    }),
    [base, status, page],
  );
  const list = useMachineGroupsList(query);
  // Dropdown counts — server totals under the same search + ▾ filters.
  const allCount = useMachineGroupsList({ ...base, limit: 1, offset: 0 }).data?.total;
  const activeCount = useMachineGroupsList({ ...base, isActive: true, limit: 1, offset: 0 }).data
    ?.total;
  const inactiveCount = useMachineGroupsList({ ...base, isActive: false, limit: 1, offset: 0 }).data
    ?.total;
  const onPage = useCallback((p: number) => setPage(p), []);
  useClampPage(page, list.data?.total, onPage);
  // R2: one save key per Add-modal open — rotated when the modal opens, since
  // the create hook lives here rather than in the modal.
  const saveKey = useSaveKey();
  const create = useCreateMachineGroup(saveKey);
  const update = useUpdateMachineGroup();
  const softDelete = useSoftDeleteMachineGroup();

  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  // The row waiting on the Move-to-Trash confirm (app ConfirmDialog, not window.confirm).
  const [trashRow, setTrashRow] = useState<MachineGroup | null>(null);
  // ADR-202 — the neutral "Sent for approval" notice after a staged edit save.
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const rows = useMemo(() => list.data?.groups ?? [], [list.data]);
  const total = list.data?.total ?? 0;
  const fmtCount = (n: number | undefined): string => (n === undefined ? '…' : String(n));

  // ADR-202 — the ids of groups that have an edit waiting for approval, so each
  // such row shows an amber "edit pending" chip. A machine group has no detail
  // page to carry per-field chips, so the row itself flags it. One query for the
  // whole master (hooks can't run per row); empty until the backend gate lands.
  const pendingEdits = useDocumentEdits({
    entity: 'MachineGroup',
    status: 'pending',
    limit: 200,
    offset: 0,
  });
  const pendingIds = useMemo(
    () => new Set((pendingEdits.data?.rows ?? []).map((r) => r.entityId)),
    [pendingEdits.data],
  );

  // The sheet's columns (first = Group Code, always pinned). No Name column:
  // the master has no `name` — the code IS the group. Description shares the
  // spare width and clips with "…" + tooltip; the Active chip never clips.
  const columns = useMemo<DataTableColumn<MachineGroup>[]>(
    () => [
      {
        id: 'code',
        header: 'Group Code',
        kind: 'code',
        nowrap: true,
        className: 'td-code',
        render: (row) => <span style={{ color: 'var(--cyan)' }}>{row.code}</span>,
        sortFilterField: 'code',
      },
      {
        id: 'description',
        header: 'Description',
        kind: 'text',
        align: 'left',
        className: 'text2',
        // ADR-202 — the description, with an amber "edit pending" chip when this
        // group has an edit waiting for approval (no detail page for per-field
        // chips, so the row flags it).
        render: (row) => (
          <>
            {row.description || '—'}
            {pendingIds.has(row.id) ? (
              <span
                className="tag b-amber"
                style={{ marginLeft: 6 }}
                title="An edit to this group is waiting for approval"
              >
                edit pending
              </span>
            ) : null}
          </>
        ),
        title: (row) => row.description ?? '',
        sortFilterField: 'description',
      },
      {
        id: 'is_active',
        header: 'Active',
        kind: 'badge',
        nowrap: true,
        // kind="active" — the same green / grey chip the operator and client
        // masters use for an Active flag, so the three cannot disagree.
        render: (row) => <StatusBadge kind="active" status={String(row.isActive)} />,
        sortFilterField: 'isActive',
        filterType: 'list',
        filterOptions: ACTIVE_OPTIONS,
      },
    ],
    [pendingIds],
  );

  return (
    <div>
      <ListHeader
        title="Machine Master"
        icon="⚙"
        count={list.isLoading ? undefined : total}
        noun="machine group"
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search group, description…"
        updating={list.isFetching && !list.isLoading}
        filters={
          <Select
            aria-label="Machine Group Status"
            title="Machine Group Status"
            value={status}
            options={[
              { value: 'all', label: `All (${fmtCount(allCount)})` },
              { value: 'active', label: `Active (${fmtCount(activeCount)})` },
              { value: 'inactive', label: `Inactive (${fmtCount(inactiveCount)})` },
            ]}
            onChange={(e) => {
              setStatus(e.target.value as StatusFilter);
              setPage(1);
            }}
          />
        }
        onClearFilters={() => {
          sf.clearFilters();
          setSearchInput('');
          setStatus('all');
          setPage(1);
        }}
        filtersActive={searchInput.trim() !== '' || status !== 'all' || sf.filtering}
        primary={
          canAdd ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                saveKey.rotate();
                setModal({ kind: 'new' });
              }}
            >
              <Plus size={14} /> Add Machine Group
            </button>
          ) : null
        }
      >
        {tabs}
      </ListHeader>

      {softDelete.isError ? (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div
            className="panel-body"
            style={{ padding: '10px 14px', fontSize: 12, color: 'var(--red2)' }}
          >
            {softDelete.error instanceof Error
              ? softDelete.error.message
              : 'Could not delete Machine Group. Try again.'}
          </div>
        </div>
      ) : null}

      {/* ADR-202 — neutral confirmation after a live-group edit was staged. */}
      {savedNotice ? (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div
            className="panel-body"
            style={{ padding: '10px 14px', fontSize: 12, color: 'var(--amber2)' }}
          >
            {savedNotice}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: 8, fontSize: 11 }}
              onClick={() => setSavedNotice(null)}
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

      {list.isError ? (
        <PageState
          state="error"
          message={
            list.error instanceof Error
              ? list.error.message
              : 'Could not load machine groups. Try again.'
          }
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.machineGroups}
            columns={columns}
            rows={rows}
            loading={list.isLoading}
            sortFilterServer={sf}
            emptyText={
              !term && status === 'all' && !sf.filtering
                ? 'No Machine Groups yet.'
                : 'No Machine Groups match.'
            }
            onRowClick={canEdit ? (row) => setModal({ kind: 'edit', row }) : undefined}
            rowActionsWidth="1%"
            rowMenu={(row) => [
              {
                key: 'edit',
                label: 'Edit',
                icon: 'pencil',
                hidden: !canEdit,
                onSelect: () => setModal({ kind: 'edit', row }),
              },
              {
                key: 'trash',
                label: 'Move to Trash',
                icon: 'trash-2',
                group: 'danger',
                hidden: !canDelete,
                disabledReason: softDelete.isPending ? 'Working…' : undefined,
                onSelect: () => {
                  // A failed earlier delete must not greet this one.
                  softDelete.reset();
                  setTrashRow(row);
                },
              },
            ]}
          />
        </Panel>
      )}

      <ListFooter
        total={total}
        noun="machine group"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={onPage}
      />

      {trashRow ? (
        <ConfirmDialog
          title={`Move Machine Group ${trashRow.code} to Trash?`}
          message="You can restore it from Trash."
          confirmLabel="Move to Trash"
          pendingLabel="Moving to Trash…"
          onConfirm={async () => {
            await softDelete.mutateAsync(trashRow.id);
            setTrashRow(null);
          }}
          onCancel={() => setTrashRow(null)}
          errorText={
            softDelete.isError
              ? softDelete.error instanceof Error
                ? softDelete.error.message
                : 'Could not delete Machine Group. Try again.'
              : null
          }
        />
      ) : null}

      {modal.kind !== 'none' ? (
        <MachineGroupModal
          {...(modal.kind === 'edit' ? { row: modal.row } : {})}
          saving={create.isPending || update.isPending}
          onSave={async (input, id) => {
            setSavedNotice(null);
            if (id) {
              // '' (not undefined) so clearing the box actually clears the
              // column. The group text itself is permanent — machines snapshot
              // it — so it is not part of the update.
              const result = await update.mutateAsync({
                id,
                input: { description: input.description ?? '', isActive: input.isActive },
              });
              // ADR-202 — gate on and this group is live: nothing changed, the
              // edit is now waiting for approval. The modal closes itself; show
              // the neutral notice after, and the row's "edit pending" chip.
              if (isStagedResult(result)) {
                setSavedNotice(
                  'Machine Group edit sent for approval — your change will apply once an approver signs off.',
                );
              }
            } else {
              await create.mutateAsync({
                code: input.code,
                isActive: input.isActive,
                ...(input.description ? { description: input.description } : {}),
              });
            }
          }}
          onClose={() => setModal({ kind: 'none' })}
        />
      ) : null}
    </div>
  );
}
