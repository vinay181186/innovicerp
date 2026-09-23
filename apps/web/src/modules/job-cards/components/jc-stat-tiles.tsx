// Canonical JC summary — ONE consolidated card shared by the JC VIEW and the JC
// EDIT page (same look, only the mode differs). Replaces the old 6/7-tile grid
// (Item · SO/WO · Order Qty · [RM Avail] · Overall Status · Completed · Pending)
// plus a separate Operation-Flow strip. Now a single rounded card with three
// internal rows: (1) four info groups side-by-side, (2) route-progress bar,
// (3) operation-flow chips. Presentation-only; no behaviour.
//
// Theme rule (tokens.css): every colour/font comes from a CSS variable — no
// hard-coded hex. The layout follows the redesign spec; the spec's literal
// Public-Sans / JetBrains-Mono / #hex values map onto the app's Barlow /
// Source Code Pro / --token equivalents.
import type {
  JcOpEnriched,
  JobCardRmAvailable,
  JobCardListItem,
  JobCardStatusOpExtra,
} from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Fragment } from 'react';
import { ItemBadge } from '@/components/shared/item-badge';
import { resolveActualMachine } from '@/components/shared/machine-split';
import { JcStatusBadge } from './jc-status-badge';
import { OUTSOURCE_STATUS_LABEL } from '../lib/jc-op-labels';

const lblStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: 'var(--text3)',
  textTransform: 'uppercase',
  letterSpacing: '.07em',
  marginBottom: 6,
};
// Explanatory sentences use --text2 (never the faint --text3, which is reserved
// for the uppercase section labels above) — the spec's contrast rule.
const noteStyle: React.CSSProperties = { fontSize: 12, color: 'var(--text2)' };

export function JcStatTiles({
  jc,
  ops,
  rmAvailable,
  sortedOps,
  opExtraById,
}: {
  jc: JobCardListItem;
  ops: JcOpEnriched[];
  /** ADR-103 client material still workable on this JWSO Job Card. Null/absent
   *  on SO-sourced and pre-cutover Job Cards — the RM line is then not shown. */
  rmAvailable?: JobCardRmAvailable | null;
  /** Ops in op_seq order — drives the operation-flow row + the "stuck at" line. */
  sortedOps: JcOpEnriched[];
  /** Per-op server-resolved machine name (flow sub-line). Keyed by jc_op id. */
  opExtraById: Map<string, JobCardStatusOpExtra>;
}): React.JSX.Element {
  const totalOps = ops.length;
  const doneOps = ops.filter((o) => o.computedStatus === 'complete').length;
  const pct = totalOps > 0 ? Math.round((doneOps / totalOps) * 100) : 0;
  const completed = jc.lastOpCompletedQty;
  const pending = Math.max(0, jc.orderQty - completed);

  // "Where the job is stuck" — the lowest-seq op not yet complete. Its op_type
  // gives the QC / Outsource / machine distinction. No server field for this;
  // derived on the client (all inputs already on the enriched ops).
  const stuck = sortedOps.find((o) => o.computedStatus !== 'complete');
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

  return (
    <div
      style={{
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius2)',
        padding: 16,
        marginBottom: 16,
      }}
    >
      {/* ───────── Row 1 — four info groups ─────────
          auto-fit + minmax(0,…) keeps four across on wide screens, folds to
          2×2 then 1 column as it narrows, and never overflows into a page
          scrollbar. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 16,
        }}
      >
        {/* ITEM */}
        <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <div style={lblStyle}>Item</div>
          {/* The item CODE is the primary line, the NAME the secondary one
              (user decision) — the shop floor identifies a job by its code, and
              the old layout had that the other way round: an 18px name over an
              11px code chip. The code keeps its mono + purple code identity. */}
          {/* The revision is the CUSTOMER'S drawing revision off the SO line, so
              the code reads `IN-IT-0007/B` on a card raised against an SO and
              stays the bare `IN-IT-0007` on a JW-sourced or standalone card.
              It is rendered as ONE string from the shared helper and left in the
              same purple mono as the code: splitting it into a second, calmer
              span would re-implement the separator on this page, and the Sales
              Order screens (the style reference) already show it undivided —
              two screens spelling the same code differently is the drift the
              helper exists to prevent. nowrap + ellipsis keep the revision
              glued to its code on one line however narrow the tile folds. */}
          {/* The shared badge (user decision 2026-09-21): the Item Master's
              PRODUCT IMAGE at 56 px, the code and the name. Click the picture
              to see it large. */}
          <ItemBadge
            size="card"
            code={jc.itemCode}
            name={jc.itemName}
            revision={jc.itemRevision}
            imagePath={jc.itemImagePath}
            nameMaxWidth="none"
          />
          {/* Raw material planned for this job card (both optional — a dash
              when the plan carried neither). */}
          <div style={{ fontSize: 11, marginTop: 4 }}>
            <span style={{ color: 'var(--text3)' }}>Grade: </span>
            <span className="mono fw-700">{jc.rawMaterialGradeText || '—'}</span>
            <span style={{ color: 'var(--text3)' }}> · Size: </span>
            <span className="mono fw-700">{jc.rawMaterialSizeText || '—'}</span>
          </div>
          {/* The job card's own remarks, directly under the grade and size they
              usually qualify ("EN24 substituted", "size confirmed with client").
              They used to sit in the SO / WO tile, two columns away from the
              material they talk about, which is why they were being missed.
              Shown here only — one remark, one place. */}
          {jc.remarks ? (
            <div style={{ fontSize: 11, marginTop: 4, overflowWrap: 'anywhere' }}>
              <span style={{ color: 'var(--text3)' }}>Remarks: </span>
              <span style={{ color: 'var(--text)' }}>{jc.remarks}</span>
            </div>
          ) : null}
          {/* Route Card reference (the item's active route card + revision). */}
          <div style={{ fontSize: 11, marginTop: 4 }}>
            {jc.routeCardCode ? (
              <>
                <span style={{ color: 'var(--text3)' }}>Route Card: </span>
                <span className="mono fw-700" style={{ color: 'var(--cyan)' }}>
                  {jc.routeCardCode}
                </span>
                {jc.routeCardRevision != null ? (
                  <span className="badge b-blue" style={{ marginLeft: 4, fontSize: 9 }}>
                    Rev {jc.routeCardRevision}
                  </span>
                ) : null}
              </>
            ) : (
              <span style={{ color: 'var(--text3)' }}>
                Route Card: <span style={{ color: 'var(--amber)' }}>none</span>
              </span>
            )}
          </div>
        </div>

        {/* SO / WO */}
        <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <div style={lblStyle}>SO / WO</div>
          <div className="fw-700 mono" style={{ fontSize: 16 }}>
            {jc.sourceLink?.code ?? '—'}
          </div>
          <div style={{ ...noteStyle, marginTop: 2 }}>
            Line <b>{jc.sourceLink?.lineNo ?? '1'}</b> · Due {jc.dueDate ?? '—'}
          </div>
          {jc.clientPoLineNo ? (
            <div style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 700 }}>
              POL: {jc.clientPoLineNo}
            </div>
          ) : null}
          {/* ADR-170 — the Production Order that built this card. Only such a
              card is credited to stock at PO close (never at last-op QC or an
              OSP GRN), so the link is the operator's cue for where "finished"
              actually lands. Old cards carry null and show nothing here. */}
          {jc.productionOrderId && jc.productionOrderCode ? (
            <div style={{ fontSize: 11, marginTop: 4 }}>
              <span style={{ color: 'var(--text3)' }}>Production Order: </span>
              <Link
                to="/production-orders/$id"
                params={{ id: jc.productionOrderId }}
                className="mono fw-700"
                style={{ color: 'var(--cyan)', textDecoration: 'none' }}
              >
                {jc.productionOrderCode}
              </Link>
            </div>
          ) : null}
          {/* Remarks moved to the Item tile, under Grade / Size — see there. */}
        </div>

        {/* QUANTITY (pcs) — one segmented control, not three cards. */}
        <div style={{ minWidth: 0 }}>
          <div style={lblStyle}>Quantity (pcs)</div>
          <div
            style={{
              display: 'flex',
              border: '1px solid var(--border2)',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            <QtySeg label="Ordered" value={jc.orderQty} color="var(--text)" />
            <QtySeg
              label="Completed"
              value={completed}
              color="var(--green)"
              bg="var(--green3)"
              borderLeft
            />
            <QtySeg
              label="Pending"
              value={pending}
              color={pending > 0 ? 'var(--amber)' : 'var(--green)'}
              bg={pending > 0 ? 'var(--amber3)' : 'var(--green3)'}
              emphasise
              borderLeft
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

        {/* OVERALL STATUS */}
        <div style={{ minWidth: 0 }}>
          <div style={lblStyle}>Overall Status</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <JcStatusBadge status={jc.computedStatus} />
            <span className={`badge ${jc.priority === 'high' ? 'b-amber' : 'b-grey'}`}>
              {jc.priority === 'high' ? 'High' : 'Normal'}
            </span>
          </div>
          <div style={{ ...noteStyle, marginTop: 6 }}>
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

      {/* ───────── Row 2 — route progress ───────── */}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <div style={lblStyle}>Route Progress</div>
        <div className="prog-wrap" style={{ height: 8 }}>
          <div className="prog-bar" style={{ width: `${pct}%`, background: 'var(--blue)' }} />
        </div>
        <div style={{ marginTop: 4 }}>
          <b style={{ color: 'var(--text)', fontSize: 12 }}>
            {doneOps} of {totalOps} operations complete · {pct}%
          </b>
          <span style={{ ...noteStyle, marginLeft: 8 }}>
            Finished goods counted only after the last op
          </span>
        </div>
      </div>

      {/* ───────── Row 3 — operation flow ───────── */}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <div style={lblStyle}>Operation Flow</div>
        <JcOpFlowChips jc={jc} sortedOps={sortedOps} opExtraById={opExtraById} />
      </div>
    </div>
  );
}

/** How far one op has got, for the flow strip — the SAME reading on the EDIT
 *  page's chips (JcOpFlowChips) and the VIEW page's cards (JcOpFlowCards), so
 *  the two screens cannot drift. Lifted verbatim out of JcOpFlowChips. */
function flowState(
  o: JcOpEnriched,
  jc: JobCardListItem,
): { flowQty: number; flowDenom: number; flowLabel: string; done: boolean; partial: boolean } {
  const isQc = o.opType === 'qc';
  const st = o.computedStatus;
  // Flow qty = what this op RELEASED over what actually REACHED it.
  // The denominator used to be jc.orderQty for every non-QC op, so
  // an op that only ever received part of the batch advertised the
  // whole order against itself: on IN-JC-26-00085, 45 pieces reached
  // Op3 (drill) and it read "40/50" instead of "40/45", and the
  // outsource op showed no qty at all. `inputAvail` is the qty
  // upstream actually cleared — the same correction the PENDING tile
  // got in migration 0087. Fall back to orderQty only when the
  // enrichment row is missing.
  const flowQty = isQc ? o.qcAcceptedQty : o.completedQty;
  const flowDenom = o.inputAvail || jc.orderQty;
  const flowLabel = `${flowQty}/${flowDenom}`;
  // CARD COLOUR SAYS HOW FAR THE OP HAS GOT (user, 2026-09-12), not
  // what kind of op it is — the kind is already on the card as the
  // 🔬 / 🏭 mark and the QC / OUTSOURCE / machine line.
  //   done      15/15 — nothing left to do here
  //   partial   started, or some pieces through, not all
  //   next      upstream has cleared it and nobody has begun
  //   waiting   upstream has not reached it yet
  // Qty first, status second: "15/15" reads as done whatever the
  // status column says, which is how the user described it.
  const done = st === 'complete' || (flowDenom > 0 && flowQty >= flowDenom);
  // `qc_pending` is deliberately NOT in this list: on a QC op it
  // means pieces are waiting to be inspected and nobody has begun,
  // which is "next", not "partial". Once some are accepted flowQty
  // is > 0 and the card turns yellow on its own.
  const partial =
    !done &&
    (flowQty > 0 ||
      st === 'in_progress' ||
      st === 'running' ||
      st === 'pr_raised' ||
      st === 'po_created' ||
      st === 'at_vendor');
  return { flowQty, flowDenom, flowLabel, done, partial };
}

/** The OPERATION FLOW chip strip — one chip per op, coloured by how far the
 *  op has got (grey done · yellow partial · green next · plain waiting).
 *  EDIT page's summary card (JcStatTiles above). The VIEW page's Route /
 *  Operation Flow panel (jc-view-summary.tsx) uses JcOpFlowCards below —
 *  same reading (flowState), the approved 2026-09-21 look. */
export function JcOpFlowChips({
  jc,
  sortedOps,
  opExtraById,
  stateIcons = false,
}: {
  jc: JobCardListItem;
  sortedOps: JcOpEnriched[];
  opExtraById: Map<string, JobCardStatusOpExtra>;
  /** VIEW page only (2026-09-18 mockup): a ✓ before the qty of a done chip and
   *  a ↻ on a partial one. Off by default so the EDIT page's chips are
   *  unchanged. Same done/partial rule as the colours — nothing new decided. */
  stateIcons?: boolean;
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {sortedOps.length === 0 ? (
        <span className="text3" style={{ fontSize: 12 }}>
          No operations
        </span>
      ) : (
        sortedOps.map((o, i) => {
          const isQc = o.opType === 'qc';
          const isOut = o.opType === 'outsource';
          const st = o.computedStatus;
          // grey done · yellow partial · green next · plain waiting
          const { flowLabel, done, partial } = flowState(o, jc);
          const next = !done && !partial && st !== 'waiting';
          const bg = done
            ? 'var(--bg4)'
            : partial
              ? 'var(--amber3)'
              : next
                ? 'var(--green3)'
                : 'var(--bg2)';
          // A waiting card is white on a white page, so its border is the
          // only thing that draws it -- --border was too faint to see
          // (user, JC-15 op 2, 2026-09-12). --border3 is a plain grey that
          // reads without competing with the done card's grey fill.
          const bdr = done
            ? 'var(--border2)'
            : partial
              ? 'var(--amber2)'
              : next
                ? 'var(--green2)'
                : 'var(--border3)';
          const opColor = done
            ? 'var(--text3)'
            : partial
              ? 'var(--amber)'
              : next
                ? 'var(--green)'
                : 'var(--text3)';
          const doneColor = opColor;
          return (
            <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div
                style={{
                  background: bg,
                  border: `1px solid ${bdr}`,
                  borderRadius: 6,
                  padding: '6px 10px',
                  textAlign: 'center',
                  minWidth: 80,
                }}
              >
                <div className="mono" style={{ fontSize: 10, fontWeight: 700, color: opColor }}>
                  {stateIcons ? 'OP' : 'Op'}
                  {opSrNo(o.opSeq)}
                  {isOut ? ' 🏭' : ''}
                  {isQc ? ' 🔬' : ''}
                </div>
                {isQc ? (
                  <>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        margin: '2px 0',
                        color: 'var(--green)',
                      }}
                    >
                      QC
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text3)' }}>{o.operation}</div>
                  </>
                ) : isOut ? (
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      margin: '2px 0',
                      color: 'var(--amber)',
                    }}
                  >
                    OUTSOURCE
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        margin: '2px 0',
                        color: 'var(--cyan)',
                      }}
                    >
                      {o.machineCode ?? o.machineCodeText ?? '—'}
                    </div>
                    {/* ADR-164 — the code above is the PLANNED machine. When
                        the pieces are (being) made elsewhere, name that
                        machine under it; when they match, nothing is added. */}
                    {(() => {
                      const actual = resolveActualMachine({
                        planned: o.machineCode ?? o.machineCodeText,
                        activeRunningMachineCode: o.activeRunningMachineCode,
                        machines: o.machines,
                      });
                      return actual.differs ? (
                        <div
                          className="mono"
                          style={{ fontSize: 10, fontWeight: 700, color: 'var(--amber)' }}
                          title={`Actual machine: ${actual.label}`}
                        >
                          {actual.label}
                        </div>
                      ) : null;
                    })()}
                    {opExtraById.get(o.id)?.machineName ? (
                      <div style={{ fontSize: 9, color: 'var(--text3)' }}>
                        {opExtraById.get(o.id)?.machineName}
                      </div>
                    ) : null}
                  </>
                )}
                <div style={{ fontSize: 9, color: 'var(--text3)' }}>
                  {isQc ? '' : o.operation.split(' ').slice(0, 2).join(' ')}
                </div>
                {isOut ? (
                  <div
                    style={{
                      fontSize: 9,
                      marginTop: 3,
                      fontWeight: 700,
                      color: 'var(--amber)',
                    }}
                  >
                    {OUTSOURCE_STATUS_LABEL[o.outsourceStatus ?? 'pending']}
                  </div>
                ) : null}
                {/* Every op carries a qty, outsource included — it used to
                    show the vendor status alone, so a chip with 38 pieces
                    accepted back read as bare "Received" with no number. */}
                <div style={{ fontSize: 10, marginTop: 3, fontWeight: 700, color: doneColor }}>
                  {stateIcons && done ? (
                    <span style={{ color: 'var(--green)' }}>✓ </span>
                  ) : stateIcons && partial ? (
                    <span style={{ color: 'var(--amber)' }}>↻ </span>
                  ) : null}
                  {flowLabel}
                </div>
                {o.reworkPendingQty > 0 || o.reworkRaisedQty > 0 ? (
                  <div
                    style={{
                      fontSize: 9,
                      marginTop: 2,
                      fontWeight: 700,
                      color: 'var(--amber)',
                    }}
                  >
                    ♻{o.reworkPendingQty > 0 ? o.reworkPendingQty : o.reworkRaisedQty}
                  </div>
                ) : null}
              </div>
              {i < sortedOps.length - 1 ? (
                <span style={{ color: 'var(--text3)', fontSize: 18 }}>›</span>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

/** ROUTE / OPERATION FLOW on the VIEW page (JC-Detail-Restyle-Mockup.html,
 *  2026-09-21): one card per op, every card the SAME fixed size (150 × 92,
 *  tightened 2026-09-21 — no slack under a one-line name) with the same
 *  four slots —
 *
 *    OP10 · QC              op number, kind
 *    cnc-1                  machine (· name) / QC / OUTSOURCE
 *    Turning — second …     operation name, ONE line then clipped (hover)
 *    ✓ 15/15 · ♻2           qty released / reached, OSP status, rework owed
 *
 *  Status changes ONLY the colours (border, fill, qty), never the size:
 *    complete → green   current (partial / QC pending / OSP in flight) → amber
 *    next     → plain   waiting → plain, quieter text
 *  The strip WRAPS — no horizontal scroll (user decision). Same figures as
 *  JcOpFlowChips (flowState); presentation only. */
export function JcOpFlowCards({
  jc,
  sortedOps,
  opExtraById,
}: {
  jc: JobCardListItem;
  sortedOps: JcOpEnriched[];
  opExtraById: Map<string, JobCardStatusOpExtra>;
}): React.JSX.Element {
  if (sortedOps.length === 0) {
    return (
      <span className="text3" style={{ fontSize: 12 }}>
        No operations
      </span>
    );
  }
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'stretch',
        rowGap: 8,
        padding: '2px 2px',
      }}
    >
      {sortedOps.map((o, i) => {
        const isQc = o.opType === 'qc';
        const isOut = o.opType === 'outsource';
        const st = o.computedStatus;
        const { flowLabel, done, partial } = flowState(o, jc);
        // "Current" = the amber card: started / partly through (partial, the
        // chips' rule), pieces waiting at QC, or an OSP op with pieces in
        // flight (received = incoming QC still to do).
        const current = !done && (partial || st === 'qc_pending' || st === 'received');
        const waiting = !done && !current && st === 'waiting';
        const border = done ? 'var(--green2)' : current ? 'var(--amber)' : 'var(--border)';
        const bg = done ? 'var(--green3)' : current ? 'var(--amber3)' : 'var(--bg2)';
        const qtyColor = done
          ? 'var(--green)'
          : current
            ? 'var(--amber)'
            : waiting
              ? 'var(--text3)'
              : 'var(--text2)';
        const mainColor = waiting ? 'var(--text3)' : 'var(--text)';
        const nameColor = waiting ? 'var(--text3)' : 'var(--text2)';
        // ADR-164 — the code is the PLANNED machine; when the pieces are
        // (being) made elsewhere, that machine is named after it.
        const actual =
          isQc || isOut
            ? null
            : resolveActualMachine({
                planned: o.machineCode ?? o.machineCodeText,
                activeRunningMachineCode: o.activeRunningMachineCode,
                machines: o.machines,
              });
        const machineName = opExtraById.get(o.id)?.machineName;
        const line2Title = isQc
          ? 'QC'
          : isOut
            ? 'OUTSOURCE'
            : [
                o.machineCode ?? o.machineCodeText ?? '—',
                actual?.differs ? `→ ${actual.label}` : null,
                machineName ? `· ${machineName}` : null,
              ]
                .filter(Boolean)
                .join(' ');
        const rework = o.reworkPendingQty > 0 ? o.reworkPendingQty : o.reworkRaisedQty;
        const line4 =
          flowLabel +
          (isOut ? ` · ${OUTSOURCE_STATUS_LABEL[o.outsourceStatus ?? 'pending']}` : '') +
          (rework > 0 ? ` · ♻${rework}` : '');
        return (
          <Fragment key={o.id}>
            <div
              style={{
                flex: '0 0 150px',
                width: 150,
                height: 92,
                boxSizing: 'border-box',
                border: `1.5px solid ${border}`,
                borderRadius: 8,
                background: bg,
                padding: '7px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                minWidth: 0,
                overflow: 'hidden',
              }}
            >
              {/* line 1 — op number + kind */}
              <div
                className="mono"
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: 'var(--text3)',
                  whiteSpace: 'nowrap',
                  lineHeight: 1.2,
                }}
              >
                OP{opSrNo(o.opSeq)}
                {isQc ? ' · QC' : isOut ? ' · OSP' : ''}
              </div>
              {/* line 2 — machine / QC / OUTSOURCE, one line */}
              <div
                className="fw-700"
                style={{
                  fontSize: 13,
                  color: mainColor,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  lineHeight: 1.25,
                }}
                title={line2Title}
              >
                {isQc ? (
                  'QC'
                ) : isOut ? (
                  'OUTSOURCE'
                ) : (
                  <>
                    {o.machineCode ?? o.machineCodeText ?? '—'}
                    {actual?.differs ? (
                      <span className="mono" style={{ color: 'var(--amber)' }}>
                        {' '}
                        → {actual.label}
                      </span>
                    ) : null}
                    {machineName ? (
                      <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text3)' }}>
                        {' '}
                        · {machineName}
                      </span>
                    ) : null}
                  </>
                )}
              </div>
              {/* line 3 — operation name, one line (full name on hover) */}
              <div
                style={{
                  fontSize: 12,
                  color: nameColor,
                  lineHeight: 1.25,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={o.operation}
              >
                {o.operation}
              </div>
              {/* line 4 — qty / status, pinned to the bottom */}
              <div
                className="mono fw-700"
                style={{
                  marginTop: 'auto',
                  fontSize: 12,
                  lineHeight: 1.25,
                  color: qtyColor,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={line4}
              >
                {done ? '✓ ' : partial ? '↻ ' : ''}
                {line4}
              </div>
            </div>
            {i < sortedOps.length - 1 ? (
              <div
                aria-hidden="true"
                style={{
                  flex: '0 0 20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--border3)',
                  fontSize: 16,
                }}
              >
                →
              </div>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

// One cell of the Quantity segmented control.
function QtySeg({
  label,
  value,
  color,
  bg,
  emphasise,
  borderLeft,
}: {
  label: string;
  value: number;
  color: string;
  bg?: string;
  emphasise?: boolean;
  borderLeft?: boolean;
}): React.JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        textAlign: 'center',
        padding: '6px 4px',
        background: bg ?? 'transparent',
        borderLeft: borderLeft ? '1px solid var(--border2)' : undefined,
      }}
    >
      <div
        className="mono"
        style={{ fontSize: emphasise ? 20 : 18, fontWeight: 800, color, lineHeight: 1.1 }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 9,
          textTransform: 'uppercase',
          letterSpacing: '.05em',
          color: 'var(--text3)',
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}
