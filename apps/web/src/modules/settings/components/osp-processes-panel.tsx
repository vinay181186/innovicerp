// OSP Process Configuration panel — embedded inside Settings.
//
// Mirror of legacy Settings page block L13399–13408 (uses
// _renderOspConfig L13231 / _addOspProcess L13249).
// CRUD on `osp_processes`. Inline add modal. Manager/admin writes.

import { Icon } from '@/ui/core';
import type { OspProcess, OspProcessInput } from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { SearchableSelect } from '@/ui/forms';
import { apiFetch } from '@/lib/api';
import { type SaveKey, useSaveKey, withSaveKey } from '@/lib/use-save-key';
import { canDeleteRecords, useMyAccess } from '@/lib/access-control';
import { useSession } from '@/lib/session';
import { useVendorsList } from '@/modules/vendors/api';
import { RowMenu } from '@/ui/data';
import { Banner, ConfirmDialog, Modal, useToast } from '@/ui/feedback';

interface ListOspProcessesResponse {
  items: OspProcess[];
}

const ospKey = ['osp-processes'] as const;

function useOspProcesses() {
  return useQuery<ListOspProcessesResponse>({
    queryKey: ospKey,
    queryFn: () => apiFetch<ListOspProcessesResponse>('/osp-processes'),
  });
}

function useCreateOsp(saveKey?: SaveKey) {
  const qc = useQueryClient();
  return useMutation<OspProcess, Error, OspProcessInput>({
    mutationFn: (input) =>
      withSaveKey(saveKey, (headers) =>
        apiFetch<OspProcess>('/osp-processes', {
          method: 'POST',
          json: input,
          ...(headers ? { headers } : {}),
        }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ospKey }),
  });
}

function useUpdateOsp() {
  const qc = useQueryClient();
  return useMutation<OspProcess, Error, { id: string; input: OspProcessInput }>({
    mutationFn: ({ id, input }) =>
      apiFetch<OspProcess>(`/osp-processes/${id}`, { method: 'PATCH', json: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ospKey }),
  });
}

function useDeleteOsp() {
  const qc = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (id) => {
      await apiFetch<null>(`/osp-processes/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ospKey }),
  });
}

interface EditState {
  id: string | null;
  processName: string;
  vendorId: string;
  /** "CODE — Name" of the picked vendor, so the picker shows it before a search. */
  vendorLabel: string;
  autoPo: boolean;
  leadDays: number;
}

const emptyEdit: EditState = {
  id: null,
  processName: '',
  vendorId: '',
  vendorLabel: '',
  autoPo: false,
  leadDays: 5,
};

export function OspProcessesPanel(): React.JSX.Element {
  const { data: me } = useSession();
  // Owner D3 (ADR-232): OSP process setup is a system panel — Super Admin only
  // (server: requireAdminRole on create / update, requireDeleteRight on delete).
  const canWrite = me?.role === 'admin';
  const { data: eff } = useMyAccess();
  const canDelete = canDeleteRecords(eff);
  const { data, isLoading, isError, error } = useOspProcesses();
  const [vendorSearch, setVendorSearch] = useState('');
  const { data: vendorsList, isFetching: vendorsLoading } = useVendorsList(
    { ...(vendorSearch.trim() ? { search: vendorSearch.trim() } : {}), limit: 50, offset: 0 },
    { enabled: canWrite },
  );
  // R2: one save key per Add-modal open — rotated in openCreate(), since the
  // modal is inline here rather than its own component.
  const toast = useToast();
  const saveKey = useSaveKey();
  const createMut = useCreateOsp(saveKey);
  const updateMut = useUpdateOsp();
  const deleteMut = useDeleteOsp();

  const [modal, setModal] = useState<EditState | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<OspProcess | null>(null);
  // Names that overlap the one being saved ("Plating" vs "Zinc Plating") —
  // asked about once before saving; see save().
  const [overlaps, setOverlaps] = useState<string[] | null>(null);

  function openCreate(): void {
    saveKey.rotate();
    setSubmitError(null);
    setModal({ ...emptyEdit });
  }

  function openEdit(p: OspProcess): void {
    setSubmitError(null);
    setModal({
      id: p.id,
      processName: p.processName,
      vendorId: p.vendorId ?? '',
      vendorLabel: p.vendorName ? `${p.vendorCode ? `${p.vendorCode} — ` : ''}${p.vendorName}` : '',
      autoPo: p.autoPo,
      leadDays: p.leadDays,
    });
  }

  async function save(): Promise<void> {
    if (!modal) return;
    setSubmitError(null);
    if (!modal.processName.trim()) {
      setSubmitError('Process Name is required.');
      return;
    }
    // An operation picks the process whose name is exactly its name, else the
    // LONGEST process name it contains. Overlapping names are allowed but
    // easy to get wrong, so warn before saving.
    const name = modal.processName.trim().toLowerCase();
    const clash = (data?.items ?? [])
      .filter((p) => p.id !== modal.id)
      .map((p) => p.processName)
      .filter((other) => {
        const o = other.trim().toLowerCase();
        return o !== name && (o.includes(name) || name.includes(o));
      });
    if (clash.length > 0) {
      setOverlaps(clash);
      return;
    }
    await saveNow();
  }

  async function saveNow(): Promise<void> {
    if (!modal) return;
    setSubmitError(null);
    const input: OspProcessInput = {
      processName: modal.processName.trim(),
      vendorId: modal.vendorId ? modal.vendorId : null,
      autoPo: modal.autoPo,
      leadDays: modal.leadDays,
    };
    try {
      if (modal.id) await updateMut.mutateAsync({ id: modal.id, input });
      else await createMut.mutateAsync(input);
      toast.ok(`OSP Process ${input.processName} saved`);
      setModal(null);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Could not save OSP process. Try again.');
    }
  }

  // Runs from the ConfirmDialog; a thrown error is shown inside the dialog.
  async function remove(p: OspProcess): Promise<void> {
    try {
      await deleteMut.mutateAsync(p.id);
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'Could not delete OSP process. Try again.');
    }
    setRemoving(null);
  }

  const items = data?.items ?? [];

  return (
    // Legacy `<div class="panel mt-16">` (L13399); .mt-16 (L268) is not in our theme.
    <div className="panel" style={{ marginTop: 'var(--sp-4)' }}>
      <div className="panel-hdr">
        <span className="panel-title">OSP Process Configuration</span>
      </div>
      <div className="panel-body">
        <p
          className="text2"
          style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.7, marginBottom: 'var(--sp-3)' }}
        >
          Outside processes. Starting one on a JC raises a JW PR.
        </p>

        {isLoading ? (
          <div className="empty-state">
            <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : isError ? (
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Could not load OSP processes. Try again.'}
          </div>
        ) : items.length === 0 ? (
          <div className="text3" style={{ fontSize: 'var(--fs-xs)', padding: 'var(--sp-2) 0' }}>
            No OSP processes yet.
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Process Name</th>
                  <th>Preferred Vendor</th>
                  <th className="td-ctr">Auto PO</th>
                  <th>Lead Time</th>
                  <th style={{ width: 48 }} aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td className="fw-700" style={{ color: 'var(--purple)' }}>
                      {p.processName}
                    </td>
                    <td style={{ fontSize: 'var(--fs-xs)' }}>
                      {p.vendorName ? (
                        <>
                          {p.vendorCode ? <span className="text3">{p.vendorCode} — </span> : null}
                          {p.vendorName}
                        </>
                      ) : (
                        <span className="text3">— Manual</span>
                      )}
                    </td>
                    <td className="td-ctr">
                      {p.vendorName && p.autoPo ? (
                        <span style={{ color: 'var(--green2)', fontWeight: 700 }}>Yes</span>
                      ) : (
                        <span className="text3">—</span>
                      )}
                    </td>
                    <td className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
                      {p.leadDays} days
                    </td>
                    <td>
                      {canWrite ? (
                        <RowMenu
                          label={`Actions for ${p.processName}`}
                          items={[
                            {
                              key: 'edit',
                              label: 'Edit',
                              icon: 'pencil',
                              onSelect: () => openEdit(p),
                            },
                            {
                              key: 'delete',
                              label: 'Delete',
                              icon: 'trash-2',
                              group: 'danger',
                              hidden: !canDelete,
                              onSelect: () => setRemoving(p),
                            },
                          ]}
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canWrite ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={openCreate}
            style={{ marginTop: 10 }}
          >
            <Icon name="plus" size={12} /> Add OSP Process
          </button>
        ) : null}
      </div>

      {modal ? (
        <Modal
          title={modal.id ? 'Edit OSP Process' : 'Add OSP Process'}
          onClose={() => setModal(null)}
          bodyStyle={{ display: 'grid', gap: 'var(--sp-3)' }}
          footer={
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={createMut.isPending || updateMut.isPending}
                onClick={() => void save()}
              >
                {createMut.isPending || updateMut.isPending ? (
                  <>
                    <Loader2 className="inline h-3 w-3 animate-spin" /> Saving…
                  </>
                ) : modal.id ? (
                  'Save Changes'
                ) : (
                  'Save OSP Process'
                )}
              </button>
            </>
          }
        >
          <div className="form-grp">
            <label className="form-label">
              Process Name<span className="req">★</span>
            </label>
            <input
              className="innovic-input"
              value={modal.processName}
              onChange={(e) => setModal({ ...modal, processName: e.target.value })}
              placeholder="e.g. Coating, Painting, Heat Treatment"
            />
          </div>
          <div className="form-grp">
            <label className="form-label" htmlFor="ospVendor">
              Preferred Vendor
            </label>
            <SearchableSelect
              id="ospVendor"
              value={modal.vendorId || null}
              onChange={(next) => {
                const v = (vendorsList?.vendors ?? []).find((x) => x.id === next);
                setModal({
                  ...modal,
                  vendorId: next ?? '',
                  vendorLabel: v ? `${v.code} — ${v.name}` : '',
                });
              }}
              onSearch={setVendorSearch}
              loading={vendorsLoading}
              options={(vendorsList?.vendors ?? []).map((v) => ({
                id: v.id,
                code: v.code,
                name: v.name,
              }))}
              placeholder="🔍 Type vendor code or name… (blank = manual PO)"
              valueLabel={modal.vendorLabel || undefined}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)' }}>
            <div className="form-grp">
              <label className="form-label">Lead Time (days)</label>
              <input
                type="number"
                className="innovic-input"
                min={1}
                max={365}
                value={modal.leadDays}
                onChange={(e) => setModal({ ...modal, leadDays: Number(e.target.value) || 5 })}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">Auto PO</label>
              <select
                className="innovic-select"
                value={modal.autoPo ? '1' : '0'}
                onChange={(e) => setModal({ ...modal, autoPo: e.target.value === '1' })}
                disabled={!modal.vendorId}
              >
                <option value="1">Yes (if vendor set)</option>
                <option value="0">No (manual PO)</option>
              </select>
            </div>
          </div>
          {submitError ? (
            <Banner tone="error" role="alert" flush>
              {submitError}
            </Banner>
          ) : null}
        </Modal>
      ) : null}

      {overlaps && modal ? (
        <ConfirmDialog
          tone="primary"
          title="Process names overlap"
          message={
            <>
              “{modal.processName.trim()}” overlaps {overlaps.map((o) => `“${o}”`).join(', ')}. An
              operation uses the process whose name matches it exactly, otherwise the longest
              process name it contains — check each operation will reach the right vendor.
            </>
          }
          confirmLabel="Save anyway"
          cancelLabel="Go back"
          onConfirm={async () => {
            setOverlaps(null);
            await saveNow();
          }}
          onCancel={() => setOverlaps(null)}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          title={`Delete OSP process ${removing.processName}?`}
          message=""
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          onConfirm={() => remove(removing)}
          onCancel={() => setRemoving(null)}
          elevated={false}
        />
      ) : null}
    </div>
  );
}
