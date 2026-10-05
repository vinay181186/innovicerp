// Plan detail (PL-4). Shows full plan + ops + linked entities + actions.
//
// 2026-10-05 layout (the Plan screens method, ADR-214 — same primitive as the
// Purchase Request screens, ADR-213): the identity line says WHICH SO line and
// item this plan is for, then named one-line clusters in the order the work
// happens — Quantity (ending on Pending, the number that decides whether a
// Production Order is still needed), Schedule, Material, and the route-specific
// Buy / Outsource facts. Create Plan and Edit Plan fill the same clusters, so a
// planner who learns one screen has learned all three.
//
// Operations now has a panel of its own. Before this pass a plan's operations
// were shown nowhere on the view page.

import type { DocumentEditChange, PlanStatus, PlanType } from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, CheckCircle, Loader2, Pencil, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { usePendingEditForDoc } from '@/modules/document-edits/api';
import {
  PendingChangeChip,
  headerPendingChange,
} from '@/modules/document-edits/components/pending-change-chip';
import { DocumentHistory } from '@/components/shared/document-history';
import { RelatedDocsPanel } from '@/components/shared/related-docs-panel';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { Cluster, ClusterFact, ClusterGrid, DocIdent, IdentCode, IdentSep } from '@/ui/forms';
import { useExecutePlan, useFinalizePlan, usePlan } from '../api';
import { PlanDeleteModal } from '../components/plan-delete-modal';
import { DERIVED_BADGE, DERIVED_LABEL, STORED_BADGE } from '../lib/derived-status';

export const planDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'plans/$id',
  component: PlanDetailPage,
});

// The plan-status words. The COLOURS are STORED_BADGE (lib/derived-status) —
// one map, shared with the Plans list, so the two screens cannot paint the
// same status differently.
const STATUS_LABEL: Record<PlanStatus, string> = {
  in_planning: 'In Planning',
  planned: 'Planned',
  jc_created: 'JC Created',
  pr_created: 'PR Created',
  in_production: 'In Production',
  complete: 'Completed',
  cancelled: 'Cancelled',
};

const TYPE_LABEL: Record<PlanType, string> = {
  manufacture: '🏭 Manufacture',
  direct_purchase: '🛒 Buy',
  full_outsource: '📦 Full Outsource',
  assembly: '🔧 Assembly',
};

const OP_TYPE_LABEL: Record<string, string> = {
  process: 'In-house',
  outsource: 'Outsource',
  qc: 'QC',
};

function PlanDetailPage(): React.JSX.Element {
  const { id } = planDetailRoute.useParams();
  const navigate = useNavigate();
  const { data: plan, isLoading, isError, error } = usePlan(id);
  // ADR-202 — edits staged against this plan and still waiting for a decision.
  // Their per-field changes drive the inline amber chips next to the record
  // fields below. Flattened across requests (usually one).
  const pendingEdit = usePendingEditForDoc('Plan', plan?.id);
  const pendingChanges = (pendingEdit.data?.rows ?? []).flatMap((r) => r.changes);
  const finalize = useFinalizePlan();
  const execute = useExecutePlan();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'plan_create');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading plan…
      </div>
    );
  }
  if (isError || !plan) {
    return (
      <div className="panel">
        <div className="panel-body">
          <Link to="/plans" className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }}>
            <ArrowLeft size={14} /> Back
          </Link>
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Plan not found.'}
          </div>
        </div>
      </div>
    );
  }

  // Money hidden for L1 Viewers: the API nulls die cost / rate / op outsource
  // cost together, so the OSP cost column and the cost/rate fields are dropped.
  // Told by the server, not inferred from a null money field: a null also means
  // "no value yet", so probing it hid money from users entitled to see it.
  const priceHidden = !plan.priceVisible;
  const isEditable = plan.planStatus === 'in_planning' || plan.planStatus === 'planned';
  // ADR-170 — a route-card-driven plan holds no operations and is never
  // Finalized / Executed here: a Production Order builds its Job Card from the
  // item's Route Card. Old plans (opsSource 'plan') keep every action as before.
  const fromRouteCard = plan.opsSource === 'route_card';
  const canFinalize = !fromRouteCard && plan.planStatus === 'in_planning';
  const canExecute = !fromRouteCard && plan.planStatus === 'planned';

  const onFinalize = (): void => {
    setActionError(null);
    finalize.mutate(plan.id, {
      onError: (e) =>
        setActionError(
          e instanceof Error ? e.message : 'Could not mark the plan Planned. Try again.',
        ),
    });
  };
  const onExecute = (): void => {
    setActionError(null);
    execute.mutate(plan.id, {
      onError: (e) =>
        setActionError(
          e instanceof Error ? e.message : 'Could not create the Job Card / PR. Try again.',
        ),
    });
  };

  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Plans. Ask an admin.
      </div>
    );
  }

  return (
    <div>
      <Link to="/plans" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back
      </Link>

      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div
              className="td-code"
              style={{ color: 'var(--cyan)', fontSize: 16, fontWeight: 700 }}
            >
              {plan.code}
            </div>
            <div
              className="panel-title"
              style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 10 }}
            >
              {/* Falls back to the item code only when neither name is known, and
                  when it does it must read `CODE/REV` like everywhere else — the
                  helper drops the slash when the plan has no SO line behind it. */}
              {plan.itemName ??
                plan.itemNameText ??
                itemCodeWithRev(plan.itemCode ?? plan.itemCodeText, plan.itemRevision)}
              {/* ADR-185 — a route-card plan states its DERIVED status, the
                  same word and colour the Plans list shows for it; only old
                  plans keep their stored status label. */}
              {plan.derivedStatus ? (
                <span className={`badge ${DERIVED_BADGE[plan.derivedStatus]}`}>
                  {DERIVED_LABEL[plan.derivedStatus]}
                </span>
              ) : (
                <span className={`badge ${STORED_BADGE[plan.planStatus]}`}>
                  {STATUS_LABEL[plan.planStatus]}
                </span>
              )}
              <span className="text3" style={{ fontSize: 12 }}>
                {TYPE_LABEL[plan.planType]}
              </span>
              <Chip changes={pendingChanges} field="planType" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {perms.edit && canFinalize ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onFinalize}
                disabled={finalize.isPending}
                title="Mark Planned (lock for execution)"
              >
                {finalize.isPending ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <CheckCircle size={13} />
                )}{' '}
                Mark Planned
              </button>
            ) : null}
            {perms.edit && canExecute ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={onExecute}
                disabled={execute.isPending}
                title={
                  plan.planType === 'manufacture' || plan.planType === 'assembly'
                    ? 'Create the Job Card and copy the operations'
                    : 'Raise the PR(s)'
                }
              >
                {execute.isPending ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Play size={13} />
                )}{' '}
                {plan.planType === 'manufacture' || plan.planType === 'assembly'
                  ? 'Create Job Card'
                  : 'Raise PR'}
              </button>
            ) : null}
            {perms.edit && isEditable ? (
              <Link to="/plans/$id/edit" params={{ id: plan.id }} className="btn btn-ghost btn-sm">
                <Pencil size={13} /> Edit
              </Link>
            ) : null}
            {perms.edit && perms.approve && isEditable ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => setConfirmDelete(true)}
                disabled={confirmDelete}
              >
                <Trash2 size={13} /> Delete
              </button>
            ) : null}
            {/* The one thing a Planned route-card plan exists for. Same
                condition and same destination as the link it replaces — it was
                a text link in a box at the foot of the body, where the page's
                primary action read as a footnote. */}
            {fromRouteCard && perms.entry && plan.planStatus === 'planned' && !plan.jcId ? (
              <Link
                to="/production-orders/new"
                search={{ planId: plan.id, planCode: plan.code }}
                className="btn btn-primary btn-sm"
              >
                Create Production Order →
              </Link>
            ) : null}
          </div>
        </div>
        <div className="panel-body">
          {actionError ? (
            <div
              style={{
                color: 'var(--red2)',
                background: 'var(--red3)',
                border: '1px solid var(--red2)',
                borderRadius: 6,
                padding: '6px 10px',
                fontSize: 12,
                marginBottom: 10,
              }}
            >
              {actionError}
            </div>
          ) : null}

          {/* WHICH order line and item this plan is for. Identity, not facts
              about the plan, so it heads the body instead of taking grid cells
              — and a part with nothing behind it (an ad-hoc plan has no SO line
              and no POL) is left out rather than printed as a dash. */}
          <DocIdent>
            {plan.soCodeText ? (
              <>
                <IdentCode>{soNoWithInternal(plan.soCodeText, plan.soInternalNo)}</IdentCode>
                {plan.lineNo ? <span>Ln {plan.lineNo}</span> : null}
                <IdentSep />
              </>
            ) : null}
            {/* `CODE/REV` — the customer's drawing revision off the SO line this
                plan was raised against. The helper drops the slash when there is
                no revision behind it. Item code is the main thing on the line. */}
            <IdentCode>
              {itemCodeWithRev(plan.itemCode ?? plan.itemCodeText, plan.itemRevision)}
            </IdentCode>
            {(plan.itemName ?? plan.itemNameText) ? (
              <span>{plan.itemName ?? plan.itemNameText}</span>
            ) : null}
            {/* POL = the line number printed on the CUSTOMER's own purchase
                order. It is NOT our SO line number ("Ln" above); on live data
                our line 11 is the customer's line 20. */}
            {plan.clientPoLineNo ? (
              <>
                <IdentSep />
                <span>
                  POL{' '}
                  <b className="mono" style={{ color: 'var(--purple)' }}>
                    {plan.clientPoLineNo}
                  </b>
                </span>
              </>
            ) : null}
          </DocIdent>

          <ClusterGrid>
            {/* An account that reads left to right and ends on its result:
                Plan Qty − Covered by Production Orders = Pending, the number
                that decides whether this plan still needs one (ADR-185, the
                same definition the Plans list uses).

                Covered / Pending are computed for route-card plans only. An old
                `ops_source='plan'` plan is executed as a Job Card, not a
                Production Order, so the pair says nothing there — rather than
                print two zeroes that read as "nothing left to do", that case
                shows the two quantities it does have and lets Plan Qty be the
                result. */}
            {plan.derivedStatus ? (
              <Cluster name="Quantity">
                <ClusterFact num label="Order Qty" value={String(plan.orderQty)} />
                <ClusterFact
                  num
                  label="Plan Qty"
                  value={String(plan.planQty)}
                  after={<Chip changes={pendingChanges} field="planQty" />}
                />
                <ClusterFact
                  num
                  label="Covered"
                  title="On live Production Orders for this plan"
                  value={String(plan.coveredQty)}
                />
                <ClusterFact
                  num
                  lead
                  label="Pending"
                  title={`${plan.pendingQty} of ${plan.planQty} still to raise a Production Order for`}
                  value={String(plan.pendingQty)}
                />
              </Cluster>
            ) : (
              <Cluster name="Quantity">
                <ClusterFact
                  num
                  span={2}
                  label="Order Qty"
                  value={String(plan.orderQty)}
                  after={<Chip changes={pendingChanges} field="orderQty" />}
                />
                <ClusterFact
                  num
                  lead
                  span={2}
                  label="Plan Qty"
                  value={String(plan.planQty)}
                  after={<Chip changes={pendingChanges} field="planQty" />}
                />
              </Cluster>
            )}

            {/* The dates in the order they happen, ending on the one the
                customer actually cares about. */}
            <Cluster name="Schedule">
              <ClusterFact
                num
                label="Plan Date"
                empty={!plan.planDate}
                value={fmtDate(plan.planDate)}
                after={<Chip changes={pendingChanges} field="planDate" />}
              />
              <ClusterFact
                num
                label="Planned Start Date"
                empty={!plan.plannedStartDate}
                value={fmtDate(plan.plannedStartDate)}
                after={<Chip changes={pendingChanges} field="plannedStartDate" />}
              />
              <ClusterFact
                num
                label="Planned End Date"
                empty={!plan.plannedEndDate}
                value={fmtDate(plan.plannedEndDate)}
                after={<Chip changes={pendingChanges} field="plannedEndDate" />}
              />
              <ClusterFact
                num
                label="Customer Dispatch Date"
                empty={!plan.customerDispatchDate}
                value={fmtDate(plan.customerDispatchDate)}
                after={<Chip changes={pendingChanges} field="customerDispatchDate" />}
              />
            </Cluster>

            {/* Both are optional, so a plan with neither still shows the pair as
                dashes rather than hiding them — a missing grade is a planning
                gap worth seeing, not an empty field worth removing. */}
            <Cluster name="Material">
              <ClusterFact
                label="RM Grade"
                empty={!plan.rawMaterialGradeText}
                title={plan.rawMaterialGradeText ?? undefined}
                value={plan.rawMaterialGradeText ?? '—'}
                after={<Chip changes={pendingChanges} field="rawMaterialGradeText" />}
              />
              <ClusterFact
                label="RM Size"
                empty={!plan.rawMaterialSizeText}
                title={plan.rawMaterialSizeText ?? undefined}
                value={plan.rawMaterialSizeText ?? '—'}
                after={<Chip changes={pendingChanges} field="rawMaterialSizeText" />}
              />
              <ClusterFact
                span={2}
                wrap
                label="Remarks"
                empty={!plan.remarks}
                value={plan.remarks ?? '—'}
                after={<Chip changes={pendingChanges} field="remarks" />}
              />
            </Cluster>

            {/* Buy — what we are buying finished, from whom, and whether the PR
                for it exists yet. */}
            {plan.planType === 'direct_purchase' ? (
              <Cluster name="Buy">
                <ClusterFact
                  span={priceHidden ? 2 : 1}
                  label="Vendor"
                  empty={!plan.dpVendorCodeText}
                  value={plan.dpVendorCodeText ?? '—'}
                  after={<Chip changes={pendingChanges} field="dpVendorCodeText" />}
                />
                {priceHidden ? null : (
                  <ClusterFact num label="Cost" empty={!plan.dpCost} value={plan.dpCost ?? '—'} />
                )}
                <ClusterFact
                  label="PR"
                  empty={!plan.dpPrId}
                  value={plan.dpPrId ? '✓ Created' : '—'}
                />
                <ClusterFact
                  wrap
                  label="Remarks"
                  empty={!plan.dpRemarks}
                  value={plan.dpRemarks ?? '—'}
                  after={<Chip changes={pendingChanges} field="dpRemarks" />}
                />
              </Cluster>
            ) : null}

            {/* Full Outsource — who does the whole job, on what terms, out of
                whose material, and which of the two PRs are raised. Nine facts,
                so the second row continues without a name of its own. */}
            {plan.planType === 'full_outsource' ? (
              <>
                <Cluster name="Outsource">
                  <ClusterFact
                    label="JW Vendor"
                    empty={!plan.foVendorCodeText}
                    value={plan.foVendorCodeText ?? '—'}
                    after={<Chip changes={pendingChanges} field="foVendorCodeText" />}
                  />
                  <ClusterFact
                    span={priceHidden ? 2 : 1}
                    label="Process"
                    empty={!plan.foProcess}
                    title={plan.foProcess ?? undefined}
                    value={plan.foProcess ?? '—'}
                    after={<Chip changes={pendingChanges} field="foProcess" />}
                  />
                  {priceHidden ? null : (
                    <ClusterFact num label="Rate" empty={!plan.foRate} value={plan.foRate ?? '—'} />
                  )}
                  <ClusterFact
                    label="Material Source"
                    empty={!plan.foMaterialSrc}
                    value={plan.foMaterialSrc ?? '—'}
                    after={<Chip changes={pendingChanges} field="foMaterialSrc" />}
                  />
                </Cluster>
                <Cluster>
                  <ClusterFact
                    num
                    label="Delivery Date"
                    empty={!plan.foDeliveryDate}
                    value={fmtDate(plan.foDeliveryDate)}
                    after={<Chip changes={pendingChanges} field="foDeliveryDate" />}
                  />
                  <ClusterFact
                    label="Cost Centre"
                    empty={!plan.foCostCenter}
                    value={plan.foCostCenter ?? '—'}
                    after={<Chip changes={pendingChanges} field="foCostCenter" />}
                  />
                  <ClusterFact
                    label="JW PR"
                    empty={!plan.foPrId}
                    value={plan.foPrId ? '✓ Created' : '—'}
                  />
                  <ClusterFact
                    label="Material PR"
                    empty={!plan.foMatPrId}
                    value={plan.foMatPrId ? '✓ Created' : '—'}
                  />
                </Cluster>
                {plan.foRemarks || headerPendingChange(pendingChanges, 'foRemarks') ? (
                  <Cluster>
                    <ClusterFact
                      span={4}
                      wrap
                      label="Remarks"
                      empty={!plan.foRemarks}
                      value={plan.foRemarks ?? '—'}
                      after={<Chip changes={pendingChanges} field="foRemarks" />}
                    />
                  </Cluster>
                ) : null}
              </>
            ) : null}

            {/* The Job Card an executed manufacture / assembly plan produced. */}
            {(plan.planType === 'manufacture' || plan.planType === 'assembly') && plan.jcId ? (
              <Cluster name="Execution">
                <ClusterFact span={4} label="Job Card" value="✓ Created" />
              </Cluster>
            ) : null}
          </ClusterGrid>
        </div>
      </div>

      {/* The plan's own operations. Old `ops_source='plan'` plans carry them; a
          route-card plan does not — its Route Card owns the route, and an empty
          panel here would read as "this plan has no route". Before this pass the
          operations were shown nowhere on the page. */}
      {fromRouteCard ? null : (
        <div className="panel">
          <div className="panel-hdr">
            <div className="panel-title">Operations</div>
            <span className="text3" style={{ fontSize: 12 }}>
              {plan.ops.length} {plan.ops.length === 1 ? 'op' : 'ops'}
            </span>
          </div>
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Op</th>
                  <th>Operation</th>
                  <th>Op Type</th>
                  <th>Planned Machine</th>
                  <th>Cycle Time (min)</th>
                  <th>QC Required</th>
                  <th>OSP Vendor</th>
                  {priceHidden ? null : <th>OSP Cost</th>}
                </tr>
              </thead>
              <tbody>
                {plan.ops.length === 0 ? (
                  <tr>
                    <td colSpan={priceHidden ? 7 : 8} className="empty-state">
                      No operations on this plan.
                    </td>
                  </tr>
                ) : (
                  plan.ops.map((op) => (
                    <tr key={op.id}>
                      {/* 10, 20, 30 on screen — display rule, see opSrNo */}
                      <td>{opSrNo(op.opSeq)}</td>
                      <td>{op.operation}</td>
                      <td>{OP_TYPE_LABEL[op.opType] ?? op.opType}</td>
                      <td>{op.machineCodeText ?? '—'}</td>
                      <td>{op.cycleTimeMin}</td>
                      <td>{op.qcRequired ? '✓' : ''}</td>
                      <td>{op.outsourceVendorText ?? '—'}</td>
                      {priceHidden ? null : <td>{op.outsourceCost}</td>}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <RelatedDocsPanel module="plans" id={plan.id} />

      <Panel title="History" bodyPadding="none">
        <DocumentHistory entity="Plan" entityId={plan.id} refId={plan.code} />
      </Panel>

      {confirmDelete ? (
        // The modal owns the wait and shows a refusal inside itself.
        <PlanDeleteModal
          id={plan.id}
          code={plan.code}
          onClose={() => setConfirmDelete(false)}
          onDeleted={() => void navigate({ to: '/plans', replace: true })}
        />
      ) : null}
    </div>
  );
}

/** ADR-202 — the amber "→ after" chip for a record field with a staged edit
 *  waiting for approval. Matched on the plan edit diff's field key. Renders
 *  nothing when no edit is pending for that field. */
function Chip(props: {
  changes: readonly DocumentEditChange[];
  field: string;
}): React.JSX.Element | null {
  const c = headerPendingChange(props.changes, props.field);
  return c ? <PendingChangeChip after={c.after} /> : null;
}
