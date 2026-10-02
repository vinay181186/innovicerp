// Who holds what (ADR-193 phase 4b): every tool still out, grouped by holder,
// overdue flagged. Click a row to open its tool issue. On the shared FIT
// DataTable (ADR-199, table standard 2026-10-01) — the holder name shows once
// per group, and an overdue row is washed red (ROW_TINT.late).
//
// ADR-201: 25-row server pages (page in component state — this is a tab of the
// Tool Issue register). The server returns rows in holder order, so a page
// keeps its holder groups together; Sort & Filter (▾) runs on the server.
import { type ToolHolderRow } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { fmtDate } from '@/lib/date';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { DataTable, type DataTableColumn, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, PageState, RowActions } from '@/ui/layout';
import { useToolHolders } from '../api';

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export function ToolHoldersView({ onOpen }: { onOpen: (id: string) => void }): React.JSX.Element {
  const [page, setPage] = useState(1);
  const sf = useServerSortFilter(TABLE_KEYS.toolHolders, () => setPage(1));
  const { data, isLoading, isError, error } = useToolHolders(
    { sf: sf.param, limit: LIST_PAGE_SIZE, offset: pageOffset(page) },
    true,
  );
  const total = data?.total ?? 0;
  useClampPage(page, data?.total, setPage);
  const rows = useMemo(() => data?.items ?? [], [data]);

  // The holder name shows once per run of that holder's rows on this page (the
  // server sends them in holder order; a ▾ sort by another column simply shows
  // the name on every change of holder).
  const firstOfGroup = useMemo(() => {
    const ids = new Set<string>();
    rows.forEach((r, i) => {
      if (i === 0 || rows[i - 1]!.holder !== r.holder) ids.add(r.toolIssueId);
    });
    return ids;
  }, [rows]);

  const columns = useMemo<DataTableColumn<ToolHolderRow>[]>(
    () => [
      {
        id: 'held_by',
        sortFilterField: 'issuedTo',
        kind: 'text',
        header: 'Issued To',
        align: 'left',
        className: 'fw-700',
        render: (r) => (firstOfGroup.has(r.toolIssueId) ? r.holder : ''),
      },
      {
        id: 'item_code',
        sortFilterField: 'itemCode',
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
        sortFilterField: 'serialNos',
        kind: 'code',
        header: 'Instrument Serial No.',
        className: 'mono',
        render: (r) => r.serialNos || '—',
      },
      {
        id: 'still_out',
        sortFilterField: 'stillOutQty',
        kind: 'num',
        header: 'Still Out',
        align: 'right',
        className: 'mono fw-700',
        render: (r) => r3(r.stillOutQty),
      },
      {
        id: 'issue_no',
        sortFilterField: 'code',
        kind: 'code',
        header: 'Issue No.',
        className: 'td-code',
        nowrap: true,
        render: (r) => <span style={{ color: 'var(--cyan)' }}>{r.toolIssueCode}</span>,
      },
      {
        id: 'expected_return',
        sortFilterField: 'expectedReturnDate',
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
    <>
      <Panel bodyPadding="none">
        <DataTable
          tableKey={TABLE_KEYS.toolHolders}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.toolIssueId}
          loading={isLoading}
          sortFilterServer={sf}
          empty={sf.filtering ? 'No tools match.' : 'No tools are out.'}
          onRowClick={(r) => onOpen(r.toolIssueId)}
          rowClassName={(r) => (r.isOverdue ? ROW_TINT.late : undefined)}
          rowActionsWidth="1%"
          rowActions={(r) => <RowActions onView={() => onOpen(r.toolIssueId)} />}
        />
      </Panel>
      <ListFooter
        total={total}
        noun="tool out"
        nounPlural="tools out"
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={setPage}
      />
    </>
  );
}
