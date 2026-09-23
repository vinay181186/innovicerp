import * as React from 'react';
export interface PrintLine { itemCode: string; itemName?: string; qty: string; uom?: string; rate?: string; amount?: string; }
/**
 * A4 printed document (PO / Service PO / OSP DC / JW DC / GRN): 2px #333 frame, 18px/900 letter-spaced title bar, address + meta row, goods table, totals, notes, signature.
 * @startingPoint section="Print" subtitle="A4 purchase order / challan layout" viewport="820x900"
 */
export interface PrintDocumentProps {
  title?: string;
  company?: { name?: string; gstin?: string; address?: string };
  recipient?: { label?: string; name?: string; lines?: string[] };
  meta?: Array<{ label: string; value: string }>;
  lines?: PrintLine[];
  /** false = qty-only table (DCs, or price-hidden viewers) */
  priced?: boolean;
  totals?: { subtotal: string; taxRows?: Array<{ label: string; value: string }>; grand: string; words?: string };
  notes?: string;
  terms?: string;
  pan?: string;
  testBanner?: boolean;
  logoSrc?: string;
}
export declare function PrintDocument(props: PrintDocumentProps): React.JSX.Element;
