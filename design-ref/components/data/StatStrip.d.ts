import * as React from 'react';
export interface StatStripItem {
  key?: string;
  label: string;
  count: number | string;
  /** Token only, e.g. var(--amber) */
  color?: string;
  sub?: React.ReactNode;
  active?: boolean;
  /** When given the cell is a filter button; omit for read-only totals */
  onClick?: () => void;
}
/**
 * The ONE way to show counts above a list — a single row, hairline dividers, label over mono number.
 * @startingPoint section="Data" subtitle="KPI / filter strip" viewport="700x120"
 */
export interface StatStripProps { items: StatStripItem[]; }
export declare function StatStrip(props: StatStripProps): React.JSX.Element;
