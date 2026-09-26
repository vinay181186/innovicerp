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
import { z } from 'zod';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate, todayIst } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { ConfirmDialog } from '@/ui/feedback';
import { useSalesOrdersList } from '../../sales-orders/api';
import { soTypeLabel } from '../../sales-orders/lib/so-status-label';
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

// Deep-link seed for Global Search (no detail page here): `?search=DT-0012`
// pre-fills the search box. Read ONCE (lazy useState); typing stays local.
const searchSchema = z.object({
  search: z.string().optional(),
});

export const designTrackerListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'design-tracker',
  validateSearch: (search) => searchSchema.parse(search),
  component: DesignTrackerListPage,
});

function DesignTrackerListPage(): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'design_create');
  const routeSearch = designTrackerListRoute.useSearch();
  const [search, setSearch] = useState(() => routeSearch.search ?? '');
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

  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Design Tracker. Ask an admin.
      </div>
    );
  }

  return (
    <div>
      <KpiStrip summary={summary} filter={filter} onChange={setFilter} />

      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="section-hdr m-0">Design Tracker</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 'auto', minWidth: 160, fontSize: 12 }}
          />
          {perms.entry ? (
            <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
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
            <div className="empty-state" style={{ color: 'var(--red2)' }}>
              {error instanceof Error ? error.message : 'Could not load designs. Try again.'}
            </div>
          </div>
        ) : data ? (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Design No.</th>
                  <th>SO No.</th>
                  {/* POL — the CUSTOMER's own purchase-order line number off the
                      SO line behind this design. Nothing to do with the "Rev"
                      column further right, which counts OUR design revisions. */}
                  <th style={{ color: 'var(--purple)' }}>POL</th>
                  <th>Item Code</th>
                  <th>Design Engineer</th>
                  <th>Start Date</th>
                  <th>Target Date</th>
                  <th>Design Status</th>
                  <th className="td-ctr">Design Rev</th>
                  <th className="td-ctr">Hours</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="empty-state">
                      {search.trim() || filter !== 'all' ? 'No Designs match.' : 'No Designs yet.'}
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
        BOM creation for an Equipment SO is blocked until its design is Approved.
      </div>

      {showAdd ? <AddDesignModal onClose={() => setShowAdd(false)} /> : null}
      {editRow ? <EditDesignModal row={editRow} onClose={() => setEditRow(null)} /> : null}
      {logTimeRow ? <LogTimeModal row={logTimeRow} onClose={() => setLogTimeRow(null)} /> : null}
    </div>
  );
}

function KpiStrip({
  summary,
  filter,
  onChange,
}: {
  summary: {
    total: number;
    pending: number;
    inProgress: number;
    review: number;
    approved: number;
    overdue: number;
  };
  filter: FilterKey;
  onChange: (k: FilterKey) => void;
}): React.JSX.Element {
  // One strip; each tile is the filter (the old status dropdown is gone).
  const tiles: Array<{ k: FilterKey; label: string; value: number; color?: string }> = [
    { k: 'all', label: 'Total', value: summary.total },
    { k: 'pending', label: 'Pending', value: summary.pending, color: 'var(--blue)' },
    { k: 'progress', label: 'In Progress', value: summary.inProgress, color: 'var(--amber2)' },
    { k: 'review', label: 'Review', value: summary.review, color: 'var(--amber2)' },
    { k: 'approved', label: 'Approved', value: summary.approved, color: 'var(--green2)' },
    { k: 'overdue', label: 'Overdue', value: summary.overdue, color: 'var(--red2)' },
  ];
  return (
    <div style={{ marginBottom: 16 }}>
      <StatStrip
        items={tiles.map((t) => ({
          key: t.k,
          label: t.label,
          count: t.value,
          color: t.color,
          active: filter === t.k,
          onClick: () => onChange(t.k),
        }))}
      />
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
  const today = todayIst();
  const isOverdue = row.targetDate < today && row.status !== 'Approved';
  // Pending = waiting to start (blue); In Progress / Review / Revision = under
  // way (amber); Approved = done (green).
  const stCls =
    row.status === 'Approved' ? 'b-green' : row.status === 'Pending' ? 'b-blue' : 'b-amber';
  const [ask, setAsk] = useState<'submit' | 'approve' | null>(null);

  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'design_create');
  const submitMut = useSubmitDesignReview();
  const approveMut = useApproveDesign();
  const reviseMut = useReviseDesign();

  const hrsOver = row.totalHours > row.estimatedHours;
  return (
    <tr style={{ background: isOverdue ? 'var(--red3)' : 'var(--bg)' }}>
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
      <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
        {row.clientPoLineNo ?? '—'}
      </td>
      <td style={{ fontSize: 11 }}>
        <span style={{ color: 'var(--purple)', fontWeight: 600 }}>
          {itemCodeWithRev(row.itemCodeText, row.itemRevision, '')}
        </span>
        <br />
        {row.itemNameText ?? ''}
      </td>
      <td style={{ fontSize: 12 }}>{row.designer || '—'}</td>
      <td className="text2" style={{ fontSize: 11 }}>
        {fmtDate(row.startDate)}
      </td>
      <td className="text2" style={{ fontSize: 11, color: isOverdue ? 'var(--red)' : undefined }}>
        {fmtDate(row.targetDate)}
      </td>
      <td>
        <span className={`badge ${stCls}`}>{row.status}</span>
      </td>
      <td className="td-ctr mono fw-700">Design Rev {row.revision}</td>
      <td className="td-ctr">
        <span className="mono fw-700" style={{ color: hrsOver ? 'var(--red)' : 'var(--green)' }}>
          {row.totalHours}
        </span>
        <span style={{ color: 'var(--text3)', fontSize: 11 }}> / {row.estimatedHours}h</span>
      </td>
      <td>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
            onClick={onLogTime}
          >
            ⏱ Log
          </button>
          {perms.edit && row.status !== 'Approved' ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11 }}
              onClick={onEdit}
            >
              ✏ Edit
            </button>
          ) : null}
          {canWrite && row.status === 'In Progress' ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11, color: 'var(--blue)' }}
              disabled={submitMut.isPending}
              onClick={() => setAsk('submit')}
            >
              ✔ Submit
            </button>
          ) : null}
          {isAdmin && row.status === 'Review' ? (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11, color: 'var(--green2)' }}
                disabled={approveMut.isPending}
                onClick={() => setAsk('approve')}
              >
                ✅ Approve
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11, color: 'var(--red2)' }}
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
        <ConfirmDialog
          open={ask === 'submit'}
          title={`Submit ${row.code} for review?`}
          message="The design moves to Review for approval."
          confirmLabel="Submit"
          tone="primary"
          onCancel={() => setAsk(null)}
          onConfirm={async () => {
            await submitMut.mutateAsync(row.id);
            setAsk(null);
          }}
        />
        <ConfirmDialog
          open={ask === 'approve'}
          title={`Approve design ${row.code}?`}
          message={`This unlocks BOM creation for ${row.soCodeText ?? 'the SO'}.`}
          confirmLabel="Approve"
          tone="primary"
          onCancel={() => setAsk(null)}
          onConfirm={async () => {
            await approveMut.mutateAsync(row.id);
            setAsk(null);
          }}
        />
      </td>
    </tr>
  );
}

// ─── Add modal ────────────────────────────────────────────────────────────

function AddDesignModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [date] = useState(todayIst());
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
      setErr('SO No. is required.');
      return;
    }
    if (!designer.trim()) {
      setErr('Design Engineer is required.');
      return;
    }
    if (!targetDate) {
      setErr('Target Date is required.');
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
      onError: (e) => setErr(e instanceof Error ? e.message : 'Could not save Design. Try again.'),
    });
  };

  return (
    <ModalShell onClose={onClose} title="Assign Design">
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
        <Field label="SO No." req full>
          <SearchableSelect
            value={soId}
            valueLabel={
              selectedSo ? `${selectedSo.code} — ${selectedSo.customerName ?? ''}` : undefined
            }
            // SO type beside the customer (e.g. "· Equipment") — design work
            // is mostly on Equipment SOs, so the type tells them apart.
            options={(soData?.items ?? []).map((so) => ({
              id: so.id,
              code: so.code,
              name: [so.customerName, so.type ? soTypeLabel(so.type) : null]
                .filter(Boolean)
                .join(' · '),
            }))}
            onSearch={setSoSearch}
            placeholder="Type SO No. or customer…"
            onChange={setSoId}
          />
        </Field>
        <Field label="Design Engineer" req>
          <input
            type="text"
            className="innovic-input"
            value={designer}
            onChange={(e) => setDesigner(e.target.value)}
            placeholder="Design engineer name"
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
        <Field label="Remarks" full>
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
      <Actions onClose={onClose} onSave={onSave} saving={mut.isPending} label="Save Design" />
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
        onError: (e) =>
          setErr(e instanceof Error ? e.message : 'Could not save Design. Try again.'),
      },
    );
  };

  return (
    <ModalShell onClose={onClose} title={`Edit Design — ${row.code}`}>
      <div className="form-grid">
        <Field label="SO No.">
          <input
            type="text"
            className="innovic-input"
            value={row.soCodeText ?? ''}
            readOnly
            style={{ color: 'var(--cyan)', fontWeight: 700 }}
          />
        </Field>
        {/* POL — read-only here; it is typed only on the Sales Order. */}
        <Field label="POL">
          <input
            type="text"
            className="innovic-input"
            value={row.clientPoLineNo ?? '—'}
            readOnly
            style={{ color: 'var(--purple)', fontWeight: 700 }}
          />
        </Field>
        <Field label="Item Code">
          <input
            type="text"
            className="innovic-input"
            value={itemCodeWithRev(row.itemCodeText, row.itemRevision, '')}
            readOnly
            style={{ color: 'var(--purple)' }}
          />
        </Field>
        <Field label="Design Engineer">
          <input
            type="text"
            className="innovic-input"
            value={designer}
            onChange={(e) => setDesigner(e.target.value)}
          />
        </Field>
        <Field label="Design Status">
          <select
            className="innovic-select"
            value={status}
            onChange={(e) => setStatus(e.target.value as DesignTrackerListItem['status'])}
          >
            <option>Pending</option>
            <option>In Progress</option>
            <option>Review</option>
            <option>Approved</option>
            {/* Revision is set only by the Revise action; listed here only so a
                design already in Revision keeps its value. */}
            {row.status === 'Revision' ? <option>Revision</option> : null}
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
      <Actions onClose={onClose} onSave={onSave} saving={mut.isPending} label="Save Changes" />
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
  const [logDate, setLogDate] = useState(todayIst());
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
      setErr('Hours Worked is required.');
      return;
    }
    if (!worker.trim()) {
      setErr('Design Engineer is required.');
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
        onError: (e) => setErr(e instanceof Error ? e.message : 'Could not log time. Try again.'),
      },
    );
  };

  return (
    <ModalShell
      onClose={onClose}
      title={`Time Log — ${row.code} (${row.totalHours}h / ${row.estimatedHours}h)`}
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
        <b style={{ color: 'var(--cyan)' }}>{row.soCodeText ?? '—'}</b> | POL{' '}
        <b className="mono" style={{ color: 'var(--purple)' }}>
          {row.clientPoLineNo ?? '—'}
        </b>{' '}
        | {itemCodeWithRev(row.itemCodeText, row.itemRevision, '')} | Design Engineer:{' '}
        <b>{row.designer}</b>
      </div>
      <div className="form-grid">
        <Field label="Log Date">
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
        <Field label="Design Engineer">
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
          <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: 'var(--text3)' }}>
            Previous Entries
          </div>
          <div className="tbl-wrap" style={{ maxHeight: 200, overflowY: 'auto' }}>
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Log Date</th>
                  <th>Hours</th>
                  <th>Design Engineer</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {previous.map((t) => (
                  <tr key={t.id}>
                    <td style={{ fontSize: 11 }}>{fmtDate(t.logDate)}</td>
                    <td className="mono fw-700" style={{ color: 'var(--green2)' }}>
                      {t.hours}h
                    </td>
                    <td style={{ fontSize: 11 }}>{t.workerText}</td>
                    <td style={{ fontSize: 11, color: 'var(--text3)' }}>{t.description ?? ''}</td>
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

function ErrorBox({ message }: { message: string }): React.JSX.Element {
  return (
    <div
      style={{
        marginTop: 12,
        padding: 8,
        background: 'var(--red3)',
        color: 'var(--red2)',
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      {message}
    </div>
  );
}
