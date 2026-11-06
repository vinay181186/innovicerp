// Daily Task Report modals — New / Edit (shared multi-line editor) + View.
// Mirror of legacy _addDailyReport / _drFormHtml / _editDailyReport /
// _viewDailyReport.

import { Icon, StatusBadge } from '@/ui/core';
import type { DailyReportLineStatus, UpsertDailyTaskReportInput } from '@innovic/shared';
import {
  DAILY_REPORT_LINE_STATUS_LABELS,
  DAILY_REPORT_LINE_STATUSES,
  SHIFTS,
  SHIFT_LABELS,
  type Shift,
} from '@innovic/shared';
import { useState } from 'react';
import { fmtDate, todayIst } from '@/lib/date';
// Task Board's popup shell: `guard` makes ESC / a backdrop click ask "Are you
// sure you want to exit?" instead of silently dropping typed task lines.
import { Overlay } from '@/modules/tasks/components/task-overlay';
import { useCreateDailyReport, useDailyReportDetail, useUpdateDailyReport } from '../api';
import { useToast } from '@/ui/feedback';

function todayStr(): string {
  return todayIst();
}

interface EditLine {
  description: string;
  ref: string;
  hours: number;
  status: DailyReportLineStatus;
  remarks: string;
}

const emptyLine = (): EditLine => ({
  description: '',
  ref: '',
  hours: 0,
  status: 'completed',
  remarks: '',
});

function ReportEditor({
  initialDate,
  initialShift,
  initialLines,
  pending,
  saveLabel,
  onCancel,
  onSubmit,
}: {
  initialDate: string;
  initialShift: Shift;
  initialLines: EditLine[];
  pending: boolean;
  /** "Save Report" on create, "Save Changes" on edit. */
  saveLabel: string;
  onCancel: () => void;
  onSubmit: (input: UpsertDailyTaskReportInput) => Promise<void>;
}): React.JSX.Element {
  const [reportDate, setReportDate] = useState(initialDate);
  const [shift, setShift] = useState<Shift>(initialShift);
  const [lines, setLines] = useState<EditLine[]>(
    initialLines.length ? initialLines : [emptyLine()],
  );
  const [err, setErr] = useState<string | null>(null);

  const totalHours = lines.reduce((s, l) => s + (Number(l.hours) || 0), 0);

  function setLine(i: number, patch: Partial<EditLine>): void {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit(): Promise<void> {
    setErr(null);
    const valid = lines.filter((l) => l.description.trim());
    if (valid.length === 0) return setErr('Task Description is required.');
    try {
      await onSubmit({
        reportDate,
        shift,
        lines: valid.map((l) => ({
          description: l.description.trim(),
          ref: l.ref.trim() || undefined,
          hours: Number(l.hours) || 0,
          status: l.status,
          remarks: l.remarks.trim() || undefined,
        })),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save daily report. Try again.');
    }
  }

  return (
    <div>
      <div className="form-grid" style={{ marginBottom: 'var(--sp-3)' }}>
        <div className="form-grp">
          <label className="form-label">Report Date</label>
          <input
            type="date"
            className="innovic-input"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Shift</label>
          <select
            className="innovic-select"
            value={shift}
            onChange={(e) => setShift(e.target.value as Shift)}
          >
            {SHIFTS.map((s) => (
              <option key={s} value={s}>
                {SHIFT_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        style={{
          border: '1px solid var(--border2)',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: 'var(--sp-2) var(--sp-3)',
            background: 'var(--bg4)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span className="form-label" style={{ marginBottom: 0 }}>
            Tasks ({lines.length}) · {totalHours.toFixed(1)}h
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setLines((ls) => [...ls, emptyLine()])}
          >
            + Add Task
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="innovic-table" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th className="th-ctr" style={{ width: 28 }}>
                  Sr No
                </th>
                <th>Task Description</th>
                <th style={{ width: 90 }}>SO No.</th>
                <th className="th-num" style={{ width: 64 }}>
                  Hours
                </th>
                <th style={{ width: 140 }}>Task Status</th>
                <th>Remarks</th>
                <th className="th-ctr" style={{ width: 30 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="td-ctr" style={{ fontWeight: 700, color: 'var(--text3)' }}>
                    {i + 1}
                  </td>
                  <td>
                    <input
                      className="innovic-input"
                      style={{ width: '100%', fontSize: 'var(--fs-sm)' }}
                      value={l.description}
                      placeholder="Task description"
                      onChange={(e) => setLine(i, { description: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="innovic-input"
                      style={{ width: 80, fontSize: 'var(--fs-xs)' }}
                      value={l.ref}
                      placeholder="SO/JC"
                      onChange={(e) => setLine(i, { ref: e.target.value })}
                    />
                  </td>
                  <td className="td-num">
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      className="innovic-input"
                      style={{ width: 56, fontWeight: 700 }}
                      value={l.hours || ''}
                      onChange={(e) => setLine(i, { hours: Number(e.target.value) || 0 })}
                    />
                  </td>
                  <td>
                    <select
                      className="innovic-select"
                      style={{ fontSize: 'var(--fs-sm)', width: '100%' }}
                      value={l.status}
                      onChange={(e) =>
                        setLine(i, { status: e.target.value as DailyReportLineStatus })
                      }
                    >
                      {DAILY_REPORT_LINE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {DAILY_REPORT_LINE_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="innovic-input"
                      style={{ width: '100%', fontSize: 'var(--fs-xs)' }}
                      value={l.remarks}
                      placeholder="Notes"
                      onChange={(e) => setLine(i, { remarks: e.target.value })}
                    />
                  </td>
                  <td className="td-ctr">
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      style={{ fontSize: 'var(--fs-sm)' }}
                      disabled={lines.length === 1}
                      title={lines.length === 1 ? 'A report needs at least one line' : 'Remove'}
                      aria-label="Remove"
                      onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {err ? (
        <div
          role="alert"
          style={{ color: 'var(--red2)', fontSize: 'var(--fs-sm)', marginTop: 'var(--sp-2)' }}
        >
          {err}
        </div>
      ) : null}
      <div
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          justifyContent: 'flex-end',
          marginTop: 'var(--sp-3)',
        }}
      >
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() => void submit()}
        >
          {pending ? 'Saving…' : saveLabel}
        </button>
      </div>
    </div>
  );
}

export function NewReportModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const create = useCreateDailyReport();
  const toast = useToast();
  return (
    <Overlay title="New Daily Report" onClose={onClose} wide guard>
      <ReportEditor
        initialDate={todayStr()}
        initialShift="day"
        initialLines={[emptyLine()]}
        pending={create.isPending}
        saveLabel="Save Report"
        onCancel={onClose}
        onSubmit={async (input) => {
          await create.mutateAsync(input);
          toast.ok('Daily Report saved');
          onClose();
        }}
      />
    </Overlay>
  );
}

export function EditReportModal({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}): React.JSX.Element {
  const { data, isLoading } = useDailyReportDetail(id);
  const update = useUpdateDailyReport(id);
  const toast = useToast();
  return (
    <Overlay title="Edit Daily Report" onClose={onClose} wide guard>
      {isLoading || !data ? (
        <div className="empty-state">Loading…</div>
      ) : (
        <ReportEditor
          initialDate={data.reportDate}
          initialShift={data.shift}
          initialLines={data.lines.map((l) => ({
            description: l.description,
            ref: l.ref ?? '',
            hours: l.hours,
            status: l.status,
            remarks: l.remarks ?? '',
          }))}
          pending={update.isPending}
          saveLabel="Save Changes"
          onCancel={onClose}
          onSubmit={async (input) => {
            await update.mutateAsync(input);
            toast.ok('Daily Report saved');
            onClose();
          }}
        />
      )}
    </Overlay>
  );
}

export function ViewReportModal({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}): React.JSX.Element {
  const { data: r, isLoading } = useDailyReportDetail(id);
  return (
    <Overlay title="Daily Report" onClose={onClose} wide>
      {isLoading || !r ? (
        <div className="empty-state">Loading…</div>
      ) : (
        <div>
          <div
            style={{
              padding: '10px 14px',
              background: 'var(--bg3)',
              borderRadius: 'var(--radius2)',
              border: '1px solid var(--border)',
              marginBottom: 14,
              display: 'flex',
              gap: 20,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>User</span>
              <br />
              <b>{r.userName ?? '—'}</b>
            </div>
            <div>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>Report Date</span>
              <br />
              <b>{fmtDate(r.reportDate)}</b>
            </div>
            <div>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>Shift</span>
              <br />
              <b>{SHIFT_LABELS[r.shift]}</b>
            </div>
            <div>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>Total Hours</span>
              <br />
              <b style={{ color: 'var(--cyan)' }}>{r.totalHours.toFixed(1)}h</b>
            </div>
          </div>
          <table className="innovic-table">
            <thead>
              <tr>
                <th className="th-ctr">Sr No</th>
                <th>Task Description</th>
                <th>SO No.</th>
                <th className="th-num">Hours</th>
                <th className="th-ctr">Task Status</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l) => (
                <tr key={l.id}>
                  <td className="td-ctr">{l.lineNo}</td>
                  <td>{l.description}</td>
                  <td className="mono" style={{ fontSize: 'var(--fs-xs)', color: 'var(--cyan)' }}>
                    {l.ref || '—'}
                  </td>
                  <td className="td-num mono fw-700">{l.hours.toFixed(1)}</td>
                  <td className="td-ctr">
                    <StatusBadge
                      kind="doc"
                      status={l.status}
                      label={DAILY_REPORT_LINE_STATUS_LABELS[l.status]}
                    />
                  </td>
                  <td style={{ fontSize: 'var(--fs-xs)', color: 'var(--text3)' }}>
                    {l.remarks ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Overlay>
  );
}
