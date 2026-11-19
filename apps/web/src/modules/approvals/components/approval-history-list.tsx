// ADR-265 — Settings → Approvals, Show: Approved / Rejected / Returned. Past decisions on
// the approval types I may decide, 25 rows a page from the server
// (GET /approvals/history), with search and the Approval Type filter.

import type { ApprovalDecision, ApprovalHistoryRow } from '@innovic/shared';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { fmtDate } from '@/lib/date';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { DataTable, type DataTableColumn, Panel } from '@/ui/data';
import { srNoColumn } from '@/ui/data/lead-columns';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { useApprovalHistory } from '../api';
import { approvalHistoryExportSpec, withApprovalHistoryExportValues } from '../lib/export';
import '../approvals.css';
import { ApprovalDocLink } from './approval-doc-link';
import { ALL_TYPES, ApprovalTypeSelect, effectiveType } from './approval-type-select';

const COLUMNS: DataTableColumn<ApprovalHistoryRow>[] = [
  {
    id: 'approval_type',
    header: 'Approval Type',
    kind: 'text',
    nowrap: true,
    className: 'text2',
    render: (r) => r.typeLabel,
  },
  {
    id: 'document',
    header: 'Document',
    kind: 'code',
    stopRowClick: true,
    render: (r) => <ApprovalDocLink code={r.docCode} href={r.docHref} />,
  },
  {
    id: 'request',
    header: 'Request',
    kind: 'text',
    ellipsis: true,
    title: (r) => r.request,
    render: (r) => r.request,
  },
  {
    id: 'decided_by',
    header: 'Decided By',
    kind: 'text',
    ellipsis: true,
    title: (r) => r.decidedByName ?? '',
    render: (r) => r.decidedByName ?? '—',
  },
  {
    id: 'decided_on',
    header: 'Decided On',
    kind: 'date',
    render: (r) => fmtDate(r.decidedAt),
  },
  {
    id: 'reason',
    header: 'Reason',
    kind: 'text',
    ellipsis: true,
    title: (r) => r.reason ?? '',
    render: (r) => r.reason ?? '—',
  },
];

export function ApprovalHistoryList({
  decision,
  showSelect,
  onClearExtra,
}: {
  decision: ApprovalDecision;
  /** The page's Show select, placed before Approval Type. */
  showSelect: ReactNode;
  /** Clear also resets Show → Waiting. */
  onClearExtra: () => void;
}): React.JSX.Element {
  const [page, setPage] = useState(1);
  const [pickedType, setPickedType] = useState(ALL_TYPES);
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState<string | undefined>(undefined);
  useEffect(() => {
    const t = normalizeSearchTerm(term);
    const next = t === '' ? undefined : t;
    if (next === search) return;
    const id = window.setTimeout(() => {
      setSearch(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [term, search]);

  const offset = pageOffset(page);
  const q = useApprovalHistory({
    decision,
    ...(pickedType !== ALL_TYPES ? { type: pickedType } : {}),
    ...(search ? { search } : {}),
    limit: LIST_PAGE_SIZE,
    offset,
  });
  // Sr No leads (owner 2026-11-15) and continues across pages: offset + 1.
  const columns = useMemo(
    () => withApprovalHistoryExportValues([srNoColumn<ApprovalHistoryRow>(offset + 1), ...COLUMNS]),
    [offset],
  );
  const counts = useMemo(() => q.data?.counts ?? [], [q.data?.counts]);
  const allCount = counts.reduce((s, c) => s + c.n, 0);
  const type = q.data ? effectiveType(pickedType, counts) : pickedType;
  // A picked type with no decisions left (search changed it) falls back to All.
  useEffect(() => {
    if (type !== pickedType) setPickedType(type);
  }, [type, pickedType]);
  const total = q.data?.total ?? 0;
  // ADR-310 — the shared Export: every decision matching Show / type / search
  // (the same query the list sends — the picked type, not the fallback).
  const exportType = pickedType !== ALL_TYPES ? pickedType : undefined;
  const exportTypeLabel = counts.find((c) => c.typeKey === exportType)?.typeLabel;
  const exportSpec = useMemo(
    () =>
      approvalHistoryExportSpec({
        columns,
        tableKey: TABLE_KEYS.approvalsHistory,
        decision,
        type: exportType,
        typeLabel: exportTypeLabel,
        search,
      }),
    [columns, decision, exportType, exportTypeLabel, search],
  );
  const onPage = useCallback((p: number) => setPage(p), []);
  useClampPage(page, q.data?.total, onPage);

  const searching = term.trim() !== '';
  return (
    <div className="page-fill">
      <ListHeader
        title="Approvals"
        icon="✅"
        count={q.data ? total : undefined}
        noun="decision"
        filterNote={counts.find((c) => c.typeKey === type)?.typeLabel}
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search document, request, decided by, reason…"
        updating={q.isFetching && !q.isLoading}
        exportSpec={exportSpec}
        filters={
          <>
            {showSelect}
            <ApprovalTypeSelect
              value={type}
              counts={counts}
              total={allCount}
              onChange={(t) => {
                setPickedType(t);
                setPage(1);
              }}
            />
          </>
        }
        onClearFilters={() => {
          setPickedType(ALL_TYPES);
          setTerm('');
          setPage(1);
          onClearExtra();
        }}
        filtersActive
      />
      {q.isError ? (
        <PageState
          state="error"
          message={q.error instanceof Error ? q.error.message : 'Could not load past decisions.'}
        />
      ) : (
        <>
          <Panel fill bodyPadding="none">
            <DataTable
              tableKey={TABLE_KEYS.approvalsHistory}
              columns={columns}
              rows={q.data?.rows ?? []}
              rowKey={(r) => `${r.kind}:${r.id}`}
              loading={q.isLoading}
              // A server page: no browser sort / filter over 25 rows.
              sortFilter={false}
              emptyText={
                searching || type !== ALL_TYPES
                  ? 'No decisions match.'
                  : decision === 'approved'
                    ? 'No approved decisions yet.'
                    : 'No rejected or returned decisions yet.'
              }
            />
          </Panel>
          <ListFooter
            total={total}
            noun="decision"
            page={page}
            pageSize={LIST_PAGE_SIZE}
            onPage={onPage}
          />
        </>
      )}
    </div>
  );
}
