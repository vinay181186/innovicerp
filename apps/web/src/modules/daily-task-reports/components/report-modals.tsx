// Daily Task Report modals — New / Edit (shared multi-line editor) + View.
// Mirror of legacy _addDailyReport / _drFormHtml / _editDailyReport /
// _viewDailyReport.

import type { DailyReportLineStatus, UpsertDailyTaskReportInput } from '@innovic/shared';
import {
  DAILY_REPORT_LINE_STATUS_LABELS,
  DAILY_REPORT_LINE_STATUSES,
  SHIFTS,
  SHIFT_LABELS,
  type Shift,
} from '@innovic/shared';
import { useState } from 'react';
import { useCreateDailyReport, useDailyReportDetail, useUpdateDailyReport } from '../api';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function Overlay(props: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }): React.JSX.Element {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: 24, overflowY: 'auto' }}
      onClick={props.onClose}
    >
      <div className="panel" style={{ width: props.wide ? 'min(1100px, 96vw)' : 'min(1100px, 96vw)' }} onClick={(e) => e.stopPropagation()}>
        <div className="panel-hdr">
          <span className="panel-title">{props.title}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={props.onClose}>
            ✕
          </button>
        </div>
        <div className="panel-body">{props.children}</div>
      </div>
    </div>
  );
}

interface EditLine {
  description: string;
  ref: string;
  hours: number;
  status: DailyReportLineStatus;
  remarks: string;
}

const emptyLine = (): EditLine => ({ description: '', ref: '', hours: 0, status: 'completed', remarks: '' });

function ReportEditor({
  initialDate,
  initialShift,
  initialLines,
  pending,
  onCancel,
  onSubmit,
}: {
  initialDate: string;
  initialShift: Shift;
  initialLines: EditLine[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (input: UpsertDailyTaskReportInput) => Promise<void>;
}): React.JSX.Element {
  const [reportDate, setReportDate] = useState(initialDate);
  const [shift, setShift] = useState<Shift>(initialShift);
  const [lines, setLines] = useState<EditLine[]>(initialLines.length ? initialLines : [emptyLine()]);
  const [err, setErr] = useState<string | null>(null);

  const totalHours = lines.reduce((s, l) => s + (Number(l.hours) || 0), 0);

  function setLine(i: number, patch: Partial<EditLine>): void {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit(): Promise<void> {
    setErr(null);
    const valid = lines.filter((l) => l.description.trim());
    if (valid.length === 0) return setErr('Add at least one task');
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
      setErr(e instanceof Error ? e.message : 'Save failed');
    }
  }

  return (
    <div>
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div className="form-grp">
          <label className="form-label">Date</label>
          <input type="date" className="innovic-input" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
        </div>
        <div className="form-grp">
          <label className="form-label">Shift</label>
          <select className="innovic-select" value={shift} onChange={(e) => setShift(e.target.value as Shift)}>
            {SHIFTS.map((s) => (
              <option key={s} value={s}>
                {SHIFT_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ border: '1px solid var(--border2)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        <div style={{ padding: '8px 12px', background: 'var(--bg4)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="form-label" style={{ marginBottom: 0 }}>
            Tasks ({lines.length}) · {totalHours.toFixed(1)}h
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
            + Add Task
          </button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="innovic-table" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ width: 28 }}>#</th>
                <th>Task Description</th>
                <th style={{ width: 90 }}>SO/JC Ref</th>
                <th style={{ width: 64 }}>Hours</th>
                <th style={{ width: 110 }}>Status</th>
                <th>Remarks</th>
                <th style={{ width: 30 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="td-ctr" style={{ fontWeight: 700, color: 'var(--text3)' }}>
                    {i + 1}
                  </td>
                  <td>
                    <input className="innovic-input" style={{ width: '100%', fontSize: 12 }} value={l.description} placeholder="Task description" onChange={(e) => setLine(i, { description: e.target.value })} />
                  </td>
                  <td>
                    <input className="innovic-input" style={{ width: 80, fontSize: 11 }} value={l.ref} placeholder="SO/JC" onChange={(e) => setLine(i, { ref: e.target.value })} />
                  </td>
                  <td>
                    <input type="number" min={0} step={0.5} className="innovic-input" style={{ width: 56, textAlign: 'center', fontWeight: 700 }} value={l.hours || ''} onChange={(e) => setLine(i, { hours: Number(e.target.value) || 0 })} />
                  </td>
                  <td>
                    <select className="innovic-select" style={{ fontSize: 11 }} value={l.status} onChange={(e) => setLine(i, { status: e.target.value as DailyReportLineStatus })}>
                      {DAILY_REPORT_LINE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {DAILY_REPORT_LINE_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="innovic-input" style={{ width: '100%', fontSize: 11 }} value={l.remarks} placeholder="Notes" onChange={(e) => setLine(i, { remarks: e.target.value })} />
                  </td>
                  <td>
                    <button type="button" className="btn btn-danger btn-sm" style={{ fontSize: 12 }} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {err ? <div role="alert" style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>{err}</div> : null}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => void submit()}>
          {pending ? 'Saving…' : 'Save Report'}
        </button>
      </div>
    </div>
  );
}

export function NewReportModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const create = useCreateDailyReport();
  return (
    <Overlay title="📋 New Daily Report" onClose={onClose} wide>
      <ReportEditor
        initialDate={todayStr()}
        initialShift="day"
        initialLines={[emptyLine()]}
        pending={create.isPending}
        onCancel={onClose}
        onSubmit={async (input) => {
          await create.mutateAsync(input);
          onClose();
        }}
      />
    </Overlay>
  );
}

export function EditReportModal({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const { data, isLoading } = useDailyReportDetail(id);
  const update = useUpdateDailyReport(id);
  return (
    <Overlay title="✏ Edit Daily Report" onClose={onClose} wide>
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
          onCancel={onClose}
          onSubmit={async (input) => {
            await update.mutateAsync(input);
            onClose();
          }}
        />
      )}
    </Overlay>
  );
}

function lineStatusColor(s: DailyReportLineStatus): string {
  return s === 'completed' ? 'var(--green)' : s === 'in_progress' ? 'var(--cyan)' : s === 'blocked' ? 'var(--red)' : 'var(--amber)';
}

export function ViewReportModal({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const { data: r, isLoading } = useDailyReportDetail(id);
  return (
    <Overlay title="📋 Daily Report" onClose={onClose} wide>
      {isLoading || !r ? (
        <div className="empty-state">Loading…</div>
      ) : (
        <div>
          <div style={{ padding: '10px 14px', background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 14, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>USER</span>
              <br />
              <b>{r.userName ?? '—'}</b>
            </div>
            <div>
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>DATE</span>
              <br />
              <b>{r.reportDate}</b>
            </div>
            <div>
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>SHIFT</span>
              <br />
              <b>{SHIFT_LABELS[r.shift]}</b>
            </div>
            <div>
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>TOTAL HOURS</span>
              <br />
              <b style={{ color: 'var(--cyan)' }}>{r.totalHours.toFixed(1)}h</b>
            </div>
          </div>
          <table className="innovic-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Task</th>
                <th>Ref</th>
                <th>Hours</th>
                <th>Status</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l) => (
                <tr key={l.id}>
                  <td className="td-ctr">{l.lineNo}</td>
                  <td>{l.description}</td>
                  <td className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>{l.ref || '—'}</td>
                  <td className="td-ctr mono fw-700">{l.hours.toFixed(1)}</td>
                  <td>
                    <span style={{ fontWeight: 600, color: lineStatusColor(l.status) }}>{DAILY_REPORT_LINE_STATUS_LABELS[l.status]}</span>
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--text3)' }}>{l.remarks ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Overlay>
  );
}
