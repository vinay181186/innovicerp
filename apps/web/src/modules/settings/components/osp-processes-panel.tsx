// OSP Process Configuration panel — embedded inside Settings.
//
// Mirror of legacy Settings page block L13399–13408 (uses
// _renderOspConfig L13231 / _addOspProcess L13249).
// CRUD on `osp_processes`. Inline add modal. Manager/admin writes.

import type { OspProcess, OspProcessInput } from '@innovic/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useVendorsList } from '@/modules/vendors/api';

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
  autoPo: boolean;
  leadDays: number;
}

const emptyEdit: EditState = {
  id: null,
  processName: '',
  vendorId: '',
  autoPo: false,
  leadDays: 5,
};

export function OspProcessesPanel(): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const { data, isLoading, isError, error } = useOspProcesses();
  const { data: vendorsList } = useVendorsList(
    { limit: 200, offset: 0 },
    { enabled: canWrite },
  );
  const createMut = useCreateOsp();
  const updateMut = useUpdateOsp();
  const deleteMut = useDeleteOsp();

  const [modal, setModal] = useState<EditState | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
      autoPo: p.autoPo,
      leadDays: p.leadDays,
    });
  }

  async function save(): Promise<void> {
    if (!modal) return;
    setSubmitError(null);
    if (!modal.processName.trim()) {
      setSubmitError('Process name is required');
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
      setSubmitError(e instanceof Error ? e.message : 'Save failed');
    }
  }

  async function remove(p: OspProcess): Promise<void> {
    if (!window.confirm(`Remove OSP process "${p.processName}"?`)) return;
    try {
      await deleteMut.mutateAsync(p.id);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  const items = data?.items ?? [];

  return (
    <div className="panel mt-16">
      <div className="panel-hdr">
        <span className="panel-title">🏭 OSP Process Configuration</span>
      </div>
      <div className="panel-body">
        <p className="text2" style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 12 }}>
          Define outside processes (Coating, Painting, Heat Treatment, etc.). When an operator
          starts a JC operation matching these names, the system <b>auto-generates a JW PR</b> and
          optionally a <b>draft PO</b> if a vendor is configured.
        </p>

        {isLoading ? (
          <div className="empty-state">
            <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : isError ? (
          <div className="empty-state" style={{ color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load OSP processes'}
          </div>
        ) : items.length === 0 ? (
          <div className="text3" style={{ fontSize: 12, padding: '8px 0' }}>
            No OSP processes configured yet.
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Process Name</th>
                  <th>Preferred Vendor</th>
                  <th className="td-ctr">Auto PO?</th>
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
                        <span style={{ color: 'var(--green)', fontWeight: 700 }}>✅ Yes</span>
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
                            onClick={() => void remove(p)}
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
            style={{ width: 'min(560px, 96vw)', maxHeight: '84vh', overflow: 'auto' }}
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
                {modal.id ? '✎ Edit OSP Process' : '🏭 Add OSP Process'}
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
                <label className="form-label">Preferred Vendor (optional)</label>
                <select
                  className="innovic-select"
                  value={modal.vendorId}
                  onChange={(e) => setModal({ ...modal, vendorId: e.target.value })}
                >
                  <option value="">— Manual (no auto-PO)</option>
                  {(vendorsList?.vendors ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.code} — {v.name}
                    </option>
                  ))}
                </select>
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
                  <label className="form-label">Auto-create PO?</label>
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
                <div
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(239,68,68,0.06)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: 6,
                    color: 'var(--red)',
                    fontSize: 12,
                  }}
                >
                  {submitError}
                </div>
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
                    'Save'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
