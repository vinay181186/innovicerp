// Job Card detail — the ONE-LINE summary of the fact block (owner-approved
// mock-up "Option 4 — combined page scroll + collapsible header", 2026-11-02).
//
// Shown in the sticky band above the tabs when the fact block is collapsed,
// or when the page has been scrolled past it. Every figure is the same one the
// fact block shows: Order Qty is the card's own qty, the rest is the SERVER's
// Job Card check (GET /flow-views/job-cards/:id/op-flow → jobCardCheck).
// Nothing is computed here.
import type { JobCardListItem, ProductionOrderListItem } from '@innovic/shared';
import { fmtDate } from '@/lib/date';
import { docDrawingRev, itemCodeWithRev } from '@/lib/item-code';
import type { OpFlowResponse } from '@/modules/flow-views/types';

type JobCardCheck = OpFlowResponse['jobCardCheck'];

function Fig({
  k,
  v,
  tone = '',
}: {
  k: string;
  v: React.ReactNode;
  tone?: string;
}): React.JSX.Element {
  return (
    <span className="jc-strip-f">
      <span className="jc-strip-k">{k}</span>
      <b className={tone}>{v}</b>
    </span>
  );
}

export function JcFactStrip({
  jc,
  productionOrder,
  check,
  collapsed,
  onShowDetails,
  onTop,
}: {
  jc: JobCardListItem;
  productionOrder: ProductionOrderListItem | null;
  check: JobCardCheck | undefined;
  /** Collapsed: the end button is "▾ Show details"; else "↑ Top". */
  collapsed: boolean;
  onShowDetails: () => void;
  onTop: () => void;
}): React.JSX.Element {
  const codeRev = itemCodeWithRev(jc.itemCode, docDrawingRev(jc));
  const q = check;
  const d = '—';
  return (
    <div className="jc-strip" role="group" aria-label="Job Card summary">
      <b className="mono jc-strip-code">{jc.code}</b>
      <b className="mono jc-strip-code">{codeRev}</b>
      {jc.itemName ? (
        <span className="jc-strip-name" title={jc.itemName}>
          {jc.itemName}
        </span>
      ) : null}
      <span className="jc-strip-sep" />
      {productionOrder ? <Fig k="PRO" v={productionOrder.code} /> : null}
      <Fig k="Due" v={jc.dueDate ? fmtDate(jc.dueDate) : d} />
      <span className="jc-strip-sep" />
      <Fig k="Order Qty" v={jc.orderQty} />
      <Fig k="Pending at Ops" v={q ? q.pending : d} />
      <Fig k="At Vendor" v={q ? q.atVendor : d} />
      <Fig
        k="Deviated (NC open)"
        v={q ? q.deviatedOpen : d}
        tone={q && q.deviatedOpen > 0 ? 'jc-amber' : ''}
      />
      <Fig k="Rejected" v={q ? q.rejected : d} tone={q && q.rejected > 0 ? 'jc-red' : ''} />
      <Fig k="Completed" v={q ? q.finished : d} tone="jc-yes" />
      <span className="jc-strip-gap" />
      {collapsed ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onShowDetails}>
          ▾ Show details
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          title="Back to the top of the page"
          onClick={onTop}
        >
          ↑ Top
        </button>
      )}
    </div>
  );
}
