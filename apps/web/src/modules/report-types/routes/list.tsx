// Report / Document Master (legacy renderReportMaster L23677). Master CRUD for
// report/document types used as QC document-requirement options in Planning.
// Legacy chrome + inline New/Edit modal. Backed by /report-types (0038).

import {
  REPORT_TYPE_STATUSES,
  type CreateReportTypeInput,
  type ReportType,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  useCreateReportType,
  useDeleteReportType,
  useReportTypes,
  useUpdateReportType,
} from '../api';

export const reportTypesListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'report-master',
  component: ReportMasterPage,
});

type ModalState = { kind: 'none' } | { kind: 'new' } | { kind: 'edit'; row: ReportType };

function ReportMasterPage(): React.JSX.Element {
  const { data, isLoading, isFetching, isError, error } = useReportTypes();
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager' || me?.role === 'qc';
  const del = useDeleteReportType();
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const items = data?.items ?? [];

  async function onDelete(row: ReportType): Promise<void> {
    if (!window.confirm(`Delete report type "${row.name}"?`)) return;
    await del.mutateAsync(row.id);
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          📄 Report / Document Master
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isFetching && !isLoading ? (
            <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
              <Loader2 className="inline h-3 w-3 animate-spin" />
            </span>
          ) : null}
          {canWrite ? (
            <button type="button" className="btn btn-primary" onClick={() => setModal({ kind: 'new' })}>
              + Add Report Type
            </button>
          ) : null}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body" style={{ padding: '10px 14px' }}>
          <span className="text2" style={{ fontSize: 12 }}>
            💡 Define report/document types here. These will appear as options when adding QC
            document requirements in SO/JW Planning.
          </span>
        </div>
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Report / Document Name</th>
                <th>Description</th>
                <th>Default</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={6} className="empty-state" style={{ color: 'var(--red)' }}>
                    {error instanceof Error ? error.message : 'Failed to load report types'}
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    No report types defined. Click + Add Report Type.
                  </td>
                </tr>
              ) : (
                items.map((r, i) => (
                  <tr key={r.id}>
                    <td className="td-ctr mono fw-700">{i + 1}</td>
                    <td className="fw-700" style={{ color: 'var(--purple)' }}>
                      {r.name}
                    </td>
                    <td className="text2" style={{ fontSize: 11 }}>
                      {r.description ?? '—'}
                    </td>
                    <td>
                      <span className={`badge ${r.defaultMandatory ? 'b-red' : 'b-blue'}`}>
                        {r.defaultMandatory ? '★ Mandatory' : 'Optional'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${r.status === 'Active' ? 'b-green' : 'b-amber'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {canWrite ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setModal({ kind: 'edit', row: r })}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              disabled={del.isPending}
                              onClick={() => void onDelete(r)}
                            >
                              Del
                            </button>
                          </>
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

      {modal.kind !== 'none' ? (
        <ReportTypeModal
          {...(modal.kind === 'edit' ? { row: modal.row } : {})}
          onClose={() => setModal({ kind: 'none' })}
        />
      ) : null}
    </div>
  );
}

function ReportTypeModal(props: { row?: ReportType; onClose: () => void }): React.JSX.Element {
  const { row, onClose } = props;
  const create = useCreateReportType();
  const update = useUpdateReportType();
  const [name, setName] = useState(row?.name ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [defaultMandatory, setDefaultMandatory] = useState(row?.defaultMandatory ?? false);
  const [status, setStatus] = useState<(typeof REPORT_TYPE_STATUSES)[number]>(row?.status ?? 'Active');
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setErr(null);
    if (!name.trim()) {
      setErr('Name is required.');
      return;
    }
    const input: CreateReportTypeInput = {
      name: name.trim(),
      defaultMandatory,
      status,
      ...(description.trim() ? { description: description.trim() } : {}),
    };
    try {
      if (row) await update.mutateAsync({ id: row.id, input });
      else await create.mutateAsync(input);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    }
  }

  const pending = create.isPending || update.isPending;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 50,
        padding: 24,
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        className="panel"
        style={{ width: 'min(1100px, 96vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-hdr">
          <span className="panel-title">{row ? '✏ Edit Report Type' : '📄 Add Report Type'}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="form-grp form-full">
              <label className="form-label">
                Report / Document Name <span className="req">★</span>
              </label>
              <input
                className="innovic-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Dimensional Inspection Report"
                autoFocus
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label">Description</label>
              <input
                className="innovic-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of when this document is needed"
              />
            </div>
            <div className="form-grp">
              <label className="form-label">Default Requirement</label>
              <select
                className="innovic-select"
                value={defaultMandatory ? 'mandatory' : 'optional'}
                onChange={(e) => setDefaultMandatory(e.target.value === 'mandatory')}
              >
                <option value="mandatory">★ Mandatory</option>
                <option value="optional">Optional</option>
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label">Status</label>
              <select
                className="innovic-select"
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
              >
                {REPORT_TYPE_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
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
            <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void submit()}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
