// Design Tracker (Design slice B) — per-SO design assignment.
// Mirrors legacy renderDesignTracker (HTML L7259) + helpers L7338–7489.

import {
  type CreateDesignTrackerInput,
  type DesignTrackerListItem,
  type LogDesignTimeInput,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSalesOrdersList } from '../../sales-orders/api';
import {
  useApproveDesign,
  useCreateDesignTracker,
  useDesignTrackerDetail,
  useDesignTrackerList,
  useLogDesignTime,
  useNextDesignTrackerCode,
  useReviseDesign,
  useSubmitDesignReview,
  useUpdateDesignTracker,
} from '../api';

type FilterKey = 'all' | 'pending' | 'progress' | 'review' | 'approved' | 'overdue';

const PAGE_SIZE = 100;

export const designTrackerListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'design-tracker',
  component: DesignTrackerListPage,
});

function DesignTrackerListPage(): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [editRow, setEditRow] = useState<DesignTrackerListItem | null>(null);
  const [logTimeRow, setLogTimeRow] = useState<DesignTrackerListItem | null>(null);

  const { data, isLoading, isError, error } = useDesignTrackerList({
    search: search.trim() || undefined,
    filter,
    limit: PAGE_SIZE,
    offset: 0,
  });
  const summary = data?.summary ?? {
    total: 0,
    pending: 0,
    inProgress: 0,
    review: 0,
    approved: 0,
    overdue: 0,
  };

  return (
    <div>
      <KpiStrip summary={summary} onChange={setFilter} />

      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="section-hdr m-0">🎨 Design Tracker</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 'auto', minWidth: 160, fontSize: 12 }}
          />
          <select
            className="innovic-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterKey)}
            style={{ width: 'auto', fontSize: 12 }}
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="progress">In Progress</option>
            <option value="review">Review</option>
            <option value="approved">Approved</option>
            <option value="overdue">Overdue</option>
          </select>
          {canWrite ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowAdd(true)}
            >
              + Assign Design
            </button>
          ) : null}
        </div>
      </div>

      <div className="panel">
        {isLoading ? (
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          </div>
        ) : isError ? (
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load designs'}
            </div>
          </div>
        ) : data ? (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Design No.</th>
                  <th>SO</th>
                  <th>Item</th>
                  <th>Designer</th>
                  <th>Start</th>
                  <th>Target</th>
                  <th>Status</th>
                  <th className="td-ctr">Rev</th>
                  <th className="td-ctr">Hours</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="empty-state">
                      No designs assigned yet
                    </td>
                  </tr>
                ) : (
                  data.items.map((d) => (
                    <Row
                      key={d.id}
                      row={d}
                      canWrite={canWrite}
                      isAdmin={canWrite}
                      onEdit={() => setEditRow(d)}
                      onLogTime={() => setLogTimeRow(d)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="text3" style={{ fontSize: 11, marginTop: 6 }}>
        🎨 Design Tracker manages engineering design lifecycle. BOM creation is blocked until design
        is Approved for Equipment SOs.
      </div>

      {showAdd ? <AddDesignModal onClose={() => setShowAdd(false)} /> : null}
      {editRow ? <EditDesignModal row={editRow} onClose={() => setEditRow(null)} /> : null}
      {logTimeRow ? <LogTimeModal row={logTimeRow} onClose={() => setLogTimeRow(null)} /> : null}
    </div>
  );
}

function KpiStrip({
  summary,
  onChange,
}: {
  summary: { total: number; pending: number; inProgress: number; review: number; approved: number; overdue: number };
  onChange: (k: FilterKey) => void;
}): React.JSX.Element {
  // Legacy L7307–7314: plain --bg2 tiles, 1px --border, radius 10, no top accent
  // and no active-tile styling. The Overdue tile is the only tinted one and is
  // rendered only when overdue > 0.
  const tiles: Array<{
    k: FilterKey;
    label: string;
    value: number;
    color: string;
    labelColor: string;
    background: string;
    border: string;
    show: boolean;
  }> = [
    {
      k: 'all',
      label: 'Total',
      value: summary.total,
      color: 'var(--blue)',
      labelColor: 'var(--text3)',
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      show: true,
    },
    {
      k: 'pending',
      label: 'Pending',
      value: summary.pending,
      color: 'var(--text3)',
      labelColor: 'var(--text3)',
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      show: true,
    },
    {
      k: 'progress',
      label: 'In Progress',
      value: summary.inProgress,
      color: 'var(--amber)',
      labelColor: 'var(--text3)',
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      show: true,
    },
    {
      k: 'review',
      label: 'Review',
      value: summary.review,
      color: 'var(--blue)',
      labelColor: 'var(--text3)',
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      show: true,
    },
    {
      k: 'approved',
      label: 'Approved',
      value: summary.approved,
      color: 'var(--green)',
      labelColor: 'var(--text3)',
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      show: true,
    },
    {
      k: 'overdue',
      label: 'Overdue',
      value: summary.overdue,
      color: 'var(--red)',
      labelColor: 'var(--red)',
      background: 'rgba(239,68,68,0.06)',
      border: '1px solid rgba(239,68,68,0.3)',
      show: summary.overdue > 0,
    },
  ];
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
        gap: 10,
        marginBottom: 16,
      }}
    >
      {tiles
        .filter((t) => t.show)
        .map((t) => (
          <div
            key={t.k}
            onClick={() => onChange(t.k)}
            style={{
              cursor: 'pointer',
              textAlign: 'center',
              padding: 12,
              borderRadius: 10,
              background: t.background,
              border: t.border,
            }}
          >
            <div style={{ fontSize: 10, color: t.labelColor }}>{t.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: t.color }}>{t.value}</div>
          </div>
        ))}
    </div>
  );
}

function Row({
  row,
  canWrite,
  isAdmin,
  onEdit,
  onLogTime,
}: {
  row: DesignTrackerListItem;
  canWrite: boolean;
  isAdmin: boolean;
  onEdit: () => void;
  onLogTime: () => void;
}): React.JSX.Element {
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = row.targetDate < today && row.status !== 'Approved';
  const stColor =
    row.status === 'Pending'
      ? 'var(--text3)'
      : row.status === 'In Progress'
        ? 'var(--amber)'
        : row.status === 'Review'
          ? 'var(--blue)'
          : row.status === 'Approved'
            ? 'var(--green)'
            : 'var(--purple)';
  const stBg =
    row.status === 'Pending'
      ? 'rgba(100,116,139,0.10)'
      : row.status === 'In Progress'
        ? 'rgba(245,158,11,0.10)'
        : row.status === 'Review'
          ? 'rgba(37,99,235,0.10)'
          : row.status === 'Approved'
            ? 'rgba(34,197,94,0.10)'
            : 'rgba(139,92,246,0.10)';

  const submitMut = useSubmitDesignReview();
  const approveMut = useApproveDesign();
  const reviseMut = useReviseDesign();

  const hrsOver = row.totalHours > row.estimatedHours;
  return (
    <tr style={{ background: isOverdue ? 'rgba(239,68,68,0.03)' : 'var(--bg)' }}>
      {/* `td-code` stays on the span: our `.innovic-table td` (0,1,1) outranks the
          bare `.td-code` (0,1,0) and would force its font-size back to 13px, where
          legacy's bare `td` (0,0,1) loses to `.td-code` and renders 12px. See ISSUE-060. */}
      <td>
        <span className="td-code" style={{ color: 'var(--purple)' }}>
          {row.code}
        </span>
      </td>
      <td>
        <span className="td-code" style={{ color: 'var(--cyan)' }}>
          {row.soCodeText ?? '—'}
        </span>
      </td>
      <td style={{ fontSize: 11 }}>
        <span style={{ color: 'var(--purple)', fontWeight: 600 }}>{row.itemCodeText ?? ''}</span>
        <br />
        {row.itemNameText ?? ''}
      </td>
      <td style={{ fontSize: 12 }}>{row.designer || '—'}</td>
      <td className="text2" style={{ fontSize: 11 }}>
        {row.startDate}
      </td>
      <td
        className="text2"
        style={{ fontSize: 11, color: isOverdue ? 'var(--red)' : undefined }}
      >
        {row.targetDate}
      </td>
      <td>
        <span
          style={{
            background: stBg,
            color: stColor,
            padding: '2px 10px',
            borderRadius: 10,
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          {row.status}
        </span>
      </td>
      <td className="td-ctr mono fw-700">Rev {row.revision}</td>
      <td className="td-ctr">
        <span
          className="mono fw-700"
          style={{ color: hrsOver ? 'var(--red)' : 'var(--green)' }}
        >
          {row.totalHours}
        </span>
        <span style={{ color: 'var(--text3)', fontSize: 10 }}> / {row.estimatedHours}h</span>
      </td>
      <td>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 10 }}
            onClick={onLogTime}
          >
            ⏱ Log
          </button>
          {canWrite && row.status !== 'Approved' ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 10 }}
              onClick={onEdit}
            >
              ✏ Edit
            </button>
          ) : null}
          {canWrite && row.status === 'In Progress' ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 10, color: 'var(--blue)' }}
              disabled={submitMut.isPending}
              onClick={() => {
                if (window.confirm(`Submit ${row.code} for design review?`)) submitMut.mutate(row.id);
              }}
            >
              ✔ Submit
            </button>
          ) : null}
          {isAdmin && row.status === 'Review' ? (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 10, color: 'var(--green)' }}
                disabled={approveMut.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Approve design ${row.code}?\nThis will unlock BOM creation for SO: ${row.soCodeText ?? ''}`,
                    )
                  )
                    approveMut.mutate(row.id);
                }}
              >
                ✅ Approve
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 10, color: 'var(--red)' }}
                disabled={reviseMut.isPending}
                onClick={() => {
                  const reason = window.prompt('Revision reason:');
                  if (reason && reason.trim()) {
                    reviseMut.mutate({ id: row.id, input: { reason: reason.trim() } });
                  }
                }}
              >
                ↩ Revise
              </button>
            </>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

// ─── Add modal ────────────────────────────────────────────────────────────

function AddDesignModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [date] = useState(new Date().toISOString().slice(0, 10));
  const [soSearch, setSoSearch] = useState('');
  const [soId, setSoId] = useState<string | null>(null);
  const [designer, setDesigner] = useState('');
  const [estHours, setEstHours] = useState('');
  const [startDate, setStartDate] = useState(date);
  const [targetDate, setTargetDate] = useState('');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const { data: soData } = useSalesOrdersList({
    search: soSearch.trim() || undefined,
    status: 'open',
    limit: 50,
    offset: 0,
  });
  const selectedSo = useMemo(
    () => soData?.items.find((s) => s.id === soId) ?? null,
    [soData, soId],
  );

  const mut = useCreateDesignTracker();
  const { data: next } = useNextDesignTrackerCode();

  const onSave = (): void => {
    setErr(null);
    if (!soId) {
      setErr('Select an SO');
      return;
    }
    if (!designer.trim()) {
      setErr('Enter designer name');
      return;
    }
    if (!targetDate) {
      setErr('Set target date');
      return;
    }
    const input: CreateDesignTrackerInput = {
      salesOrderId: soId,
      designer: designer.trim(),
      startDate,
      targetDate,
    };
    if (estHours.trim()) input.estimatedHours = Number(estHours);
    if (remarks.trim()) input.remarks = remarks.trim();
    mut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) => setErr(e instanceof Error ? e.message : 'Failed'),
    });
  };

  return (
    <ModalShell onClose={onClose} title="🎨 Assign Design">
      <div className="form-grid">
        <Field label="Design No.">
          <input
            type="text"
            className="innovic-input"
            value={next?.code ?? '(auto on save)'}
            readOnly
            style={{ color: 'var(--purple)', fontWeight: 700 }}
          />
        </Field>
        <Field label="Sales Order" req full>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Type SO code or customer…"
            value={
              selectedSo
                ? `${selectedSo.code} — ${selectedSo.customerName ?? ''}`
                : soSearch
            }
            onChange={(e) => {
              setSoId(null);
              setSoSearch(e.target.value);
            }}
          />
          {!soId && soSearch && soData ? (
            <Picklist
              items={soData.items.slice(0, 20).map((s) => ({
                id: s.id,
                label: `${s.code} — ${s.customerName ?? ''}`,
                sub: s.type ?? null,
              }))}
              onPick={(id) => {
                setSoId(id);
                setSoSearch('');
              }}
            />
          ) : null}
        </Field>
        <Field label="Designer" req>
          <input
            type="text"
            className="innovic-input"
            value={designer}
            onChange={(e) => setDesigner(e.target.value)}
            placeholder="Engineer name"
          />
        </Field>
        <Field label="Estimated Hours">
          <input
            type="number"
            min={0}
            className="innovic-input"
            value={estHours}
            onChange={(e) => setEstHours(e.target.value)}
            placeholder="e.g. 40"
          />
        </Field>
        <Field label="Start Date">
          <input
            type="date"
            className="innovic-input"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Field>
        <Field label="Target Date" req>
          <input
            type="date"
            className="innovic-input"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </Field>
        <Field label="Design Scope / Remarks" full>
          <input
            type="text"
            className="innovic-input"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="What needs to be designed..."
          />
        </Field>
      </div>
      {err ? <ErrorBox message={err} /> : null}
      <Actions onClose={onClose} onSave={onSave} saving={mut.isPending} label="Save" />
    </ModalShell>
  );
}

// ─── Edit modal ───────────────────────────────────────────────────────────

function EditDesignModal({
  row,
  onClose,
}: {
  row: DesignTrackerListItem;
  onClose: () => void;
}): React.JSX.Element {
  const [designer, setDesigner] = useState(row.designer);
  const [status, setStatus] = useState(row.status);
  const [estHours, setEstHours] = useState(String(row.estimatedHours));
  const [targetDate, setTargetDate] = useState(row.targetDate);
  const [remarks, setRemarks] = useState(row.remarks ?? '');
  const [err, setErr] = useState<string | null>(null);
  const mut = useUpdateDesignTracker();

  const onSave = (): void => {
    setErr(null);
    mut.mutate(
      {
        id: row.id,
        input: {
          designer: designer.trim() || undefined,
          status,
          estimatedHours: estHours.trim() ? Number(estHours) : undefined,
          targetDate,
          remarks,
        },
      },
      {
        onSuccess: () => onClose(),
        onError: (e) => setErr(e instanceof Error ? e.message : 'Failed'),
      },
    );
  };

  return (
    <ModalShell onClose={onClose} title={`✏ Edit Design — ${row.code}`}>
      <div className="form-grid">
        <Field label="SO">
          <input
            type="text"
            className="innovic-input"
            value={row.soCodeText ?? ''}
            readOnly
            style={{ color: 'var(--cyan)', fontWeight: 700 }}
          />
        </Field>
        <Field label="Item">
          <input
            type="text"
            className="innovic-input"
            value={row.itemCodeText ?? ''}
            readOnly
            style={{ color: 'var(--purple)' }}
          />
        </Field>
        <Field label="Designer">
          <input
            type="text"
            className="innovic-input"
            value={designer}
            onChange={(e) => setDesigner(e.target.value)}
          />
        </Field>
        <Field label="Status">
          <select
            className="innovic-select"
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as DesignTrackerListItem['status'])
            }
          >
            <option>Pending</option>
            <option>In Progress</option>
            <option>Review</option>
            <option>Approved</option>
            <option>Revision</option>
          </select>
        </Field>
        <Field label="Estimated Hours">
          <input
            type="number"
            min={0}
            className="innovic-input"
            value={estHours}
            onChange={(e) => setEstHours(e.target.value)}
          />
        </Field>
        <Field label="Target Date">
          <input
            type="date"
            className="innovic-input"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </Field>
        <Field label="Remarks" full>
          <input
            type="text"
            className="innovic-input"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </Field>
      </div>
      {err ? <ErrorBox message={err} /> : null}
      <Actions onClose={onClose} onSave={onSave} saving={mut.isPending} label="Save" />
    </ModalShell>
  );
}

// ─── Log time modal ───────────────────────────────────────────────────────

function LogTimeModal({
  row,
  onClose,
}: {
  row: DesignTrackerListItem;
  onClose: () => void;
}): React.JSX.Element {
  const [logDate, setLogDate] = useState(new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState('');
  const [worker, setWorker] = useState(row.designer);
  const [description, setDescription] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const mut = useLogDesignTime();

  const { data: detail } = useDesignTrackerDetail(row.id);
  const previous = detail?.timeLog ?? [];

  const onSave = (): void => {
    setErr(null);
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) {
      setErr('Enter hours');
      return;
    }
    if (!worker.trim()) {
      setErr('Enter worker');
      return;
    }
    const input: LogDesignTimeInput = {
      logDate,
      hours: h,
      workerText: worker.trim(),
    };
    if (description.trim()) input.description = description.trim();
    mut.mutate(
      { id: row.id, input },
      {
        onSuccess: () => onClose(),
        onError: (e) => setErr(e instanceof Error ? e.message : 'Failed'),
      },
    );
  };

  return (
    <ModalShell
      onClose={onClose}
      title={`⏱ Time Log — ${row.code} (${row.totalHours}h / ${row.estimatedHours}h)`}
    >
      <div
        style={{
          marginBottom: 14,
          padding: 10,
          background: 'var(--bg3)',
          borderRadius: 8,
          border: '1px solid var(--border)',
          fontSize: 12,
        }}
      >
        <b style={{ color: 'var(--cyan)' }}>{row.soCodeText ?? '—'}</b> | {row.itemCodeText ?? ''} |
        Designer: <b>{row.designer}</b>
      </div>
      <div className="form-grid">
        <Field label="Date">
          <input
            type="date"
            className="innovic-input"
            value={logDate}
            onChange={(e) => setLogDate(e.target.value)}
          />
        </Field>
        <Field label="Hours Worked">
          <input
            type="number"
            min={0.5}
            step={0.5}
            className="innovic-input"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="e.g. 4"
          />
        </Field>
        <Field label="Worker">
          <input
            type="text"
            className="innovic-input"
            value={worker}
            onChange={(e) => setWorker(e.target.value)}
          />
        </Field>
        <Field label="Description">
          <input
            type="text"
            className="innovic-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What was done..."
          />
        </Field>
      </div>

      {previous.length > 0 ? (
        <>
          <div
            style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: 'var(--text3)' }}
          >
            Previous Entries
          </div>
          <div className="tbl-wrap" style={{ maxHeight: 200, overflowY: 'auto' }}>
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Hours</th>
                  <th>Worker</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {previous.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontSize: 11 }}>{t.logDate}</td>
                    <td className="mono fw-700" style={{ color: 'var(--green)' }}>
                      {t.hours}h
                    </td>
                    <td style={{ fontSize: 11 }}>{t.workerText}</td>
                    <td style={{ fontSize: 11, color: 'var(--text3)' }}>
                      {t.description ?? ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {err ? <ErrorBox message={err} /> : null}
      <Actions onClose={onClose} onSave={onSave} saving={mut.isPending} label="Log Time" />
    </ModalShell>
  );
}

// ─── Shared bits ──────────────────────────────────────────────────────────

function ModalShell({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          width: 'min(1100px, 96vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}

function Actions({
  onClose,
  onSave,
  saving,
  label,
}: {
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  label: string;
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
      <button type="button" className="btn btn-primary" disabled={saving} onClick={onSave}>
        {saving ? (
          <>
            <Loader2 size={14} className="inline animate-spin" /> Saving…
          </>
        ) : (
          label
        )}
      </button>
    </div>
  );
}

function Field({
  label,
  req,
  full,
  children,
}: {
  label: string;
  req?: boolean;
  full?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={full ? 'form-grp form-full' : 'form-grp'}>
      <label className="form-label">
        {label}
        {req ? <span className="req">★</span> : null}
      </label>
      {children}
    </div>
  );
}

function Picklist({
  items,
  onPick,
}: {
  items: Array<{ id: string; label: string; sub: string | null }>;
  onPick: (id: string) => void;
}): React.JSX.Element {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 4,
        background: 'var(--bg2)',
        marginTop: 4,
        maxHeight: 180,
        overflowY: 'auto',
      }}
    >
      {items.map((it) => (
        <div
          key={it.id}
          onClick={() => onPick(it.id)}
          style={{
            padding: '6px 10px',
            cursor: 'pointer',
            fontSize: 12,
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{it.label}</span>
          {it.sub ? (
            <span style={{ color: 'var(--text3)', marginLeft: 6 }}>· {it.sub}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ErrorBox({ message }: { message: string }): React.JSX.Element {
  return (
    <div
      style={{
        marginTop: 12,
        padding: 8,
        background: 'rgba(239,68,68,0.08)',
        color: 'var(--red)',
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      {message}
    </div>
  );
}
