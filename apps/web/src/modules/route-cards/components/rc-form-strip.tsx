// Route Card Create / Edit — the ONE-LINE summary of the header, shown in its
// place when the planner presses "▴ Hide details" (owner-approved mock-up
// "Route Card — Collapsible Header", 2026-11-17; same pattern as the Job Card
// detail page's jc-fact-strip.tsx). Read-only: every figure is one the header
// already holds — nothing is computed here. To change one, "▾ Show details".
//
// A header fact that stops Save (no Item Code, a Drawing Rev problem) shows in
// red, so the planner sees WHERE to look; the message itself stays on the Save
// row, which is always on screen.
import { itemCodeWithRev } from '@/lib/item-code';

function Fig({
  k,
  v,
  bad = false,
  dim = false,
}: {
  k: string;
  v: React.ReactNode;
  bad?: boolean;
  dim?: boolean;
}): React.JSX.Element {
  return (
    <span className="rc-strip-f">
      <span className="rc-strip-k">{k}</span>
      <b className={bad ? 'rc-strip-bad' : dim ? 'rc-strip-dim' : undefined}>{v}</b>
    </span>
  );
}

export function RcFormStrip({
  code,
  itemCode,
  drawingRev,
  itemName,
  planTypeLabel,
  opCount,
  inHouseCount,
  ospCount,
  qcCount,
  rmItemCode,
  rmGrade,
  rmSize,
  rmQtyPerPiece,
  itemMissing,
  revBad,
  onShowDetails,
}: {
  code: string;
  itemCode: string;
  drawingRev: string;
  itemName: string;
  planTypeLabel: string;
  opCount: number;
  inHouseCount: number;
  ospCount: number;
  qcCount: number;
  rmItemCode: string | null;
  rmGrade: string | null;
  rmSize: string | null;
  rmQtyPerPiece: string;
  /** Save is off because no item is picked. */
  itemMissing: boolean;
  /** Save is off because of the Drawing Rev. */
  revBad: boolean;
  onShowDetails: () => void;
}): React.JSX.Element {
  const d = '—';
  const rev = drawingRev.trim().toUpperCase();
  const codeRev = itemCode ? itemCodeWithRev(itemCode, rev || null) : d;
  const rmRest = [rmGrade, rmSize, rmQtyPerPiece.trim() ? `${rmQtyPerPiece.trim()}/pc` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="rc-strip" role="group" aria-label="Route Card summary">
      {/* The figures give way on a narrow screen; the end button sits outside
          them, because ▾ Show details is the only way back. */}
      <div className="rc-strip-figs">
        <Fig k="RC No." v={code || d} dim />
        <Fig k="Item Code" v={codeRev} bad={itemMissing || revBad} />
        {itemName ? (
          <span className="rc-strip-f rc-strip-item">
            <span className="rc-strip-k">Item Name</span>
            <span className="rc-strip-name" title={itemName}>
              {itemName}
            </span>
          </span>
        ) : null}
        <span className="rc-strip-sep" />
        <span className="rc-strip-f">
          <span className="rc-strip-k">Plan Type</span>
          <span className="rc-strip-txt">{planTypeLabel}</span>
        </span>
        <span
          className="rc-strip-f"
          title={
            opCount > 0
              ? `${opCount} · ${inHouseCount} in-house · ${ospCount} OSP · ${qcCount} QC`
              : undefined
          }
        >
          <span className="rc-strip-k">Operations</span>
          <b>{opCount}</b>
          {opCount > 0 ? (
            <span className="rc-strip-split">
              {inHouseCount} in-house · {ospCount} OSP · {qcCount} QC
            </span>
          ) : null}
        </span>
        <span className="rc-strip-sep" />
        <span className="rc-strip-f">
          <span className="rc-strip-k">RM</span>
          <b>{rmItemCode || d}</b>
          {rmRest ? <span className="rc-strip-split">{rmRest}</span> : null}
        </span>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onShowDetails}>
        ▾ Show details
      </button>
    </div>
  );
}
