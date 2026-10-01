// Who holds what (ADR-193 phase 4b): every tool still out, grouped by holder,
// overdue flagged. Click a row to open its tool issue. On the shared FIT
// DataTable (ADR-199, table standard 2026-10-01) — the holder name shows once
// per group, and an overdue row is washed red (ROW_TINT.late).
import { type ToolHolderRow } from '@innovic/shared';
import { useMemo } from 'react';
import { fmtDate } from '@/lib/date';
import { DataTable, type DataTableColumn, Panel, ROW_TINT } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { PageState, RowActions } from '@/ui/layout';
import { useToolHolders } from '../api';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export function ToolHoldersView({ onOpen }: { onOpen: (id: string) => void }): React.JSX.Element {
  const { data, isLoading, isError, error } = useToolHolders(true);

  // Group the rows by holder so the holder name can show once per group, exactly
  // as the hand-written table did.
  const rows = useMemo(() => {
    const src = data ?? [];
    const holders = [...new Set(src.map((r) => r.holder))];
    return holders.flatMap((h) => src.filter((r) => r.holder === h));
  }, [data]);
  const firstOfGroup = useMemo(() => {
    const seen = new Set<string>();
    const ids = new Set<string>();
    for (const r of rows) {
      if (!seen.has(r.holder)) {
        seen.add(r.holder);
        ids.add(r.toolIssueId);
      }
    }
    return ids;
  }, [rows]);

  const columns = useMemo<DataTableColumn<ToolHolderRow>[]>(
    () => [
      {
        id: 'held_by',
        kind: 'text',
        header: 'Issued To',
        align: 'left',
        className: 'fw-700',
        render: (r) => (firstOfGroup.has(r.toolIssueId) ? r.holder : ''),
      },
      {
        id: 'item_code',
        kind: 'code',
        header: 'Item Code',
        align: 'left',
        render: (r) => (
          <>
            <span className="mono fw-700" style={{ color: 'var(--text)' }}>
              {r.itemCode}
            </span>
            {r.itemName ? (
              <div className="text3" style={{ fontSize: 11 }}>
                {r.itemName}
              </div>
            ) : null}
          </>
        ),
      },
      {
        id: 'serial_no',
        kind: 'code',
        header: 'Instrument Serial No.',
        className: 'mono',
        render: (r) => r.serialNos || '—',
      },
      {
        id: 'still_out',
        kind: 'num',
        header: 'Still Out',
        align: 'right',
        className: 'mono fw-700',
        render: (r) => r3(r.stillOutQty),
      },
      {
        id: 'issue_no',
        kind: 'code',
        header: 'Issue No.',
        className: 'td-code',
        nowrap: true,
        render: (r) => <span style={{ color: 'var(--cyan)' }}>{r.toolIssueCode}</span>,
      },
      {
        id: 'expected_return',
        kind: 'date',
        header: 'Expected Return',
        nowrap: true,
        render: (r) => (
          <span style={{ color: r.isOverdue ? 'var(--red2)' : undefined }}>
            {r.expectedReturnDate ? fmtDate(r.expectedReturnDate) : '—'}
            {r.isOverdue ? ' · Overdue' : ''}
          </span>
        ),
      },
    ],
    [firstOfGroup],
  );

  if (isError)
    return (
      <PageState
        state="error"
        message={error instanceof Error ? error.message : 'Could not load holders.'}
      />
    );

  return (
    <Panel bodyPadding="none">
      <DataTable
        tableKey={TABLE_KEYS.toolHolders}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.toolIssueId}
        loading={isLoading}
        empty="No tools are out."
        onRowClick={(r) => onOpen(r.toolIssueId)}
        rowClassName={(r) => (r.isOverdue ? ROW_TINT.late : undefined)}
        rowActionsWidth="1%"
        rowActions={(r) => <RowActions onView={() => onOpen(r.toolIssueId)} />}
      />
    </Panel>
  );
}
