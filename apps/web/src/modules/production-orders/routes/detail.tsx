// Production Order detail (ADR-170, ADR-182): the header facts, the live Job
// Card progress, and — for an open order whose JC is complete — the Close
// button.
//
// Close is BLOCKED until the JC is complete; the server says so through
// `canClose` / `closeBlockedReason`, and the page only repeats that answer.
// On close stock is credited ONCE with the JC's actually finished qty (48 of
// 50 → 48), which is why the confirm names that number before asking.
//
// ADR-182 adds SHORT CLOSE — stop the order at ANY stage. It is a different
// thing from "close short": nothing is credited or written off, the order and
// its Job Card are frozen, and the un-produced qty goes back to the plan. Once
// an order is short closed the Close form and the ledger's Reverse buttons go
// away, and a red panel says who stopped it, when and why.

import type { DocumentEditChange } from '@innovic/shared';
import { isProductionOrderStopped } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { DocumentHistory } from '@/components/shared/document-history';
import { usePendingEditForDoc } from '@/modules/document-edits/api';
import {
  PendingChangeChip,
  headerPendingChange,
} from '@/modules/document-edits/components/pending-change-chip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { JcStatusBadge } from '@/modules/job-cards/components/jc-status-badge';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { ActionMenu, DetailHeader } from '@/ui/layout';
import { useProductionOrder } from '../api';
import { PoCloseForm } from '../components/po-close-form';
import { PoCloseLedger } from '../components/po-close-ledger';
import { PoShortCloseModal } from '../components/po-short-close-modal';
import { PoStatusBadge } from '../components/po-status-badge';

export const productionOrderDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'production-orders/$id',
  component: ProductionOrderDetailPage,
});

function Fact({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="form-grp">
      <span className="form-label">{label}</span>
      <div className={mono ? 'mono fw-700' : undefined} style={{ color: 'var(--text)' }}>
        {children}
      </div>
    </div>
  );
}

// ── The header fact sheet (owner decision 2026-10-05) ───────────────────────
// Every header fact in ONE table, read top to bottom in the order the work
// happens, with the group names as divider BANDS inside that same table —
// explicitly NOT a panel per group. Four columns: label · value · label ·
// value, two facts to a row, so a fact always sits beside its own name.
//
// `table-layout: fixed` (`tbl-fixed`) + the colgroup below keep the four
// columns on the same vertical edges from the first row to the last, whatever
// is in them. Labels wrap rather than clip; long values ellipsis with a title.

/** A divider band — the group's name, across all four columns. Same look as a
 *  table head band (`.innovic-table th`) without the sticky / sortable
 *  behaviour, which a row header must not have. */
function Band({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <tr>
      <td
        colSpan={4}
        className="td-left"
        style={{
          background: 'var(--bg4)',
          color: 'var(--blue2)',
          fontFamily: 'var(--hfont)',
          fontSize: 'var(--fs-xs)',
          fontWeight: 800,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {children}
      </td>
    </tr>
  );
}

/** The label half of a fact — the 13px `.form-label` standard, left, and
 *  allowed to wrap so a long name is never cut off mid-word. */
function K({ children }: { children: string }): React.JSX.Element {
  return (
    <td className="form-label td-left" style={{ whiteSpace: 'normal' }}>
      {children}
    </td>
  );
}

/** The value half. Document numbers / codes and quantities are mono fw-700 in
 *  --text — they are what a reader hunts for, never the faint --text3.
 *  Quantities also right-align with tabular digits (number-alignment
 *  standard, 2026-09-26). Only a value that is not there goes quiet. */
function V({
  children,
  num = false,
  code = false,
  empty = false,
  span,
  title,
}: {
  children: React.ReactNode;
  /** A quantity — right, mono, tabular digits. */
  num?: boolean;
  /** A document number / code / date — left, mono, strong. */
  code?: boolean;
  /** The value is absent (the em dash) — the one case that reads quiet. */
  empty?: boolean;
  span?: 2 | 3 | undefined;
  title?: string | undefined;
}): React.JSX.Element {
  return (
    <td
      className={num ? 'td-num mono fw-700' : code ? 'td-left mono fw-700' : 'td-left'}
      colSpan={span}
      title={title}
      style={{
        color: empty ? 'var(--text3)' : 'var(--text)',
        fontWeight: empty ? 400 : num || code ? 700 : 600,
      }}
    >
      {children}
    </td>
  );
}

/** The pending change for a header field, if any — the amber "→ after" chip. */
function Chip({
  changes,
  field,
}: {
  changes: readonly DocumentEditChange[];
  field: string;
}): React.JSX.Element | null {
  const c = headerPendingChange(changes, field);
  return c ? <PendingChangeChip after={c.after} /> : null;
}

function ProductionOrderDetailPage(): React.JSX.Element {
  const { id } = productionOrderDetailRoute.useParams();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useProductionOrder(id);
  const [shortCloseOpen, setShortCloseOpen] = useState(false);

  // Tier-driven (Production). Close is an EDIT on the order, not an entry.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'prodorder_create');

  // ADR-202 Phase 3 — staged header edits waiting for approval. Their per-field
  // changes drive the inline amber chips next to each editable fact below.
  const pendingEdit = usePendingEditForDoc('ProductionOrder', id);
  const pendingChanges = (pendingEdit.data?.rows ?? []).flatMap((r) => r.changes);

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading Production Order…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/production-orders" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Production Order not found.'}
          </div>
        </div>
      </div>
    );
  }

  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Production Orders. Ask an admin.
      </div>
    );
  }

  // ADR-182 — a short-closed order is dead: no close, no reversal, and no work
  // on its Job Card. Everything this page offers hangs off that one answer,
  // read from the shared enum helper so the screen and the server agree on
  // what "stopped" means.
  const stopped = isProductionOrderStopped(data.status);
  // ADR-179: close is progressive. It stays available while the order is not
  // fully closed and the server still allows it (`canClose`).
  const notClosed = data.status !== 'closed';
  const showCloseForm = !stopped && notClosed && perms.edit && data.canClose;
  // Short Close is offered at ANY stage except an order already stopped — the
  // ask is "at any stage". Same `edit` right as Close.
  const showShortCloseButton = !stopped && perms.edit;
  // ADR-202 Phase 3 — header edit (with approval) is offered only while the
  // order is still open or partly closed; a closed / short-closed order is
  // frozen. Same `edit` right as Close. The server re-checks both.
  const canEdit = perms.edit && (data.status === 'open' || data.status === 'partially_closed');
  const pct =
    data.orderQty > 0 ? Math.min(100, Math.round((data.jcFinishedQty / data.orderQty) * 100)) : 0;

  return (
    <div>
      {/* DetailHeader layout: Back link, code + status, one shortcut to the
          order's Job Card, and Short Close in the Actions menu (red, last). */}
      <DetailHeader
        backLabel="Back"
        backTo="/production-orders"
        renderLink={(p) => <Link {...p} />}
        code={data.code}
        name="Production Order"
        badges={<PoStatusBadge status={data.status} />}
        actions={
          <>
            <Link
              to="/job-cards/$id"
              params={{ id: data.jobCardId }}
              className="btn btn-ghost btn-sm"
              title={`Open Job Card ${data.jcCodeText}`}
            >
              Open Job Card
            </Link>
            <ActionMenu
              items={[
                {
                  label: '✏️ Edit',
                  hidden: !canEdit,
                  title: 'Edit this Production Order (Remarks, PRO Target Date, Actual Size, Raw Material Available)',
                  onClick: () =>
                    void navigate({ to: '/production-orders/$id/edit', params: { id: data.id } }),
                },
                {
                  label: 'Short Close',
                  danger: true,
                  hidden: !showShortCloseButton,
                  title:
                    'Stop this Production Order — its Job Card is frozen and the un-produced qty goes back to the plan',
                  onClick: () => setShortCloseOpen(true),
                },
              ]}
            />
          </>
        }
      >
        {!stopped && notClosed && !data.canClose && data.closeBlockedReason ? (
          <div
            className="text3"
            style={{
              fontSize: 12,
              padding: '6px 10px',
              background: 'var(--bg3)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              marginBottom: 10,
            }}
          >
            🔒 Cannot close yet — {data.closeBlockedReason}
          </div>
        ) : null}

        {/* ── The fact sheet ──────────────────────────────────────────────
            One table, top to bottom in the order the work happens: who it is →
            where it came from → what to make → how much → when → what it is
            made of → notes. The group names are BAND rows inside this same
            table (owner decision 2026-10-05), not a panel each. */}
        <table className="innovic-table tbl-fixed">
          <colgroup>
            <col style={{ width: '20%' }} />
            <col style={{ width: '30%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '30%' }} />
          </colgroup>
          <tbody>
            <Band>Identity</Band>
            <tr>
              <K>Production Order No.</K>
              <V code>{data.code}</V>
              <K>Production Order Status</K>
              <V>
                <PoStatusBadge status={data.status} />
              </V>
            </tr>
            <tr>
              <K>Production Order Date</K>
              <V code empty={!data.createdAt}>
                {fmtDate(data.createdAt)}
              </V>
              <K>Created By</K>
              <V empty={!data.createdByName} title={data.createdByName ?? undefined}>
                {data.createdByName ?? '—'}
              </V>
            </tr>

            <Band>Where it came from</Band>
            <tr>
              <K>SO / JWSO No.</K>
              <V code empty={!data.soCodeText}>
                {data.soCodeText ?? '—'}
              </V>
              <K>Customer</K>
              <V empty={!data.partyName} title={data.partyName ?? undefined}>
                {data.partyName ?? '—'}
              </V>
            </tr>
            <tr>
              {/* Ln is OUR sales-order line number. POL is the line number
                  printed on the CUSTOMER's own purchase order — on live data
                  our line 11 is the customer's line 20. Never the same fact. */}
              <K>Ln</K>
              <V code empty={!data.lineNo}>
                {data.lineNo ?? '—'}
              </V>
              <K>POL</K>
              <V code empty={!data.clientPoLineNo}>
                {data.clientPoLineNo ? (
                  <span style={{ color: 'var(--purple)' }}>{data.clientPoLineNo}</span>
                ) : (
                  '—'
                )}
              </V>
            </tr>
            <tr>
              {/* ADR-207 — the SO's own office number, read live. A JWSO and an
                  older SO have none. */}
              <K>Internal SO No.</K>
              <V code empty={!data.soInternalNo}>
                {data.soInternalNo ?? '—'}
              </V>
              {/* The approved sheet leaves this half of the row open. */}
              <td colSpan={2} />
            </tr>
            <tr>
              <K>Plan No.</K>
              <V>
                <Link
                  to="/plans/$id"
                  params={{ id: data.planId }}
                  className="mono fw-700"
                  style={{ color: 'var(--cyan)', textDecoration: 'none' }}
                >
                  {data.planCodeText}
                </Link>
              </V>
              <K>Route Card</K>
              <V>
                <Link
                  to="/route-cards/$id"
                  params={{ id: data.routeCardId }}
                  className="mono fw-700"
                  style={{ color: 'var(--cyan)', textDecoration: 'none' }}
                >
                  {data.routeCardCodeText}
                </Link>
                <span className="text3" style={{ fontSize: 11, fontWeight: 400 }}>
                  {' '}
                  · Route Card Rev {data.routeCardRevision}
                </span>
              </V>
            </tr>

            <Band>What to make</Band>
            <tr>
              <K>Item Code</K>
              {/* CODE/REV (ADR-177); bare code when the line has no revision. */}
              <V code>{itemCodeWithRev(data.itemCodeText, data.itemRevision)}</V>
              <K>Item Name</K>
              <V empty={!data.itemNameText} title={data.itemNameText ?? undefined}>
                {data.itemNameText ?? '—'}
              </V>
            </tr>

            {/* ── How much ──
                The three-rung ladder first (what the customer ordered, what the
                plan covers, what THIS order is for), then the close account:
                credited + pending, what can be closed right now, what was
                lost. `PRO Qty` not a bare `Order Qty` — three quantities sit
                together here (docs/NAMING.md). */}
            <Band>How much</Band>
            <tr>
              <K>SO Qty</K>
              <V num empty={data.soQty == null} title="The SO / JWSO line's ordered qty">
                {data.soQty ?? '—'}
              </V>
              <K>Plan Qty</K>
              <V num empty={data.planQty == null} title="What the plan covers">
                {data.planQty ?? '—'}
              </V>
            </tr>
            <tr>
              <K>PRO Qty</K>
              <V num title="Pieces THIS Production Order is for">
                {data.orderQty}
              </V>
              <K>Credited Qty</K>
              <V num title="Pieces already closed into stock">
                {data.creditedQty ?? 0}
              </V>
            </tr>
            <tr>
              <K>Pending</K>
              <V num title="Pieces still to be closed">
                {data.remainingQty}
              </V>
              <K>Available to Close</K>
              <V num title="Finished on the Job Card and not yet credited">
                {data.availableToClose}
              </V>
            </tr>
            <tr>
              <K>Lost Qty</K>
              <V num empty={data.lostQty == null} title="Pieces written off on a short close">
                {data.lostQty ?? '—'}
              </V>
              <K>JC No.</K>
              <V>
                <Link
                  to="/job-cards/$id"
                  params={{ id: data.jobCardId }}
                  className="mono fw-700"
                  style={{ color: 'var(--cyan)', textDecoration: 'none' }}
                >
                  {data.jcCodeText}
                </Link>{' '}
                {/* JC Status — the live computed status the row carries
                    (`jcStatus` on the wire is this same value). */}
                {data.jcComputedStatus ? (
                  <JcStatusBadge status={data.jcComputedStatus} />
                ) : (
                  <span className="text3" style={{ fontWeight: 400 }}>
                    —
                  </span>
                )}
              </V>
            </tr>

            {/* ── When ──
                The dates in the order they happen: the plan's window, our own
                target, then the date the CUSTOMER expects it (the SO / JWSO
                line's due date — that is what `Customer Dispatch Date` means on
                a Production Order, owner decision 2026-09-30). */}
            <Band>When</Band>
            <tr>
              <K>Plan Start Date</K>
              <V code empty={!data.plannedStartDate}>
                {fmtDate(data.plannedStartDate)}
              </V>
              <K>Plan End Date</K>
              <V code empty={!data.plannedEndDate}>
                {fmtDate(data.plannedEndDate)}
              </V>
            </tr>
            <tr>
              <K>PRO Target Date</K>
              <V code empty={!data.targetDate}>
                {fmtDate(data.targetDate)}
                <Chip changes={pendingChanges} field="targetDate" />
              </V>
              <K>Customer Dispatch Date</K>
              <V code empty={!data.lineDueDate}>
                {fmtDate(data.lineDueDate)}
              </V>
            </tr>

            {/* ── Material ──
                Grade and size are read live off the plan (same labels as Plan
                detail); the RM item is WHAT the store issues. Actual Size and
                Raw Material Available are the shop floor's own answers typed on
                Create (ADR-182) — the size really cut, not the planned one. */}
            <Band>Material</Band>
            <tr>
              <K>RM Grade</K>
              <V empty={!data.rawMaterialGradeText} title={data.rawMaterialGradeText ?? undefined}>
                {data.rawMaterialGradeText ?? '—'}
              </V>
              <K>RM Size</K>
              <V empty={!data.rawMaterialSizeText} title={data.rawMaterialSizeText ?? undefined}>
                {data.rawMaterialSizeText ?? '—'}
              </V>
            </tr>
            <tr>
              <K>RM Item</K>
              <V code empty={!data.rawMaterialItemCode}>
                {data.rawMaterialItemCode ?? '—'}
              </V>
              <K>RM Qty / piece</K>
              <V num empty={data.rmQtyPerPiece == null}>
                {data.rmQtyPerPiece ?? '—'}
              </V>
            </tr>
            <tr>
              <K>Actual Size</K>
              <V code empty={!data.actualSize}>
                {data.actualSize ?? '—'}
                <Chip changes={pendingChanges} field="actualSize" />
              </V>
              <K>Raw Material Available</K>
              <V>
                {data.rawMaterialAvailable ? (
                  <span style={{ color: 'var(--green2)' }}>✓ Yes</span>
                ) : (
                  <span style={{ color: 'var(--red2)' }}>✗ No</span>
                )}
                <Chip changes={pendingChanges} field="rawMaterialAvailable" />
              </V>
            </tr>

            <Band>Notes</Band>
            <tr>
              <K>Remarks</K>
              <V span={3} empty={!data.remarks}>
                {data.remarks ?? '—'}
                <Chip changes={pendingChanges} field="remarks" />
              </V>
            </tr>
          </tbody>
        </table>
      </DetailHeader>

      {/* ADR-182 — the order was stopped. High on the page, because it changes
          what every panel under it means. Grey, like its Short Closed badge. */}
      {stopped ? (
        <div className="panel" style={{ marginTop: 12, borderLeft: '3px solid var(--text3)' }}>
          <div className="panel-hdr">
            <div className="panel-title">
              Short Closed on {fmtDate(data.shortClosedAt)} by {data.shortClosedByName ?? '—'} —{' '}
              {data.shortCloseReason ?? '—'}
            </div>
          </div>
          <div className="panel-body">
            <div className="text2" style={{ fontSize: 12, lineHeight: 1.6 }}>
              {data.creditedQty ?? 0} credited stay in stock;{' '}
              {Math.max(0, data.orderQty - (data.creditedQty ?? 0))} Pending went back to Plan{' '}
              <span className="mono fw-700">{data.planCodeText}</span>.
            </div>
          </div>
        </div>
      ) : null}

      {/* JC progress — read live off the Job Card on every load, never stored. */}
      <div className="panel" style={{ marginTop: 12 }}>
        <div className="panel-hdr">
          <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Job Card Progress
            {data.jcComputedStatus ? (
              <JcStatusBadge status={data.jcComputedStatus} />
            ) : (
              <span className="badge b-grey">No Job Card</span>
            )}
          </div>
          <div
            className="mono fw-700"
            style={{ fontSize: 14, color: 'var(--text)', cursor: 'help' }}
            title="Finished qty = output of the Job Card's last op (QC-accepted if it is QC). Close credits this qty to stock."
          >
            {data.jcFinishedQty} <span className="text3">/ {data.orderQty}</span>
          </div>
        </div>
        <div className="panel-body">
          <div
            style={{
              height: 8,
              background: 'var(--bg4)',
              borderRadius: 4,
              overflow: 'hidden',
            }}
            title={`${pct}% completed`}
          >
            <div
              style={{
                width: `${pct}%`,
                height: '100%',
                background: pct >= 100 ? 'var(--green)' : 'var(--cyan)',
              }}
            />
          </div>
          {data.jcClosedAt ? (
            <div className="text3" style={{ fontSize: 11, marginTop: 6 }}>
              JC closed on <span className="mono">{fmtDate(data.jcClosedAt)}</span>.
            </div>
          ) : null}
        </div>
      </div>

      {/* Close (progressive) — credit finished pieces as they come off the JC. */}
      {showCloseForm ? (
        <div className="panel" style={{ marginTop: 12, borderLeft: '3px solid var(--cyan)' }}>
          <div className="panel-hdr">
            <div className="panel-title">Close Production Order</div>
          </div>
          <div className="panel-body">
            <PoCloseForm po={data} />
          </div>
        </div>
      ) : null}

      {/* Close ledger — every partial close + reversal, newest first. */}
      {data.closes.length > 0 ? (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="panel-hdr">
            <div className="panel-title">Close Ledger ({data.closes.length})</div>
            <div className="mono fw-700" style={{ fontSize: 13, color: 'var(--text)' }}>
              {data.creditedQty ?? 0} <span className="text3">/ {data.orderQty} credited</span>
            </div>
          </div>
          <div className="panel-body">
            {/* ADR-182 — nothing may be reversed on a stopped order either. */}
            <PoCloseLedger po={data} canReverse={perms.edit && !stopped} />
          </div>
        </div>
      ) : null}

      {data.status === 'closed' ? (
        <div className="panel" style={{ marginTop: 12, borderLeft: '3px solid var(--green)' }}>
          <div className="panel-hdr">
            <div className="panel-title">✓ Closed — stock credited</div>
          </div>
          <div className="panel-body">
            <div className="form-grid form-grid-3">
              <Fact label="Credited Qty" mono>
                {data.creditedQty ?? '—'}
              </Fact>
              <Fact label="Lost Qty" mono>
                {data.lostQty ?? '—'}
              </Fact>
              <Fact label="Close Date" mono>
                {fmtDate(data.closedAt)}
              </Fact>
            </div>
          </div>
        </div>
      ) : null}

      {/* ADR-197 — every action on this order: create, partial closes,
          reversals, short close — who, when, qty, reason. */}
      <Panel title="History" bodyPadding="none" style={{ marginTop: 12 }}>
        <DocumentHistory entity="ProductionOrder" entityId={data.id} refId={data.code} />
      </Panel>

      {shortCloseOpen ? (
        <PoShortCloseModal
          id={data.id}
          code={data.code}
          jcCode={data.jcCodeText}
          orderQty={data.orderQty}
          creditedQty={data.creditedQty ?? 0}
          onClose={() => setShortCloseOpen(false)}
        />
      ) : null}
    </div>
  );
}
