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
import { itemCodeWithRev } from '@/lib/item-code';
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
          <div
            className="fw-700 mono"
            style={{
              fontSize: 18,
              lineHeight: 1.15,
              color: 'var(--purple)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
            title={itemCodeWithRev(jc.itemCode, jc.itemRevision)}
          >
            {itemCodeWithRev(jc.itemCode, jc.itemRevision)}
          </div>
          <div className="fw-700" style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
            {jc.itemName || '—'}
          </div>
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
                <span className="mono fw-700" style={{ color: 'var(--cyan)' }}>{jc.routeCardCode}</span>
                {jc.routeCardRevision != null ? (
                  <span className="badge b-blue" style={{ marginLeft: 4, fontSize: 9 }}>Rev {jc.routeCardRevision}</span>
                ) : null}
              </>
            ) : (
              <span style={{ color: 'var(--text3)' }}>Route Card: <span style={{ color: 'var(--amber)' }}>none</span></span>
            )}
          </div>
        </div>

        {/* SO / WO */}
        <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <div style={lblStyle}>SO / WO</div>
          <div className="fw-700 mono" style={{ fontSize: 16 }}>{jc.sourceLink?.code ?? '—'}</div>
          <div style={{ ...noteStyle, marginTop: 2 }}>
            Line <b>{jc.sourceLink?.lineNo ?? '1'}</b> · Due {jc.dueDate ?? '—'}
          </div>
          {jc.clientPoLineNo ? (
            <div style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 700 }}>CPO Ln: {jc.clientPoLineNo}</div>
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
            <QtySeg label="Completed" value={completed} color="var(--green)" bg="var(--green3)" borderLeft />
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
              style={{ marginTop: 6, fontSize: 11, color: rmAvailable.availableQty > 0 ? 'var(--text2)' : 'var(--red)', fontWeight: rmAvailable.availableQty > 0 ? 400 : 700 }}
              title={
                `Client material issued to this job card: ${rmAvailable.issuedQty}. ` +
                `Already produced on the first operation: ${rmAvailable.consumedQty}. ` +
                (rmAvailable.availableQty > 0
                  ? `${rmAvailable.availableQty} can still be worked.`
                  : 'Issue more client material from Party Material Issue to continue.')
              }
            >
              RM avail <span className="mono fw-700">{rmAvailable.availableQty}</span>
              {rmAvailable.availableQty === 0 ? ' · issue material' : ` of ${rmAvailable.issuedQty} issued`}
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
                Waiting at <b>Op{stuck.opSeq}</b> · {stuckWhere}
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
          <span style={{ ...noteStyle, marginLeft: 8 }}>Finished goods counted only after the last op</span>
        </div>
      </div>

      {/* ───────── Row 3 — operation flow ───────── */}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <div style={lblStyle}>Operation Flow</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          {sortedOps.length === 0 ? (
            <span className="text3" style={{ fontSize: 12 }}>No operations</span>
          ) : (
            sortedOps.map((o, i) => {
              const isQc = o.opType === 'qc';
              const isOut = o.opType === 'outsource';
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
              //   grey    done      15/15 — nothing left to do here
              //   yellow  partial   started, or some pieces through, not all
              //   green   next      upstream has cleared it and nobody has begun
              //   plain   waiting   upstream has not reached it yet
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
                      Op{o.opSeq}
                      {isOut ? ' 🏭' : ''}
                      {isQc ? ' 🔬' : ''}
                    </div>
                    {isQc ? (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 600, margin: '2px 0', color: 'var(--green)' }}>QC</div>
                        <div style={{ fontSize: 9, color: 'var(--text3)' }}>{o.operation}</div>
                      </>
                    ) : isOut ? (
                      <div style={{ fontSize: 11, fontWeight: 600, margin: '2px 0', color: 'var(--amber)' }}>OUTSOURCE</div>
                    ) : (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 600, margin: '2px 0', color: 'var(--cyan)' }}>
                          {o.machineCode ?? o.machineCodeText ?? '—'}
                        </div>
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
                      <div style={{ fontSize: 9, marginTop: 3, fontWeight: 700, color: 'var(--amber)' }}>
                        {OUTSOURCE_STATUS_LABEL[o.outsourceStatus ?? 'pending']}
                      </div>
                    ) : null}
                    {/* Every op carries a qty, outsource included — it used to
                        show the vendor status alone, so a chip with 38 pieces
                        accepted back read as bare "Received" with no number. */}
                    <div style={{ fontSize: 10, marginTop: 3, fontWeight: 700, color: doneColor }}>
                      {flowLabel}
                    </div>
                    {o.reworkPendingQty > 0 || o.reworkRaisedQty > 0 ? (
                      <div style={{ fontSize: 9, marginTop: 2, fontWeight: 700, color: 'var(--amber)' }}>
                        ♻{o.reworkPendingQty > 0 ? o.reworkPendingQty : o.reworkRaisedQty}
                      </div>
                    ) : null}
                  </div>
                  {i < sortedOps.length - 1 ? <span style={{ color: 'var(--text3)', fontSize: 18 }}>›</span> : null}
                </div>
              );
            })
          )}
        </div>
      </div>
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
      <div className="mono" style={{ fontSize: emphasise ? 20 : 18, fontWeight: 800, color, lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text3)', marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}
