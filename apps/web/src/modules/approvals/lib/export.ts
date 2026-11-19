// ADR-310 — the Approvals history list's shared Export (copies the JWSO pilot).
//
// One sheet "Approvals": the decided rows' own columns as the user sees them.
// The Document cell is a link component, so it gets its plain document no.

import type {
  ApprovalDecision,
  ApprovalHistoryListQuery,
  ApprovalHistoryRow,
} from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchApprovalHistoryPage } from '../api';

const DECISION_WORD: Record<ApprovalDecision, string> = {
  approved: 'Approved',
  rejected: 'Rejected',
};

export function withApprovalHistoryExportValues(
  columns: DataTableColumn<ApprovalHistoryRow>[],
): DataTableColumn<ApprovalHistoryRow>[] {
  return columns.map((c) => (c.id === 'document' ? { ...c, exportValue: (r) => r.docCode } : c));
}

export interface ApprovalHistoryExportArgs {
  columns: DataTableColumn<ApprovalHistoryRow>[];
  tableKey: string;
  decision: ApprovalDecision;
  /** The Approval Type key the list sends, undefined = all types. */
  type: string | undefined;
  typeLabel: string | undefined;
  search: string | undefined;
}

export function approvalHistoryExportSpec(
  a: ApprovalHistoryExportArgs,
): ListExportSpec<ApprovalHistoryRow> {
  const words = [
    `Show: ${DECISION_WORD[a.decision]}`,
    a.type ? `Approval Type: ${a.typeLabel ?? a.type}` : null,
    a.search ? `search "${a.search}"` : null,
  ].filter((w): w is string => w !== null);
  const base: Omit<ApprovalHistoryListQuery, 'limit' | 'offset'> = {
    decision: a.decision,
    ...(a.type ? { type: a.type } : {}),
    ...(a.search ? { search: a.search } : {}),
  };
  return {
    fileName: 'Approvals',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (r) => r.id,
    filterSummary: words.join(' · '),
    fetchPage: async (limit, offset) => {
      const res = await fetchApprovalHistoryPage({ ...base, limit, offset });
      return { items: res.rows, total: res.total };
    },
  };
}
