import * as React from 'react';
/** Maps any Innovic status enum to its canonical badge tone, per the product's per-module *StatusBadge files. */
export interface StatusBadgeProps {
  /** so · jc · grn (QC Pending/Cleared, Against PO/DC/NC) · task · run (running op) · active (Active/Inactive) · rating (⭐A–D) · · jcop (JC operation) · pr · po · prodorder · grnqc · dc · nc · ncdisp · txn · doc (related-docs generic) */
  kind?: 'so' | 'jc' | 'jcop' | 'pr' | 'po' | 'prodorder' | 'grnqc' | 'grn' | 'dc' | 'nc' | 'ncdisp' | 'txn' | 'task' | 'run' | 'active' | 'rating' | 'doc';
  /** Enum value, e.g. "qc_pending" or "QC Pending" */
  status: string;
  /** Override the rendered text */
  label?: string;
}
export declare function StatusBadge(props: StatusBadgeProps): React.JSX.Element;
/** Task priority as coloured text (Urgent red2/700 · High amber2/700 · Normal text2 · Low text3). */
export interface PriorityTextProps { priority?: 'urgent' | 'high' | 'normal' | 'low' | string; }
export declare function PriorityText(props: PriorityTextProps): React.JSX.Element;
