// Report / Document Master (legacy renderReportMaster L23677) — folded in as the
// "Report Types" tab of QC Process Master. Master CRUD for report/document types
// used as QC document-requirement options in Planning. Self-contained: its own
// hooks + inline New/Edit modal. Backed by /report-types (0038).

import { REPORT_TYPE_STATUSES, type CreateReportTypeInput, type ReportType } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSession } from '@/lib/session';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { PageState } from '@/ui/layout';
import {
  useCreateReportType,
  useDeleteReportType,
  useReportTypes,
  useUpdateReportType,
} from '../api';

type ModalState = { kind: 'none' } | { kind: 'new' } | { kind: 'edit'; row: ReportType };

export function ReportTypesPanel(): React.JSX.Element {
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

  // The sheet's columns (first = the Report / Document Name, always pinned).
  // Default requirement and Active both show as badges; Description shares the
  // spare width and clips with "…" + tooltip. Sr No is dropped — the name is
  // the identity, and the fit table pins it as column 0.
  const columns = useMemo<DataTableColumn<ReportType>[]>(
    () => [
      {
        id: 'name',
        header: 'Report / Document Name',
        kind: 'code',
        nowrap: true,
        className: 'fw-700',
        render: (row) => <span style={{ color: 'var(--purple)' }}>{row.name}</span>,
      },
      {
        id: 'description',
        header: 'Description',
        kind: 'text',
        align: 'left',
        className: 'text2',
        render: (row) => row.description ?? '—',
        title: (row) => row.description ?? '',
      },
      {
        id: 'default',
        header: 'Default',
        kind: 'badge',
        nowrap: true,
        render: (row) => (
          <span className={`badge ${row.defaultMandatory ? 'b-red' : 'b-blue'}`}>
            {row.defaultMandatory ? '★ Mandatory' : 'Optional'}
          </span>
        ),
      },
      {
        id: 'status',
        header: 'Active',
        kind: 'badge',
        nowrap: true,
        render: (row) => (
          <span className={`badge ${row.status === 'Active' ? 'b-green' : 'b-amber'}`}>
            {row.status}
          </span>
        ),
      },
    ],
    [],
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
        {isFetching && !isLoading ? (
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            <Loader2 className="inline h-3 w-3 animate-spin" />
          </span>
        ) : null}
        {canWrite ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setModal({ kind: 'new' })}
          >
            + Add Report Type
          </button>
        ) : null}
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="panel-body" style={{ padding: '10px 14px' }}>
          <span className="text2" style={{ fontSize: 12 }}>
            💡 Define report/document types here. These will appear as options when adding QC
            document requirements in SO/JW Planning.
          </span>
        </div>
      </div>

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load report types. Try again.'
          }
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.reportTypes}
            columns={columns}
            rows={items}
            loading={isLoading}
            rowActionsWidth="1%"
            emptyText="No report types defined. Click + Add Report Type."
            rowMenu={(row) => [
              {
                key: 'edit',
                label: 'Edit',
                icon: 'pencil',
                hidden: !canWrite,
                onSelect: () => setModal({ kind: 'edit', row }),
              },
              {
                key: 'delete',
                label: 'Delete',
                icon: 'trash-2',
                group: 'danger',
                hidden: !canWrite,
                // As before: no second delete while one is saving.
                disabledReason: del.isPending ? 'Deleting…' : undefined,
                onSelect: () => onDelete(row),
              },
            ]}
          />
        </Panel>
      )}

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
  const [status, setStatus] = useState<(typeof REPORT_TYPE_STATUSES)[number]>(
    row?.status ?? 'Active',
  );
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
      setErr(e instanceof Error ? e.message : 'Could not save report type. Try again.');
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
              <label className="form-label">Active</label>
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
            <div role="alert" style={{ color: 'var(--red2)', fontSize: 12, marginTop: 8 }}>
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
              disabled={pending}
              onClick={() => void submit()}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
