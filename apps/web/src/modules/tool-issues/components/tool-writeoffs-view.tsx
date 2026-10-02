// Tool write-offs (ADR-193 phase 4b, owner decision Q4): Damaged / Lost from
// a return, or Scrap of an in-store instrument, wait here for the Store
// In-charge (approve tier). The person who recorded one cannot decide it.
// Approve → the tool is written off; Reject → Damaged goes back to stock as
// Good, Lost goes back to "still with the operator".
//
// ADR-201: 25 write-offs a page with Prev / Next (page in this tab's state);
// the status dropdown and the column ▾ Sort & Filter run on the server, and
// any change of them goes back to page 1.
import {
  type ToolWriteoffKind,
  type ToolWriteoffRow,
  type ToolWriteoffStatus,
} from '@innovic/shared';
import { useCallback, useMemo, useState } from 'react';
import { fmtDate } from '@/lib/date';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { useSession } from '@/lib/session';
import { DataTable, type DataTableColumn, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, PageState, RowActions } from '@/ui/layout';
import { useDecideToolWriteoff, useToolWriteoffs } from '../api';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const KIND_LABELS: Record<ToolWriteoffKind, string> = {
  damaged: 'Damaged',
  lost: 'Lost',
  scrap: 'Scrap',
};
const STATUS_LABELS: Record<ToolWriteoffStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};
const KIND_OPTIONS = Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }));
const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));

export function ToolWriteoffsView({ canDecide }: { canDecide: boolean }): React.JSX.Element {
  const [status, setStatus] = useState<ToolWriteoffStatus | ''>('pending');
  const [page, setPage] = useState(1);
  const sf = useServerSortFilter(TABLE_KEYS.toolWriteoffs, () => setPage(1));
  const { data, isLoading, isError, error } = useToolWriteoffs(
    {
      ...(status ? { status } : {}),
      ...(sf.param ? { sf: sf.param } : {}),
      limit: LIST_PAGE_SIZE,
      offset: pageOffset(page),
    },
    true,
  );
  const onPage = useCallback((p: number) => setPage(p), []);
  useClampPage(page, data?.total, onPage);
  const [deciding, setDeciding] = useState<ToolWriteoffRow | null>(null);

  const columns = useMemo<DataTableColumn<ToolWriteoffRow>[]>(
    () => [
      {
        id: 'kind',
        kind: 'text',
        header: 'Write-off Kind',
        render: (w) => KIND_LABELS[w.kind],
        sortFilterField: 'kind',
        filterType: 'list',
        filterOptions: KIND_OPTIONS,
      },
      {
        id: 'item_code',
        kind: 'code',
        header: 'Item Code',
        align: 'left',
        className: 'mono fw-700',
        render: (w) => <span style={{ color: 'var(--text)' }}>{w.itemCode}</span>,
        sortFilterField: 'itemCode',
      },
      {
        id: 'serial_no',
        kind: 'code',
        header: 'Instrument Serial No.',
        className: 'mono',
        render: (w) => w.serialNo || '—',
        sortFilterField: 'serialNo',
      },
      {
        id: 'qty',
        kind: 'num',
        header: 'Write-off Qty',
        align: 'right',
        className: 'mono',
        render: (w) => r3(w.qty),
        sortFilterField: 'qty',
      },
      {
        id: 'issue_no',
        kind: 'code',
        header: 'Issue No.',
        className: 'td-code',
        nowrap: true,
        render: (w) => w.toolIssueCode || '—',
        sortFilterField: 'issueNo',
      },
      {
        id: 'issued_to',
        kind: 'text',
        header: 'Issued To',
        render: (w) => w.holder || '—',
        sortFilterField: 'issuedTo',
      },
      {
        id: 'reason',
        kind: 'text',
        header: 'Reason',
        align: 'left',
        ellipsis: true,
        className: 'text3',
        render: (w) => w.reason,
        title: (w) => w.reason,
        sortFilterField: 'reason',
      },
      {
        id: 'requested_by',
        kind: 'text',
        header: 'Requested By',
        sortFilterField: 'requestedBy',
        render: (w) => (
          <>
            {w.requestedByName || '—'}
            <div className="text3">{fmtDate(w.requestedAt.slice(0, 10))}</div>
          </>
        ),
      },
      {
        id: 'status',
        kind: 'text',
        header: 'Write-off Status',
        sortFilterField: 'status',
        filterType: 'list',
        filterOptions: STATUS_OPTIONS,
        render: (w) => (
          <>
            {STATUS_LABELS[w.status]}
            {w.decidedByName ? (
              <div className="text3" style={{ fontSize: 11 }}>
                {w.decidedByName}
                {w.decisionRemarks ? ` — ${w.decisionRemarks}` : ''}
              </div>
            ) : null}
          </>
        ),
      },
    ],
    [],
  );

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <select
          className="innovic-select"
          aria-label="Write-off Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ToolWriteoffStatus | '');
            setPage(1);
          }}
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="">All</option>
        </select>
      </div>
      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load write-offs.'}
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.toolWriteoffs}
            columns={columns}
            rows={data?.items ?? []}
            sortFilterServer={sf}
            rowKey={(w) => w.id}
            loading={isLoading}
            empty="No write-offs here."
            // A decided write-off is washed: approved greens the row, rejected
            // greys it; a pending one (awaiting the Store In-charge) stays plain.
            rowClassName={(w) =>
              w.status === 'approved'
                ? ROW_TINT.done
                : w.status === 'rejected'
                  ? ROW_TINT.cancelled
                  : undefined
            }
            rowActionsWidth="1%"
            rowActions={(w) =>
              canDecide && w.status === 'pending' ? (
                <RowActions
                  items={[{ key: 'decide', label: 'Decide', onSelect: () => setDeciding(w) }]}
                />
              ) : null
            }
          />
        </Panel>
      )}
      <ListFooter
        total={data?.total ?? 0}
        noun="write-off"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={onPage}
      />
      {deciding ? <DecideModal w={deciding} onClose={() => setDeciding(null)} /> : null}
    </div>
  );
}

function DecideModal({
  w,
  onClose,
}: {
  w: ToolWriteoffRow;
  onClose: () => void;
}): React.JSX.Element {
  const { data: me } = useSession();
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const mut = useDecideToolWriteoff();
  const own = me?.id === w.requestedBy;
  const decide = (decision: 'approve' | 'reject'): void => {
    setErr(null);
    if (decision === 'reject' && !remarks.trim()) {
      setErr('Give a reason in Remarks to reject this write-off.');
      return;
    }
    mut.mutate(
      { id: w.id, decision, ...(remarks.trim() ? { remarks: remarks.trim() } : {}) },
      { onSuccess: onClose, onError: (e) => setErr(e.message || 'Could not save the decision.') },
    );
  };
  const rejectMeans =
    w.kind === 'damaged'
      ? 'Reject = it goes back to stock as Good.'
      : w.kind === 'lost'
        ? 'Reject = it is still with the holder (Still Out again).'
        : 'Reject = the instrument stays in store.';
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-hdr">
          <span className="modal-title">
            Write-off — {w.itemCode}
            {w.serialNo ? ` · ${w.serialNo}` : ''}
          </span>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="text2" style={{ fontSize: 12, marginBottom: 8 }}>
            {KIND_LABELS[w.kind]} · qty {r3(w.qty)} · reason: {w.reason}
          </div>
          <div className="text3" style={{ fontSize: 11, marginBottom: 8 }}>
            Approve = written off. {rejectMeans}
          </div>
          {own ? (
            <div style={{ color: 'var(--amber2)', fontSize: 12, marginBottom: 8 }}>
              You recorded this write-off — another Store In-charge must decide it.
            </div>
          ) : null}
          <input
            type="text"
            className="innovic-input"
            placeholder="Remarks (required to Reject)"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
          {err ? (
            <div style={{ color: 'var(--red2)', fontSize: 12, marginTop: 8 }}>{err}</div>
          ) : null}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={own || mut.isPending}
            onClick={() => decide('reject')}
          >
            Reject
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={own || mut.isPending}
            onClick={() => decide('approve')}
          >
            Approve Write-off
          </button>
        </div>
      </div>
    </div>
  );
}
