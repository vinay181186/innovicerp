// OSP Process Configuration panel — embedded inside Settings.
//
// Mirror of legacy Settings page block L13399–13408 (uses
// _renderOspConfig L13231 / _addOspProcess L13249).
// CRUD on `osp_processes`. Inline add modal. Manager/admin writes.

import type { OspProcess, OspProcessInput } from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useVendorsList } from '@/modules/vendors/api';
import { Banner, ConfirmDialog } from '@/ui/feedback';

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

function useCreateOsp() {
  const qc = useQueryClient();
  return useMutation<OspProcess, Error, OspProcessInput>({
    mutationFn: (input) =>
      apiFetch<OspProcess>('/osp-processes', { method: 'POST', json: input }),
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
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const { data, isLoading, isError, error } = useOspProcesses();
  const [vendorSearch, setVendorSearch] = useState('');
  const { data: vendorsList, isFetching: vendorsLoading } = useVendorsList(
    { ...(vendorSearch.trim() ? { search: vendorSearch.trim() } : {}), limit: 50, offset: 0 },
    { enabled: canWrite },
  );
  const createMut = useCreateOsp();
  const updateMut = useUpdateOsp();
  const deleteMut = useDeleteOsp();

  const [modal, setModal] = useState<EditState | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<OspProcess | null>(null);

  function openCreate(): void {
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
    const input: OspProcessInput = {
      processName: modal.processName.trim(),
      vendorId: modal.vendorId ? modal.vendorId : null,
      autoPo: modal.autoPo,
      leadDays: modal.leadDays,
    };
    try {
      if (modal.id) await updateMut.mutateAsync({ id: modal.id, input });
      else await createMut.mutateAsync(input);
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
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-hdr">
        <span className="panel-title">OSP Process Configuration</span>
      </div>
      <div className="panel-body">
        <p className="text2" style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 12 }}>
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
          <div className="text3" style={{ fontSize: 12, padding: '8px 0' }}>
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
                  <th style={{ width: 110 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id}>
                    <td className="fw-700" style={{ color: 'var(--purple)' }}>{p.processName}</td>
                    <td style={{ fontSize: 11 }}>
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
                    <td className="text3" style={{ fontSize: 11 }}>{p.leadDays} days</td>
                    <td>
                      {canWrite ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => openEdit(p)}
                          >
                            ✎ Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => setRemoving(p)}
                            aria-label={`Delete ${p.processName}`}
                            title="Delete"
                          >
                            ✕
                          </button>
                        </div>
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
            <Plus size={12} /> Add OSP Process
          </button>
        ) : null}
      </div>

      {modal ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setModal(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.45)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: '8vh 16px',
            zIndex: 60,
          }}
        >
          <div
            className="panel"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(1100px, 96vw)', maxHeight: '84vh', overflow: 'auto' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div className="fw-700">
                {modal.id ? 'Edit OSP Process' : 'Add OSP Process'}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModal(null)}>
                <X size={14} />
              </button>
            </div>
            <div style={{ padding: 16, display: 'grid', gap: 12 }}>
              <div className="form-grp">
                <label className="form-label">
                  Process Name <span className="req">★</span>
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-grp">
                  <label className="form-label">Lead Time (days)</label>
                  <input
                    type="number"
                    className="innovic-input"
                    min={1}
                    max={365}
                    value={modal.leadDays}
                    onChange={(e) =>
                      setModal({ ...modal, leadDays: Number(e.target.value) || 5 })
                    }
                  />
                </div>
                <div className="form-grp">
                  <label className="form-label">Auto PO</label>
                  <select
                    className="innovic-select"
                    value={modal.autoPo ? '1' : '0'}
                    onChange={(e) =>
                      setModal({ ...modal, autoPo: e.target.value === '1' })
                    }
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
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setModal(null)}
                >
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
                  ) : (
                    modal.id ? 'Save Changes' : 'Save OSP Process'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {removing ? (
        <ConfirmDialog
          title={`Delete OSP process ${removing.processName}?`}
          message="It is removed from the OSP process list."
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
