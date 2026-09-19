// Job Card VIEW page — the header tile (part · references · quantity tiles ·
// status) and the collapsible Route / Operation Flow panel, laid out to the
// 2026-09-18 mockup. VIEW mode only: the EDIT page keeps JcStatTiles.
//
// Every figure here is one the page already showed — same hooks, same rows —
// re-arranged. The two tiles the old summary did not roll up (WIP and
// Rejected (NC)) are derived below from the enriched op rows that are already
// loaded for the operation cards; how, and why that number, is on each one.
//
// Tokens only (tokens.css) — no hex, no rgba.
import type {
  JcOpEnriched,
  JobCardListItem,
  JobCardRmAvailable,
  JobCardStatusOpExtra,
} from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { itemCodeWithRev } from '@/lib/item-code';
import { resolveActualMachine } from '@/components/shared/machine-split';
import { JcOpFlowChips } from './jc-stat-tiles';
import { JcStatusBadge } from './jc-status-badge';
import { fmtJcDate } from '../lib/fmt-jc-date';

/** The quiet caption in front of a value (`Part Code`, `Due Date`, …). */
const kvLabel: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
  whiteSpace: 'nowrap',
};
/** Code links (route card, SO, production order) — mono, strong, blue. */
const codeLink: React.CSSProperties = {
  color: 'var(--blue)',
  textDecoration: 'none',
  fontSize: 13,
};

/** A `label   value` pair on the two-column key/value grids. */
function Kv({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <>
      <div style={kvLabel}>{label}</div>
      <div style={{ minWidth: 0, fontSize: 13, color: 'var(--text)' }}>{children}</div>
    </>
  );
}

/** One quantity tile — number, caption over it, unit under it. */
function QtyBox({
  label,
  value,
  unit,
  color,
  bg,
  border,
  title,
}: {
  label: string;
  value: React.ReactNode;
  unit: string;
  color: string;
  bg: string;
  border: string;
  title?: string;
}): React.JSX.Element {
  return (
    <div
      title={title}
      style={{
        minWidth: 84,
        padding: '8px 10px',
        textAlign: 'center',
        borderRadius: 8,
        background: bg,
        border: `1px solid ${border}`,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 700, color, whiteSpace: 'nowrap' }}>{label}</div>
      <div className="mono" style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1.15 }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text3)' }}>{unit}</div>
    </div>
  );
}

/** "Where the job is stuck" — the lowest-seq op not yet complete. Its op_type
 *  gives the QC / Outsource / machine distinction. No server field for this;
 *  derived on the client from the enriched ops (unchanged from JcStatTiles). */
export function currentOp(sortedOps: JcOpEnriched[]): JcOpEnriched | undefined {
  return sortedOps.find((o) => o.computedStatus !== 'complete');
}

/** Which drawing the page shows (resolved in jc-status-view.tsx — SO line, JW
 *  line, this card's own upload, or the item master, first that exists). */
export interface JcDrawingRef {
  /** Which drawing this is and its revision ("Sales order drawing · Rev B",
   *  "Item master · IN-IT-0007"). The card carries no drawing NUMBER, so the
   *  page never labels an SO / item code as one. */
  label: string;
  /** The uploaded file's own name (upload stamp stripped) — the only handle a
   *  PDF / DWG drawing has on the page. */
  fileName: string;
  /** A thumbnail URL when the file is an image; PDFs / DWGs have none. */
  thumbUrl: string | null;
}

export function JcViewSummary({
  jc,
  ops,
  opsLoaded,
  sortedOps,
  rmAvailable,
  drawing,
  onOpenDrawing,
}: {
  jc: JobCardListItem;
  ops: JcOpEnriched[];
  /** False while the enriched ops are still on their way — the two derived
   *  tiles (WIP, Rejected) show "—" then rather than a zero that means nothing. */
  opsLoaded: boolean;
  sortedOps: JcOpEnriched[];
  /** ADR-103 client material still workable on this JWSO Job Card. Null/absent
   *  on SO-sourced and pre-cutover Job Cards — the RM line is then not shown. */
  rmAvailable?: JobCardRmAvailable | null;
  drawing: JcDrawingRef | null;
  /** Opens the shared drawing preview — from the `👁 Open drawing` button on
   *  the Drawing row, the thumbnail (image drawings only), or the Documents
   *  tab's Drawing card. */
  onOpenDrawing: () => void;
}): React.JSX.Element {
  // ── Quantity tiles ──
  // Completed / Pending are the figures the old summary showed: completed =
  // the LAST op's done qty (finished goods are counted only after the last
  // op), pending = order − that.
  const completed = jc.lastOpCompletedQty;
  const pending = Math.max(0, jc.orderQty - completed);
  // WIP = pieces that have entered the shop floor but are not yet through the
  // last op. A piece enters when the FIRST op releases it, so
  //   WIP = max(0, first-op done − last-op completed)
  // using the same enriched rows the operation cards read (first op's done =
  // QC accepted on a QC op, completedQty otherwise — the DONE tile's rule).
  // A single-op card gives 0 by construction (first op = last op).
  const first = sortedOps[0];
  const firstDone = first ? (first.opType === 'qc' ? first.qcAcceptedQty : first.completedQty) : 0;
  // Pieces scrapped mid-route left the first op's "done" count but will never
  // reach the last op — they are Rejected (NC), not WIP. Subtract them so a
  // scrapped piece is not counted in both tiles (review 2026-09-18). Open NCs
  // stay in WIP: their pieces can still be reworked back into the route.
  const scrapped = ops.reduce((s, o) => s + o.ncBreakup.scrapQty, 0);
  // "—" only while the rows are still loading; a loaded card with no ops has
  // nothing in progress, and says 0.
  const wip = !opsLoaded ? null : first ? Math.max(0, firstDone - completed - scrapped) : 0;
  // Rejected (NC) = pieces rejected and NOT recovered, summed over every op
  // from v_nc_op_breakup (op.ncBreakup): ncOpenQty (rejected − cleared −
  // failed on the NCs still open) + scrapQty (closed as scrap, gone for good).
  // NOT Σ qcRejectedQty — that is every rejection ever raised, and a piece
  // reworked and accepted since would then be counted here AND in Completed.
  const rejected = opsLoaded
    ? ops.reduce((s, o) => s + o.ncBreakup.ncOpenQty + o.ncBreakup.scrapQty, 0)
    : null;
  const openNcCount = ops.reduce((s, o) => s + o.ncBreakup.openNcCount, 0);

  // ── Status line ──
  const stuck = currentOp(sortedOps);
  const stuckWhere = stuck
    ? stuck.opType === 'qc'
      ? 'QC'
      : stuck.opType === 'outsource'
        ? 'Outsource'
        : (stuck.machineCode ?? stuck.machineCodeText ?? stuck.operation)
    : null;
  // ADR-164 — the location above is the PLANNED machine. If the op is open on a
  // different machine right now, say where the pieces are actually being made.
  const stuckRunningOn =
    stuck && stuck.opType === 'process' && stuck.activeRunningMachineCode
      ? resolveActualMachine({
          planned: stuck.machineCode ?? stuck.machineCodeText,
          activeRunningMachineCode: stuck.activeRunningMachineCode,
        })
      : null;

  const src = jc.sourceLink;

  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <div
        className="panel-body"
        style={{
          display: 'flex',
          gap: 22,
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          padding: '12px 16px',
        }}
      >
        {/* ── Thumbnail — only when the drawing is an image (a PDF has none);
            click opens the same preview the Documents tab's Drawing card does.
            Never `download`: opening a thumbnail is nobody keeping a copy. ── */}
        {drawing?.thumbUrl ? (
          <button
            type="button"
            onClick={onOpenDrawing}
            title={`Open this drawing — ${drawing.label}`}
            style={{
              background: 'none',
              border: '1px solid var(--border2)',
              borderRadius: 8,
              padding: 2,
              cursor: 'pointer',
              flex: '0 0 auto',
              lineHeight: 0,
            }}
          >
            <img
              src={drawing.thumbUrl}
              alt={`${drawing.label} drawing`}
              style={{ maxHeight: 84, maxWidth: 120, borderRadius: 6, display: 'block' }}
            />
          </button>
        ) : null}

        {/* ── Zone 1: the part ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto minmax(0, 1fr)',
            columnGap: 14,
            rowGap: 4,
            alignItems: 'baseline',
            minWidth: 220,
            flex: '1 1 240px',
          }}
        >
          {/* The revision is the CUSTOMER'S drawing revision off the SO line, so
              the code reads `IN-IT-0007/B` on a card raised against an SO and
              stays the bare `IN-IT-0007` on a JW-sourced or standalone card.
              One string from the shared helper, same as the Sales Order screens. */}
          <Kv label="Part Code">
            <span
              className="mono fw-700"
              style={{ fontSize: 14, color: 'var(--text)' }}
              title={itemCodeWithRev(jc.itemCode, jc.itemRevision)}
            >
              {itemCodeWithRev(jc.itemCode, jc.itemRevision)}
            </span>
          </Kv>
          <Kv label="Part Name">
            <span className="fw-700" style={{ overflowWrap: 'anywhere' }}>
              {jc.itemName || '—'}
            </span>
          </Kv>
          {/* Raw material planned for this job card — the grade text and the
              size text, both optional. (The card's remarks live on the
              Remarks tab below.) */}
          <Kv label="Material">
            <span className="mono fw-700">{jc.rawMaterialGradeText || '—'}</span>
          </Kv>
          <Kv label="Size">
            <span className="mono fw-700">{jc.rawMaterialSizeText || '—'}</span>
          </Kv>
        </div>

        {/* ── Zone 2: the references ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto minmax(0, 1fr)',
            columnGap: 14,
            rowGap: 4,
            alignItems: 'baseline',
            minWidth: 220,
            flex: '1 1 240px',
          }}
        >
          {/* Drawing — WHICH drawing the page shows ("Sales order drawing ·
              Rev B"), the open button, and the file name for a PDF / DWG (an
              image drawing shows its thumbnail instead). Not "Drawing No.":
              the card has no drawing-number field, and an SO / item code
              labelled as one could be read as the print number. */}
          <Kv label="Drawing">
            {drawing ? (
              <>
                <span
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                >
                  <span className="fw-700" style={{ color: 'var(--text)' }}>
                    {drawing.label}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={onOpenDrawing}
                    title={`Open this drawing — ${drawing.fileName}`}
                  >
                    👁 Open drawing
                  </button>
                </span>
                {drawing.thumbUrl ? null : (
                  <div
                    style={{ fontSize: 11, color: 'var(--text2)', overflowWrap: 'anywhere' }}
                    title={drawing.fileName}
                  >
                    📄 {drawing.fileName} — open it to view
                  </div>
                )}
              </>
            ) : (
              '—'
            )}
          </Kv>
          <Kv label={src?.type === 'jw' ? 'JW No. / Line' : 'SO No. / Line'}>
            {src ? (
              <>
                {src.type === 'so' ? (
                  <Link
                    to="/sales-orders/$id"
                    params={{ id: src.salesOrderId }}
                    className="mono fw-700"
                    style={codeLink}
                  >
                    {src.code}
                  </Link>
                ) : (
                  <Link
                    to="/job-work-orders/$id"
                    params={{ id: src.jobWorkOrderId }}
                    className="mono fw-700"
                    style={codeLink}
                  >
                    {src.code}
                  </Link>
                )}
                <span style={{ color: 'var(--text3)' }}> / </span>
                <b>{src.lineNo}</b>
              </>
            ) : (
              '—'
            )}
          </Kv>
          {/* The customer behind the source order — the row is dropped, not
              dashed, when the card has no source / no customer. */}
          {jc.customerName ? (
            <Kv label="Customer">
              <span style={{ overflowWrap: 'anywhere' }}>{jc.customerName}</span>
            </Kv>
          ) : null}
          {/* Route Card reference (the item's active route card + revision).
              The card carries the CODE only, so the link opens the Route Cards
              list searched for it rather than a detail page it has no id for. */}
          <Kv label="Route Card">
            {jc.routeCardCode ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Link
                  to="/route-cards"
                  search={{ search: jc.routeCardCode }}
                  className="mono fw-700"
                  style={codeLink}
                  title="Open the Route Cards list on this route card"
                >
                  {jc.routeCardCode}
                </Link>
                {jc.routeCardRevision != null ? (
                  <span className="badge b-blue" style={{ fontSize: 9 }}>
                    Rev {jc.routeCardRevision}
                  </span>
                ) : null}
              </span>
            ) : (
              <span style={{ color: 'var(--amber)' }}>none</span>
            )}
          </Kv>
          {/* ADR-170 — the Production Order that built this card. Only such a
              card is credited to stock at PO close (never at last-op QC or an
              OSP GRN), so the link is the operator's cue for where "finished"
              actually lands. Old cards carry null and show a dash. The
              customer's PO line (CPO Ln) sits beside it, as before. */}
          <Kv label="Prod. Order">
            {jc.productionOrderId && jc.productionOrderCode ? (
              <Link
                to="/production-orders/$id"
                params={{ id: jc.productionOrderId }}
                className="mono fw-700"
                style={codeLink}
              >
                {jc.productionOrderCode}
              </Link>
            ) : (
              '—'
            )}
            {jc.clientPoLineNo ? (
              <span className="mono fw-700" style={{ color: 'var(--purple)', fontSize: 12 }}>
                {' · '}CPO Ln {jc.clientPoLineNo}
              </span>
            ) : null}
          </Kv>
        </div>

        {/* ── Zone 3: quantity tiles (unit = pieces, as the old "Quantity (pcs)"
            caption said; the card carries no unit of its own) ── */}
        <div style={{ flex: '0 0 auto' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <QtyBox
              label="Order Qty"
              value={jc.orderQty}
              unit="pcs"
              color="var(--text)"
              bg="var(--bg2)"
              border="var(--border2)"
            />
            <QtyBox
              label="Completed"
              value={completed}
              unit="pcs"
              color="var(--green2)"
              bg="var(--green3)"
              border="var(--green)"
              title="Pieces through the LAST operation — finished goods are counted only after the last op"
            />
            <QtyBox
              label="WIP"
              value={wip ?? '—'}
              unit="pcs"
              color="var(--blue2)"
              bg="var(--blue3)"
              border="var(--blue)"
              title="Pieces released by the first operation and not yet through the last one (first-op done − completed)"
            />
            <QtyBox
              label="Rejected (NC)"
              value={rejected ?? '—'}
              unit="pcs"
              color="var(--red2)"
              bg="var(--red3)"
              border="var(--red)"
              title={
                `Pieces rejected and not recovered: still open on an NC or scrapped, summed over every operation.` +
                (openNcCount > 0 ? ` ${openNcCount} NC(s) open.` : '')
              }
            />
            <QtyBox
              label="Pending"
              value={pending}
              unit="pcs"
              color={pending > 0 ? 'var(--amber2)' : 'var(--green2)'}
              bg={pending > 0 ? 'var(--amber3)' : 'var(--green3)'}
              border={pending > 0 ? 'var(--amber)' : 'var(--green)'}
              title="Order qty − completed"
            />
          </div>
          {/* ADR-103 — client material still workable on this job card. */}
          {rmAvailable ? (
            <div
              style={{
                marginTop: 6,
                fontSize: 11,
                color: rmAvailable.availableQty > 0 ? 'var(--text2)' : 'var(--red)',
                fontWeight: rmAvailable.availableQty > 0 ? 400 : 700,
              }}
              title={
                `Client material issued to this job card: ${rmAvailable.issuedQty}. ` +
                `Already produced on the first operation: ${rmAvailable.consumedQty}. ` +
                (rmAvailable.availableQty > 0
                  ? `${rmAvailable.availableQty} can still be worked.`
                  : 'Issue more client material from Party Material Issue to continue.')
              }
            >
              RM avail <span className="mono fw-700">{rmAvailable.availableQty}</span>
              {rmAvailable.availableQty === 0
                ? ' · issue material'
                : ` of ${rmAvailable.issuedQty} issued`}
            </div>
          ) : null}
        </div>

        {/* ── Zone 4: priority · overall status · where it is waiting ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto auto',
            columnGap: 12,
            rowGap: 8,
            alignItems: 'center',
            alignContent: 'start',
            flex: '0 0 auto',
            marginLeft: 'auto',
          }}
        >
          <div style={kvLabel}>Due Date</div>
          <div className="fw-700" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
            📅 {jc.dueDate ? fmtJcDate(jc.dueDate) : '—'}
          </div>
          <div style={kvLabel}>Priority</div>
          <div>
            <span className={`badge ${jc.priority === 'high' ? 'b-amber' : 'b-grey'}`}>
              {jc.priority === 'high' ? '↑ High' : 'Normal'}
            </span>
          </div>
          <div style={kvLabel}>Overall Status</div>
          <div>
            <JcStatusBadge status={jc.computedStatus} />
          </div>
          <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--text2)' }}>
            {stuck ? (
              <>
                Waiting at <b>Op{opSrNo(stuck.opSeq)}</b> · {stuckWhere}
                {stuckRunningOn?.differs ? (
                  <>
                    {' '}
                    · running on <b style={{ color: 'var(--amber)' }}>{stuckRunningOn.label}</b>
                  </>
                ) : null}
              </>
            ) : (
              'All operations complete'
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Collapsible section header used by Route / Operation Flow and Operations
 *  Details — a ▾/▸ toggle on the left, whatever the section wants on the right. */
export function SectionBar({
  title,
  open,
  onToggle,
  right,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  right?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="panel-hdr" style={{ borderBottom: open ? '1px solid var(--border)' : 'none' }}>
      <button
        type="button"
        onClick={onToggle}
        className="panel-title"
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          color: 'var(--blue2)',
        }}
      >
        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {right ? <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>{right}</div> : null}
    </div>
  );
}

export function JcRouteFlowPanel({
  jc,
  ops,
  sortedOps,
  opExtraById,
  open,
  onToggle,
}: {
  jc: JobCardListItem;
  ops: JcOpEnriched[];
  sortedOps: JcOpEnriched[];
  opExtraById: Map<string, JobCardStatusOpExtra>;
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const totalOps = ops.length;
  const doneOps = ops.filter((o) => o.computedStatus === 'complete').length;
  const pct = totalOps > 0 ? Math.round((doneOps / totalOps) * 100) : 0;
  const cur = currentOp(sortedOps);
  const next = cur ? sortedOps[sortedOps.indexOf(cur) + 1] : undefined;
  const opName = (o: JcOpEnriched | undefined): React.ReactNode =>
    o ? (
      <>
        <b className="mono">OP{opSrNo(o.opSeq)}</b> -{' '}
        {o.opType === 'qc'
          ? 'QC'
          : o.opType === 'outsource'
            ? 'OUTSOURCE'
            : (o.machineCode ?? o.machineCodeText ?? o.operation)}
      </>
    ) : (
      '—'
    );
  return (
    <div className="panel" style={{ marginBottom: 10 }}>
      <SectionBar title="Route / Operation Flow" open={open} onToggle={onToggle} />
      {open ? (
        <div
          className="panel-body"
          style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}
        >
          <div style={{ flex: '1 1 420px', minWidth: 0 }}>
            <JcOpFlowChips jc={jc} sortedOps={sortedOps} opExtraById={opExtraById} stateIcons />
          </div>
          {/* Overall Progress — the old Route Progress row, boxed. */}
          <div
            style={{
              flex: '0 0 280px',
              padding: '10px 12px',
              borderLeft: '1px solid var(--border)',
              fontSize: 12,
              color: 'var(--text2)',
            }}
          >
            <div className="fw-700" style={{ fontSize: 13, color: 'var(--text)', marginBottom: 8 }}>
              Overall Progress
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="prog-wrap" style={{ height: 8, flex: 1 }}>
                <div
                  className="prog-bar"
                  style={{ width: `${pct}%`, background: 'var(--green)' }}
                />
              </div>
              <b className="mono" style={{ color: 'var(--green2)', fontSize: 13 }}>
                {pct}%
              </b>
            </div>
            <div style={{ marginTop: 8 }}>
              {doneOps} of {totalOps} operations complete
            </div>
            <div style={{ marginTop: 4 }}>Current Operation : {opName(cur)}</div>
            <div style={{ marginTop: 4 }}>Next Operation : {opName(next)}</div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text3)' }}>
              Finished goods counted only after the last op
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
