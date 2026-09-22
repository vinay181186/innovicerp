// Machine Master → MACHINE GROUPS tab. The master the shop floor types once —
// VMC, CNC, Lathe — and then picks from on every machine.
//
// Visually this is the Raw Material Master panel (tbl-wrap + innovic-table, ONE
// StatStrip row for the counts which double as the Active/Inactive filter,
// clickable rows, scrolling list, inline New/Edit modal). It is a LOCAL copy
// rather than a reuse of <MaterialMasterPanel> because that panel is built for a
// two-field master (auto `code` + typed `name`) and hard-wires an Excel
// template/import pair. A machine group has ONE value — `code` IS the word the
// user types — and there is no bulk-import endpoint for it, so reusing the panel
// would mean shipping a dead Code column and two buttons that cannot work.
//
// Masters scroll, they do not paginate: one fetch of the whole master, no
// Prev/Next. MACHINE_GROUP_LIST_LIMIT is the cap the query schema allows.

import type { ListMachineGroupsQuery, MachineGroup } from '@innovic/shared';
import { Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import {
  MACHINE_GROUP_LIST_LIMIT,
  useCreateMachineGroup,
  useMachineGroupsList,
  useSoftDeleteMachineGroup,
  useUpdateMachineGroup,
} from '../api';

type ModalState = { kind: 'none' } | { kind: 'new' } | { kind: 'edit'; row: MachineGroup };
type StatusFilter = 'all' | 'active' | 'inactive';

export function MachineGroupTab(): React.JSX.Element {
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
  const create = useCreateMachineGroup();
  const update = useUpdateMachineGroup();
  const softDelete = useSoftDeleteMachineGroup();

  const [status, setStatus] = useState<StatusFilter>('all');
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });

  const rows = useMemo(() => list.data?.groups ?? [], [list.data]);
  const total = list.data?.total ?? 0;
  const activeCount = rows.filter((r) => r.isActive).length;
  const inactiveCount = rows.length - activeCount;
  const visible = useMemo(
    () =>
      status === 'all' ? rows : rows.filter((r) => (status === 'active' ? r.isActive : !r.isActive)),
    [rows, status],
  );

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          marginBottom: 12,
          gap: 8,
        }}
      >
        <input
          className="innovic-input"
          placeholder="🔍 Search group, description…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ width: 260, fontSize: 12 }}
        />
        {list.isFetching && !list.isLoading ? (
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
          </span>
        ) : null}
        {canAdd ? (
          <button type="button" className="btn btn-primary" onClick={() => setModal({ kind: 'new' })}>
            <Plus size={14} /> Add Machine Group
          </button>
        ) : null}
      </div>

      {/* Counts + the Active/Inactive filter in ONE strip (styling skill Rule 3). */}
      <div style={{ marginBottom: 12 }}>
        <StatStrip
          items={[
            {
              key: 'all',
              label: 'All Groups',
              count: rows.length,
              color: 'var(--cyan)',
              active: status === 'all',
              onClick: () => setStatus('all'),
            },
            {
              key: 'active',
              label: 'Active',
              count: activeCount,
              color: 'var(--green)',
              active: status === 'active',
              onClick: () => setStatus('active'),
            },
            {
              key: 'inactive',
              label: 'Inactive',
              count: inactiveCount,
              color: 'var(--amber)',
              active: status === 'inactive',
              onClick: () => setStatus('inactive'),
            },
          ]}
        />
      </div>

      {softDelete.isError ? (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-body" style={{ padding: '10px 14px', fontSize: 12, color: 'var(--red)' }}>
            {softDelete.error instanceof Error
              ? softDelete.error.message
              : 'Failed to delete machine group.'}
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Group</th>
                <th>Description</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.isLoading ? (
                <tr>
                  <td colSpan={4} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
                  </td>
                </tr>
              ) : list.isError ? (
                <tr>
                  <td colSpan={4} className="empty-state" style={{ color: 'var(--red)' }}>
                    {list.error instanceof Error
                      ? list.error.message
                      : 'Failed to load machine groups'}
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-state">
                    No machine groups — click <strong>+ Add Machine Group</strong> to begin
                  </td>
                </tr>
              ) : (
                visible.map((row) => (
                  <tr
                    key={row.id}
                    onClick={canEdit ? () => setModal({ kind: 'edit', row }) : undefined}
                    style={canEdit ? { cursor: 'pointer' } : undefined}
                  >
                    <td className="td-code" style={{ color: 'var(--cyan)' }}>
                      {row.code}
                    </td>
                    {/* Long free text — clip with an ellipsis, full value on hover. */}
                    <td className="text2" style={{ fontSize: 12 }}>
                      <span
                        style={{
                          maxWidth: 340,
                          display: 'inline-block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          verticalAlign: 'bottom',
                        }}
                        title={row.description ?? ''}
                      >
                        {row.description || '—'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${row.isActive ? 'b-green' : 'b-grey'}`}>
                        {row.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      {/* Stop once on the wrapper so an action never also fires
                          the row's own open-for-edit click. */}
                      <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                        {canEdit ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setModal({ kind: 'edit', row })}
                          >
                            Edit
                          </button>
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={softDelete.isPending}
                            onClick={() => {
                              if (confirm(`Move machine group "${row.code}" to Trash?`)) {
                                softDelete.mutate(row.id);
                              }
                            }}
                          >
                            Del
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Masters scroll, they do not paginate — one fetch, no Prev/Next. The
          count line says which of the two happened so a capped list can never
          look complete. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 6,
          gap: 12,
          fontSize: 11,
          color: 'var(--text3)',
        }}
      >
        <span>{canEdit ? '💡 Click a row to edit that group.' : ''}</span>
        <span>
          {total > rows.length
            ? `Showing first ${rows.length} of ${total} — refine with search`
            : `Showing all ${total} machine group${total === 1 ? '' : 's'}`}
        </span>
      </div>

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

interface MachineGroupSaveInput {
  code: string;
  description: string | null;
  isActive: boolean;
}

/** New/Edit modal — the same inline modal the Raw Material masters use, because
 *  this is one tabbed screen with no separate create/edit route. */
function MachineGroupModal({
  row,
  saving,
  onSave,
  onClose,
}: {
  row?: MachineGroup;
  saving: boolean;
  onSave: (input: MachineGroupSaveInput, id: string | null) => Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  const [code, setCode] = useState(row?.code ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [isActive, setIsActive] = useState(row?.isActive ?? true);
  const [err, setErr] = useState<string | null>(null);

  // Esc closes, matching every other modal on the app.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(): Promise<void> {
    setErr(null);
    if (!code.trim()) {
      setErr('Machine group is required.');
      return;
    }
    try {
      await onSave(
        { code: code.trim(), description: description.trim() || null, isActive },
        row?.id ?? null,
      );
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 100,
        padding: 24,
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        className="panel"
        style={{ width: 'min(620px, 96vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-hdr">
          <span className="panel-title">{row ? '✏ Edit Machine Group' : '＋ Add Machine Group'}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="form-grp form-full">
              <label className="form-label" htmlFor="mgCode">
                Machine Group <span className="req">★</span>
              </label>
              <input
                id="mgCode"
                className="innovic-input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. VMC"
                autoFocus={!row}
                // Permanent once created: machines and the screens that read
                // them snapshot this word. Retire a group with Status instead.
                readOnly={Boolean(row)}
              />
              {row ? (
                <div className="text3" style={{ fontSize: 10, marginTop: 3 }}>
                  The group name cannot be changed — machines already carry it. Set Status to
                  Inactive to retire it.
                </div>
              ) : null}
            </div>
            <div className="form-grp form-full">
              <label className="form-label" htmlFor="mgDescription">
                Description
              </label>
              <input
                id="mgDescription"
                className="innovic-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional note — what the group covers, which shop it runs in"
              />
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="mgStatus">
                Status
              </label>
              <select
                id="mgStatus"
                className="innovic-select"
                value={isActive ? 'active' : 'inactive'}
                onChange={(e) => setIsActive(e.target.value === 'active')}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          {err ? (
            <div role="alert" style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>
              {err}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
