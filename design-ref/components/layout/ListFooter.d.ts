import * as React from 'react';
/** Count line under every list (scroll mode or Prev/Next mode — never both) + 💡 hint + optional Excel template/import buttons. */
export interface ListFooterProps {
  total: number;
  /** Rows shown after a client-side filter */
  shown?: number;
  noun?: string;
  /** Scroll-mode fetch cap (1000 for SO, 200 for JC/PO/JWSO) */
  limit?: number;
  /** Set to switch to Prev/Next pager mode (unbounded registers only) */
  page?: number;
  pageSize?: number;
  onPage?: (p: number) => void;
  /** Interaction hint, e.g. "Click a row to open it." */
  hint?: React.ReactNode;
  /** ⬇ Download Excel Template / 📄 Import from Excel */
  actions?: React.ReactNode;
}
export declare function ListFooter(props: ListFooterProps): React.JSX.Element;
