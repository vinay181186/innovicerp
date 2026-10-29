// Task Board tab "Approvals · Day Log (N)" (owner final 2026-10-27), shown
// only when GET /day-logs/access says canApprove (§20.5). One row per staged
// edit (GET /day-logs/approvals) on the FIT table (ADR-199) with the ADR-200
// Sort & Filter ▾ and a User search, both in the browser (every waiting edit
// is loaded): User · Day · Change: Was (struck through) · Change: New (in
// green). The row's ⋯ holds ✓ Approve and ✗ Reject; Reject asks for a reason
// first. The server decides who may approve whom (never one's own) and
// answers 409 when someone else already decided — the message shows above
// the table.

import type { DayLogApprovalRow } from '@innovic/shared';
import { useState } from 'react';
import { matchesSearchTerm, normalizeSearchTerm } from '@/components/shared/search-match';
import { DataTable } from '@/ui/data';
import type { DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Banner, ConfirmDialog } from '@/ui/feedback';
import { SearchInput } from '@/ui/forms';
import { PageState } from '@/ui/layout';
import { useApproveDayLogEdit, useDayLogApprovals, useRejectDayLogEdit } from '../api';
import { errText, fmtDmy, weekday } from '../lib/format';
import { spanText } from '../lib/sheet';
import '../day-log-sheet.css';

function changeText(v: DayLogApprovalRow['current'] | DayLogApprovalRow['proposed']): string {
  return [spanText(v.fromTime, v.toTime), v.orderCode, v.description].filter(Boolean).join(' · ');
}

const COLUMNS: DataTableColumn<DayLogApprovalRow>[] = [
  {
    id: 'user',
    header: 'User',
    kind: 'text',
    align: 'left',
    ellipsis: true,
    className: 'fw-700',
    title: (r) => r.userName,
    filterValue: (r) => r.userName,
    render: (r) => r.userName,
  },
  {
    id: 'day',
    header: 'Day',
    kind: 'date',
    className: 'mono',
    filterValue: (r) => r.date,
    render: (r) => (
      <>
        {fmtDmy(r.date)} <span className="text3">{weekday(r.date)}</span>
      </>
    ),
  },
  {
    id: 'was',
    header: 'Change: Was',
    kind: 'text',
    align: 'left',
    ellipsis: true,
    title: (r) => `Was: ${changeText(r.current)}`,
    filterValue: (r) => changeText(r.current),
    render: (r) => (
      <span style={{ color: 'var(--text3)', textDecoration: 'line-through' }}>
        Was: {changeText(r.current)}
      </span>
    ),
  },
  {
    id: 'new',
    header: 'Change: New',
    kind: 'text',
    align: 'left',
    ellipsis: true,
    title: (r) => `New: ${changeText(r.proposed)}`,
    filterValue: (r) => changeText(r.proposed),
    render: (r) => (
      <span style={{ color: 'var(--green2)', fontWeight: 600 }}>New: {changeText(r.proposed)}</span>
    ),
  },
];

export function DayLogApprovals(): React.JSX.Element {
  const query = useDayLogApprovals();
  const approve = useApproveDayLogEdit();
  const reject = useRejectDayLogEdit();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rejecting, setRejecting] = useState<DayLogApprovalRow | null>(null);
  const [reason, setReason] = useState('');
  const [rejectErr, setRejectErr] = useState<string | null>(null);
  const [term, setTerm] = useState('');

  if (!query.data) {
    return query.isError ? (
      <PageState
        state="error"
        message={errText(query.error, 'Could not load the edits to approve.')}
      />
    ) : (
      <PageState state="loading" />
    );
  }
  const all = query.data.rows;
  const needle = normalizeSearchTerm(term);
  const rows = needle ? all.filter((r) => matchesSearchTerm([r.userName], needle)) : all;

  const doApprove = async (r: DayLogApprovalRow): Promise<void> => {
    if (busyId) return;
    setBusyId(r.entryId);
    setMsg(null);
    try {
      await approve.mutateAsync({ id: r.entryId, requestedAt: r.requestedAt });
      setMsg({ ok: true, text: `Approved — ${r.userName}'s row now shows the new values.` });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally {
      setBusyId(null);
    }
  };

  const doReject = async (): Promise<void> => {
    if (!rejecting) return;
    const r = rejecting;
    if (reason.trim().length < 3) {
      setRejectErr('Give a reason');
      return;
    }
    setBusyId(r.entryId);
    try {
      await reject.mutateAsync({
        id: r.entryId,
        requestedAt: r.requestedAt,
        reason: reason.trim(),
      });
      setRejecting(null);
      setMsg({
        ok: true,
        text: `Rejected — the row stays as it was; ${r.userName} sees the reason.`,
      });
    } catch (e) {
      setRejectErr(errText(e));
    } finally {
      setBusyId(null);
    }
  };

  const busyReason = busyId !== null ? 'Working…' : undefined;

  return (
    <div>
      <div
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8 }}
      >
        <strong>Day Log edits waiting for approval</strong>
        {query.isFetching ? <span className="text3">⟳ Updating…</span> : null}
      </div>
      {msg ? <Banner tone={msg.ok ? 'success' : 'error'}>{msg.text}</Banner> : null}
      {query.isError ? <Banner tone="error">{errText(query.error)}</Banner> : null}
      <div className="dl-searchbar" role="search">
        <SearchInput value={term} onChange={setTerm} placeholder="Search User…" />
        {needle ? (
          <span className="text3 dl-small">
            Showing {rows.length} of {all.length}
          </span>
        ) : null}
        {needle ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTerm('')}>
            Clear search
          </button>
        ) : null}
      </div>
      <DataTable<DayLogApprovalRow>
        tableKey={TABLE_KEYS.dayLogApprovals}
        columns={COLUMNS}
        rows={rows}
        rowKey={(r) => r.entryId}
        empty={needle ? `No user matches "${needle}".` : 'No edits waiting.'}
        rowMenuLabel={(r) => `Actions for ${r.userName}'s edit on ${fmtDmy(r.date)}`}
        rowMenu={(r) => [
          {
            key: 'approve',
            label: '✓ Approve',
            disabledReason: busyReason,
            onSelect: () => doApprove(r),
          },
          {
            key: 'reject',
            label: '✗ Reject',
            group: 'danger',
            disabledReason: busyReason,
            onSelect: () => {
              setMsg(null);
              setReason('');
              setRejectErr(null);
              setRejecting(r);
            },
          },
        ]}
      />
      {rejecting ? (
        <ConfirmDialog
          title={`Reject ${rejecting.userName}'s edit?`}
          message={
            <label style={{ display: 'grid', gap: 4 }}>
              <span className="text3">Reason * — {rejecting.userName} sees it on the row</span>
              <textarea
                className="innovic-textarea"
                aria-label="Reason"
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          }
          confirmLabel="✗ Reject"
          pendingLabel="Rejecting…"
          tone="danger"
          errorText={rejectErr}
          elevated={false}
          onCancel={() => setRejecting(null)}
          onConfirm={doReject}
        />
      ) : null}
    </div>
  );
}
