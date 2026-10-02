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
// Masters scroll, they do not paginate: one fetch of the whole master, no
// Prev/Next. MACHINE_GROUP_LIST_LIMIT is the cap the query schema allows.

import type { ListMachineGroupsQuery, MachineGroup } from '@innovic/shared';
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useSaveKey } from '@/lib/use-save-key';
import { StatusBadge } from '@/ui/core';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ConfirmDialog } from '@/ui/feedback';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import {
  MACHINE_GROUP_LIST_LIMIT,
  useCreateMachineGroup,
  useMachineGroupsList,
  useSoftDeleteMachineGroup,
  useUpdateMachineGroup,
} from '../api';
import { MachineGroupModal } from './machine-group-modal';

type ModalState = { kind: 'none' } | { kind: 'new' } | { kind: 'edit'; row: MachineGroup };
type StatusFilter = 'all' | 'active' | 'inactive';

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
  const [searchInput, setSearchInput] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setTerm(searchInput.trim()), 300);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  // No isActive filter on the query — the whole master comes down once and the
  // Active/Inactive split happens here, so the strip shows all three numbers at
  // the same time.
  const query: ListMachineGroupsQuery = useMemo(
    () => ({ ...(term ? { search: term } : {}), limit: MACHINE_GROUP_LIST_LIMIT, offset: 0 }),
    [term],
  );
  const list = useMachineGroupsList(query);
  // R2: one save key per Add-modal open — rotated when the modal opens, since
  // the create hook lives here rather than in the modal.
  const saveKey = useSaveKey();
  const create = useCreateMachineGroup(saveKey);
  const update = useUpdateMachineGroup();
  const softDelete = useSoftDeleteMachineGroup();

  const [status, setStatus] = useState<StatusFilter>('all');
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  // The row waiting on the Move-to-Trash confirm (app ConfirmDialog, not window.confirm).
  const [trashRow, setTrashRow] = useState<MachineGroup | null>(null);

  const rows = useMemo(() => list.data?.groups ?? [], [list.data]);
  const total = list.data?.total ?? 0;
  const activeCount = rows.filter((r) => r.isActive).length;
  const inactiveCount = rows.length - activeCount;
  const visible = useMemo(
    () =>
      status === 'all'
        ? rows
        : rows.filter((r) => (status === 'active' ? r.isActive : !r.isActive)),
    [rows, status],
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
      },
      {
        id: 'description',
        header: 'Description',
        kind: 'text',
        align: 'left',
        className: 'text2',
        render: (row) => row.description || '—',
        title: (row) => row.description ?? '',
      },
      {
        id: 'is_active',
        header: 'Active',
        kind: 'badge',
        nowrap: true,
        // kind="active" — the same green / grey chip the operator and client
        // masters use for an Active flag, so the three cannot disagree.
        render: (row) => <StatusBadge kind="active" status={String(row.isActive)} />,
      },
    ],
    [],
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
              { value: 'all', label: `All (${rows.length})` },
              { value: 'active', label: `Active (${activeCount})` },
              { value: 'inactive', label: `Inactive (${inactiveCount})` },
            ]}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          />
        }
        onClearFilters={() => {
          setSearchInput('');
          setStatus('all');
        }}
        filtersActive={searchInput.trim() !== '' || status !== 'all'}
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
            rows={visible}
            loading={list.isLoading}
            emptyText={
              rows.length === 0 && !term ? 'No Machine Groups yet.' : 'No Machine Groups match.'
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

      {/* Masters scroll, they do not paginate — one fetch, no Prev/Next. The
          count line says which of the two happened so a capped list can never
          look complete. */}
      <ListFooter
        total={total}
        shown={visible.length}
        noun="machine group"
        limit={total > rows.length ? rows.length : undefined}
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
            if (id) {
              // '' (not undefined) so clearing the box actually clears the
              // column. The group text itself is permanent — machines snapshot
              // it — so it is not part of the update.
              await update.mutateAsync({
                id,
                input: { description: input.description ?? '', isActive: input.isActive },
              });
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
