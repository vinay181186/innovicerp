// Job Card VIEW page — the header tile (product picture · references · KPI
// tiles · due / priority / status) and the collapsible Route / Operation Flow
// panel, laid out to the approved 2026-09-21 restyle
// (JC-Detail-Restyle-Mockup.html, Part A). VIEW mode only: the EDIT page keeps
// JcStatTiles.
//
// STYLING ONLY. Every figure here is one the page already showed — same hooks,
// same rows — re-arranged. The two tiles the old summary did not roll up (WIP
// and Rejected (NC)) are derived below from the enriched op rows that are
// already loaded for the operation cards; how, and why that number, is on
// each one.
//
// Responsive without a stylesheet: the header is a wrapping flex row whose
// four columns carry flex-bases (280 px picture+text · 240 references ·
// 430 KPIs · meta ≈ 190, gaps 16 — under 1240 px, so a 1280 px laptop keeps
// them on one line with all five KPI tiles across),
// so on a narrow screen the columns fold under one another instead of
// squeezing; the KPI tiles are an auto-fit grid that goes 5 → 3 → 2 across
// on their own. No media query, no <style> tag.
//
// Tokens only (tokens.css) — no hex.
import type {
  JcOpEnriched,
  JobCardListItem,
  JobCardRmAvailable,
  JobCardStatusOpExtra,
} from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { ItemBadge } from '@/components/shared/item-badge';
import { resolveActualMachine } from '@/components/shared/machine-split';
import { JcOpFlowCards } from './jc-stat-tiles';
import { JcStatusBadge } from './jc-status-badge';
import { fmtJcDate } from '../lib/fmt-jc-date';

/** The quiet caption in front of a value (`Drawing`, `Due Date`, …). */
const kvLabel: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text3)',
  whiteSpace: 'nowrap',
};
/** Code links (route card, SO, production order) — mono, strong, blue. */
const codeLink: React.CSSProperties = {
  color: 'var(--blue)',
  textDecoration: 'none',
  fontSize: 12,
};

/** A `label   value` pair on the two-column key/value grids. */
function Kv({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <>
      <div style={kvLabel}>{label}</div>
      <div style={{ minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
        {children}
      </div>
    </>
  );
}

/** One KPI tile — big mono number over a small uppercase caption. `tone`
 *  only tints it (background, border, number colour); the size never moves. */
function KpiTile({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: React.ReactNode;
  tone: 'plain' | 'green' | 'blue' | 'red' | 'amber';
  title?: string;
}): React.JSX.Element {
  const bg =
    tone === 'green'
      ? 'var(--green3)'
      : tone === 'blue'
        ? 'var(--blue3)'
        : tone === 'red'
          ? 'var(--red3)'
          : tone === 'amber'
            ? 'var(--amber3)'
            : 'var(--bg2)';
  const border =
    tone === 'green'
      ? 'var(--green)'
      : tone === 'blue'
        ? 'var(--blue)'
        : tone === 'red'
          ? 'var(--red)'
          : tone === 'amber'
            ? 'var(--amber)'
            : 'var(--border)';
  const num =
    tone === 'green'
      ? 'var(--green)'
      : tone === 'red'
        ? 'var(--red)'
        : tone === 'amber'
          ? 'var(--amber)'
          : 'var(--text)';
  return (
    <div
      title={title}
      style={{
        border: `1px solid ${border}`,
        borderRadius: 9,
        padding: '9px 10px',
        textAlign: 'center',
        background: bg,
        minWidth: 0,
      }}
    >
      <div className="mono" style={{ fontSize: 22, fontWeight: 800, color: num, lineHeight: 1.1 }}>
        {value}
      </div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--text3)',
          marginTop: 3,
          textTransform: 'uppercase',
          letterSpacing: '.05em',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
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
  /** Opens the shared drawing preview — from the `👁 Open drawing` button
   *  under the product picture, the drawing thumbnail (image drawings only),
   *  or the Documents tab's Drawing card. */
  onOpenDrawing: () => void;
}): React.JSX.Element {
  // ── KPI tiles ──
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
    <div className="panel" style={{ marginBottom: 12 }}>
      <div
        className="panel-body"
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          padding: '14px 16px',
        }}
      >
        {/* ── Column 1: the product ──
            The Item Master's 3D render in the shared badge (user decision
            2026-09-21), code + name BESIDE it with the raw material planned
            for this card (grade text and size text, both optional) right
            under the name, then the drawing controls. The revision on the
            code is the CUSTOMER'S drawing revision off the SO line, so it
            reads `IN-IT-0007/B` on a card raised against an SO and stays the
            bare `IN-IT-0007` on a JW-sourced or standalone card — one string
            from the shared helper, same as the Sales Order screens. */}
        <div style={{ flex: '0 1 280px', minWidth: 0 }}>
          <ItemBadge
            size="tile"
            code={jc.itemCode}
            name={jc.itemName}
            revision={jc.itemRevision}
            imagePath={jc.itemImagePath}
            codeColor="var(--text)"
            nameMaxWidth="none"
          >
            <div style={{ marginTop: 6, fontSize: 12.5, lineHeight: 1.5 }}>
              <div style={{ display: 'flex', gap: 6, minWidth: 0 }}>
                <span style={{ color: 'var(--text3)', flexShrink: 0 }}>Material:</span>
                <span
                  className="mono fw-700"
                  style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  title={jc.rawMaterialGradeText || undefined}
                >
                  {jc.rawMaterialGradeText || '—'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6, minWidth: 0 }}>
                <span style={{ color: 'var(--text3)', flexShrink: 0 }}>Size:</span>
                <span
                  className="mono fw-700"
                  style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  title={jc.rawMaterialSizeText || undefined}
                >
                  {jc.rawMaterialSizeText || '—'}
                </span>
              </div>
            </div>
          </ItemBadge>
          {/* Drawing controls — the open button, and the thumbnail when the
              drawing is an image (a PDF has none); both open the same preview
              the Documents tab's Drawing card does. Never `download`: opening
              a thumbnail is nobody keeping a copy. */}
          {drawing ? (
            <div
              style={{
                marginTop: 6,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 6,
              }}
            >
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onOpenDrawing}
                title={`Open this drawing — ${drawing.fileName}`}
              >
                👁 Open drawing
              </button>
              {drawing.thumbUrl ? (
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
                    lineHeight: 0,
                  }}
                >
                  <img
                    src={drawing.thumbUrl}
                    alt={`${drawing.label} drawing`}
                    style={{ maxHeight: 56, maxWidth: 116, borderRadius: 6, display: 'block' }}
                  />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* ── Column 2: the references ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto minmax(0, 1fr)',
            columnGap: 14,
            rowGap: 5,
            alignItems: 'baseline',
            alignContent: 'start',
            minWidth: 0,
            flex: '1 1 240px',
          }}
        >
          {/* Drawing — WHICH drawing the page shows ("Sales order drawing ·
              Rev B") and the file name for a PDF / DWG (an image drawing
              shows its thumbnail under the product picture instead). Not
              "Drawing No.": the card has no drawing-number field, and an SO /
              item code labelled as one could be read as the print number. */}
          <Kv label="Drawing">
            {drawing ? (
              <>
                <span className="fw-700" style={{ color: 'var(--text)' }}>
                  {drawing.label}
                </span>
                {drawing.thumbUrl ? null : (
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 400,
                      color: 'var(--text2)',
                      overflowWrap: 'anywhere',
                    }}
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
                  <span className="badge b-grey" style={{ fontSize: 9, padding: '1px 7px' }}>
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

        {/* ── Column 3: the five KPI tiles (unit = pieces, as the old
            "Quantity (pcs)" caption said; the card carries no unit of its own).
            auto-fit: 5 across when there is room, 3 / 2 on a narrow screen. ── */}
        <div style={{ flex: '1.5 1 430px', minWidth: 0 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(78px, 1fr))',
              gap: 8,
            }}
          >
            <KpiTile label="Order Qty" value={jc.orderQty} tone="plain" />
            <KpiTile
              label="Completed"
              value={completed}
              tone="green"
              title="Pieces through the LAST operation — finished goods are counted only after the last op"
            />
            <KpiTile
              label="WIP"
              value={wip ?? '—'}
              tone="blue"
              title="Pieces released by the first operation and not yet through the last one (first-op done − completed)"
            />
            <KpiTile
              label="Rejected (NC)"
              value={rejected ?? '—'}
              tone="red"
              title={
                `Pieces rejected and not recovered: still open on an NC or scrapped, summed over every operation.` +
                (openNcCount > 0 ? ` ${openNcCount} NC(s) open.` : '')
              }
            />
            {/* Amber while pieces are still owed; green once the order is
                fully through (as the tile always did). */}
            <KpiTile
              label="Pending"
              value={pending}
              tone={pending > 0 ? 'amber' : 'green'}
              title="Order qty − completed"
            />
          </div>
          {/* ADR-103 — client material still workable on this job card. */}
          {rmAvailable ? (
            <div
              style={{
                marginTop: 6,
                fontSize: 11.5,
                color: rmAvailable.availableQty > 0 ? 'var(--text3)' : 'var(--red)',
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
              RM avail{' '}
              <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                {rmAvailable.availableQty}
              </span>
              {rmAvailable.availableQty === 0
                ? ' · issue material'
                : ` of ${rmAvailable.issuedQty} issued`}
            </div>
          ) : null}
        </div>

        {/* ── Column 4: due date · priority · overall status · where it is
            waiting ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto auto',
            columnGap: 14,
            rowGap: 8,
            alignItems: 'center',
            alignContent: 'start',
            flex: '0 0 auto',
            minWidth: 0,
          }}
        >
          <div style={kvLabel}>Due Date</div>
          <div
            className="fw-700"
            style={{ fontSize: 13, whiteSpace: 'nowrap', textAlign: 'right' }}
          >
            📅 {jc.dueDate ? fmtJcDate(jc.dueDate) : '—'}
          </div>
          <div style={kvLabel}>Priority</div>
          <div style={{ textAlign: 'right' }}>
            <span className={`badge ${jc.priority === 'high' ? 'b-amber' : 'b-grey'}`}>
              {jc.priority === 'high' ? '↑ High' : 'Normal'}
            </span>
          </div>
          <div style={kvLabel}>Overall Status</div>
          <div style={{ textAlign: 'right' }}>
            <JcStatusBadge status={jc.computedStatus} />
          </div>
          <div style={kvLabel}>Waiting at</div>
          <div className="fw-700" style={{ fontSize: 13, textAlign: 'right' }}>
            {stuck ? (
              <>
                Op{opSrNo(stuck.opSeq)} · {stuckWhere}
                {stuckRunningOn?.differs ? (
                  <>
                    {' '}
                    · running on{' '}
                    <span style={{ color: 'var(--amber)' }}>{stuckRunningOn.label}</span>
                  </>
                ) : null}
              </>
            ) : (
              <span style={{ color: 'var(--green)' }}>All operations complete</span>
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
          fontSize: 15,
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

/** Route / Operation Flow — the wrapping strip of fixed-size op cards. The
 *  old Overall Progress side block (bar, %, current / next op) is gone from
 *  this panel (restyle 2026-09-21); nothing else on the page showed it. */
export function JcRouteFlowPanel({
  jc,
  sortedOps,
  opExtraById,
  open,
  onToggle,
}: {
  jc: JobCardListItem;
  sortedOps: JcOpEnriched[];
  opExtraById: Map<string, JobCardStatusOpExtra>;
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <SectionBar title="Route / Operation Flow" open={open} onToggle={onToggle} />
      {open ? (
        <div className="panel-body" style={{ padding: '12px 16px' }}>
          <JcOpFlowCards jc={jc} sortedOps={sortedOps} opExtraById={opExtraById} />
        </div>
      ) : null}
    </div>
  );
}
