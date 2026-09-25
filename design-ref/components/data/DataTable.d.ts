import * as React from 'react';
export interface DataTableColumn {
  header: React.ReactNode;
  key?: string;
  render?: (row: any, index: number) => React.ReactNode;
  /** % width; all widths should sum to 100 (fixed layout, no side-scroll) */
  width?: string;
  /** Default centre. left = names/free text; right = money */
  align?: 'left' | 'center' | 'right';
  /** td class, e.g. 'td-code', 'mono fw-700' */
  className?: string;
  /** Header colour for qty semantics: var(--green) Dispatched/Accepted, var(--red) Balance/Rejected, var(--purple) CPO */
  headColor?: string;
}
/**
 * THE Innovic table — one design (ruled sheet) with behaviour modifiers.
 * @startingPoint section="Data" subtitle="Unified ruled table + modifiers" viewport="700x280"
 */
export interface DataTableProps {
  columns: DataTableColumn[];
  rows: any[];
  /** Pin the first column while scrolling sideways */
  frozen?: boolean;
  /** compact = nested line tables inside an expanded row / card */
  density?: 'regular' | 'compact';
  /** Cells hold inputs/selects (line editors, routing) */
  editable?: boolean;
  /** Auto column widths + side-scroll for very wide registers */
  autoWidth?: boolean;
  onRowClick?: (row: any) => void;
  /** e.g. r => r.overdue ? 'qc-alert-blink' : '' */
  rowClassName?: (row: any) => string;
  maxHeight?: number | string;
  emptyText?: string;
  hint?: string;
  /** @deprecated 'list' renders the legacy unruled look — only for un-migrated screens */
  variant?: 'sheet' | 'list';
}
export declare function DataTable(props: DataTableProps): React.JSX.Element;
