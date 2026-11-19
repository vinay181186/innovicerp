// ADR-310 — the Task Board's shared Export (copies the JWSO pilot).
//
// The Task Board is a row list (one DataTable), not a kanban, so it gets the
// standard Export: one sheet "Task Board", the view's own columns as the user
// sees them, every task matching the tab, search, row filters and column
// sort / filter. Title, Related and Status draw components, so they get plain
// words. No money on tasks.

import type { ListTasksQuery, TaskRow } from '@innovic/shared';
import type { DataTableColumn, ListExportSpec } from '@/ui/data';
import { fetchTasksPage } from '../api';
import { statusPill } from './format';

export function withTaskExportValues(
  columns: DataTableColumn<TaskRow>[],
): DataTableColumn<TaskRow>[] {
  return columns.map((c) => {
    if (c.id === 'title') return { ...c, exportValue: (t: TaskRow) => t.title };
    if (c.id === 'related')
      return { ...c, exportValue: (t: TaskRow) => t.linkedRef?.display ?? '—' };
    if (c.id === 'status') return { ...c, exportValue: (t: TaskRow) => statusPill(t).label };
    return c;
  });
}

export function taskBoardExportSpec(a: {
  columns: DataTableColumn<TaskRow>[];
  tableKey: string;
  query: Omit<ListTasksQuery, 'limit' | 'offset'>;
}): ListExportSpec<TaskRow> {
  const q = a.query;
  const words = [
    `tab ${q.view}`,
    q.status ? `status ${q.status}` : null,
    q.priority ? `priority ${q.priority}` : null,
    q.person ? 'person filter' : null,
    q.assignedBy ? 'assigned-by filter' : null,
    q.due ? `due ${q.due}` : null,
    q.dept ? `department ${q.dept}` : null,
    q.search ? `search "${q.search}"` : null,
    q.sf ? 'column sort / filter applied' : null,
  ].filter((w): w is string => w !== null);
  return {
    fileName: 'Task Board',
    tableKey: a.tableKey,
    columns: a.columns,
    rowKey: (t) => t.id,
    filterSummary: words.join(' · '),
    fetchPage: async (limit, offset) => {
      const res = await fetchTasksPage({ ...q, limit, offset });
      return { items: res.tasks, total: res.total };
    },
  };
}
