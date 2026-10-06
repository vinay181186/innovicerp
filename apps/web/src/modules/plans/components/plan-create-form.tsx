// New Plan page body (/plans/new). Makes EXACTLY the plan SO Planning "+ Plan"
// makes (create-plan-modal.tsx, ADR-170): a Route-Card plan — qty, schedule,
// raw material and a remark; its operations come from the item's Route Card
// when the Production Order is raised, so there is no ops editor here.
//
// Before: this page had its own form — typed "SO No." + "Ln" + a raw "SO line
// id (UUID)" box, a Plan Type with "Buy", hand-typed operations and vendor
// id boxes — and saved a different kind of plan ('In Planning', own ops) under
// the same name. A typed SO with no UUID made an unlinked plan the over-plan
// check never saw. Now the SO / JWSO and its line are PICKED, which fills the
// item, Order Qty and Pending to Plan from the line itself.
//
// Buy lines are not planned (ADR-171): they get "+ PR" on SO Planning. BOM
// lines are planned from SO Planning's BOM Planning box.

import type { CreatePlanInput, PlanningDetailResponse, PlanningLine } from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { addDaysLocal, todayLocal } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import {
  MaterialValueDisplay,
  RM_SOURCE_HELP,
  RawMaterialGroup,
} from '@/modules/raw-material/components/raw-material-pickers';
import { usePlanningSoDetail, usePlanningSoList } from '@/modules/so-planning/api';
import { soNoWithInternal } from '@/lib/so-number';
import { Banner } from '@/ui/feedback';
import { SearchableSelect } from '@/ui/forms';
import { PageHeader, useSaveShortcut } from '@/ui/layout';
import { useDefaultRouteOps } from '../api';
import { PLAN_DEFAULT_SPAN_DAYS } from './plan-form';

/** Why a line cannot be planned on this page, or null when it can. */
function lineBlocker(so: PlanningDetailResponse, line: PlanningLine): string | null {
  if (line.itemProcurementType === 'buy') {
    return so.source === 'jw'
      ? 'Buy item — customer material, not planned.'
      : 'Buy item — not planned. Use + PR on SO Planning.';
  }
  if (line.hasEquipmentBom || line.hasAssemblyBom) {
    return 'BOM line — plan it with BOM Planning on SO Planning.';
  }
  if (!line.itemId) {
    return 'This line has no Item Master item — a Production Order needs one to find its Route Card.';
  }
  if (line.remaining <= 0) return 'Fully planned — nothing pending to plan.';
  return null;
}

interface Props {
  onSave: (input: CreatePlanInput) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  submitError: string | null;
}

export function PlanCreateForm({
  onSave,
  onCancel,
  isSubmitting,
  submitError,
}: Props): React.JSX.Element {
  const [dirty, setDirty] = useState(false);
  const onDirty = (): void => setDirty(true);
  const [err, setErr] = useState<string | null>(null);
  const { data: soList, isLoading: soListLoading } = usePlanningSoList();
  const [soId, setSoId] = useState<string | null>(null);
  const [soLineId, setSoLineId] = useState<string | null>(null);
  const { data: so, isFetching: soLoading } = usePlanningSoDetail(soId);
  const line = so?.lines.find((l) => l.soLineId === soLineId) ?? null;

  const [planQty, setPlanQty] = useState<number>(0);
  const [plannedStartDate, setPlannedStartDate] = useState(todayLocal());
  const [plannedEndDate, setPlannedEndDate] = useState(
    addDaysLocal(todayLocal(), PLAN_DEFAULT_SPAN_DAYS),
  );
  const [customerDispatchDate, setCustomerDispatchDate] = useState('');
  const [remarks, setRemarks] = useState('');

  // Orders that still have something to plan. A fully planned order has no
  // line this page could save against.
  const soOptions = useMemo(
    () =>
      (soList?.items ?? [])
        .filter((o) => o.planningStatus !== 'fully_planned')
        .map((o) => ({
          id: o.soId,
          code: soNoWithInternal(o.soCode, o.soInternalNo),
          name: `${o.source === 'jw' ? 'JWSO · ' : ''}${o.customerName ?? ''}`,
        })),
    [soList],
  );

  const lineOptions = useMemo(
    () =>
      (so?.lines ?? []).map((l) => ({
        id: l.soLineId,
        code: `Ln ${l.lineNo}${l.clientPoLineNo ? ` · POL ${l.clientPoLineNo}` : ''}`,
        name: `${itemCodeWithRev(l.itemCode, l.itemRevision, l.itemName ?? '')} · To Plan ${l.remaining}`,
      })),
    [so],
  );

  const blocker = so && line ? lineBlocker(so, line) : null;

  // Picking a line fills the numbers from it, exactly as "+ Plan" opens:
  // Plan Qty = what still has to be MADE after free stock, Customer Dispatch
  // Date = the line's due date.
  useEffect(() => {
    if (!line) return;
    setPlanQty(Math.max(0, line.remaining - line.stockQty) || line.remaining);
    setCustomerDispatchDate(line.dueDate ? line.dueDate.slice(0, 10) : '');
  }, [line?.soLineId]);

  // ADR-217 — raw material is read here, never set. The item's Route Card is
  // what the server will copy onto this plan, so the same lookup that loads the
  // operations also supplies the two values SHOWN below. A different line is a
  // different item, so the lookup (and the display) follows the picked line.
  const { data: defaultOps } = useDefaultRouteOps(line?.itemId ?? null);
  const hasRouteCard = !!defaultOps && defaultOps.ops.length > 0;

  const build = (): { input: CreatePlanInput } | { error: string } => {
    if (!so || !line) return { error: 'Pick the SO / JWSO and its line to plan.' };
    if (blocker) return { error: blocker };
    if (!Number.isInteger(planQty) || planQty <= 0) {
      return { error: 'Plan Qty must be greater than 0.' };
    }
    if (planQty > line.remaining) {
      return { error: `Plan Qty cannot be more than Pending to Plan (${line.remaining}).` };
    }
    if (!plannedStartDate || !plannedEndDate) {
      return { error: 'Planned Start and Planned End dates are required.' };
    }
    if (plannedEndDate < plannedStartDate) {
      return { error: 'Planned End Date cannot be before Planned Start Date.' };
    }
    // ADR-217 — RM Grade / RM Size are NEVER sent from here. They have one
    // author: the part's Route Card, or the BOM line for a BOM child. Server
    // contract (apps/api/src/modules/plans/service.ts, createPlan): a field
    // that IS sent — a value OR an explicit null — means "the caller owns this
    // pair, do not default it", and only an OMITTED pair is filled from the
    // BOM line / Route Card. So both pairs are OMITTED, never sent as null.
    const input: CreatePlanInput = {
      // code omitted → server assigns the next sequential PLN-NNNN.
      planDate: todayLocal(),
      planType: 'manufacture',
      // Route-Card plan: the server stores it 'planned', takes the plan type
      // from the item's Route Card and keeps no operations of its own.
      opsSource: 'route_card',
      ...(so.source === 'jw' ? { jwLineId: line.soLineId } : { soLineId: line.soLineId }),
      soCodeText: so.soCode,
      lineNo: line.lineNo,
      itemId: line.itemId ?? null,
      itemCodeText: line.itemCode ?? '',
      itemNameText: line.itemName ?? '',
      orderQty: line.orderQty,
      planQty,
      plannedStartDate,
      plannedEndDate,
      customerDispatchDate: customerDispatchDate || null,
      remarks: remarks.trim() === '' ? null : remarks.trim(),
    };
    return { input };
  };
  const save = (): void => {
    const r = build();
    if ('error' in r) {
      setErr(r.error);
      return;
    }
    setErr(null);
    onSave(r.input);
  };
  useSaveShortcut(save, !isSubmitting);
  const shownError = err ?? submitError;

  const edit =
    <T,>(set: (v: T) => void) =>
    (v: T): void => {
      set(v);
      onDirty();
    };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <PageHeader
        title="New Plan"
        icon="📅"
        backLabel="Back to Plans"
        onBack={onCancel}
        sticky
        dirty={dirty}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={isSubmitting || Boolean(blocker) || !line}
              onClick={save}
            >
              {isSubmitting ? 'Saving…' : 'Save Plan'}
            </button>
          </>
        }
      >
        {shownError ? (
          <Banner tone="error" role="alert" flush>
            {shownError}
          </Banner>
        ) : null}
      </PageHeader>
      <div className="panel">
        <div className="panel-hdr">
          <div className="panel-title">Order &amp; Line</div>
        </div>
        <div
          className="panel-body"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 10,
          }}
        >
          <Field label="SO / JWSO No." required>
            <SearchableSelect
              value={soId}
              onChange={(id) => {
                setSoId(id);
                setSoLineId(null);
                onDirty();
              }}
              options={soOptions}
              loading={soListLoading}
              placeholder="🔍 Type SO / JWSO No. or customer…"
              emptyText="No order with anything left to plan"
            />
          </Field>
          <Field label="Line" required>
            <SearchableSelect
              value={soLineId}
              onChange={edit(setSoLineId)}
              options={lineOptions}
              loading={soLoading}
              disabled={!soId}
              placeholder={soId ? '🔍 Pick the line — Ln / POL / CODE/REV' : 'Pick the order first'}
              emptyText="This order has no lines"
            />
          </Field>
        </div>
        {so && line ? (
          <div className="panel-body" style={{ paddingTop: 0 }}>
            <div
              style={{
                display: 'flex',
                gap: 20,
                flexWrap: 'wrap',
                background: 'var(--bg3)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 12,
              }}
            >
              <Fact label={so.source === 'jw' ? 'JWSO' : 'SO'}>
                <b className="mono">
                  {soNoWithInternal(so.soCode, so.soInternalNo)} Ln {line.lineNo}
                </b>
                {line.clientPoLineNo ? (
                  <span className="text2" style={{ marginLeft: 6 }}>
                    POL {line.clientPoLineNo}
                  </span>
                ) : null}
              </Fact>
              <Fact label="Item">
                {/* Item code is the main thing: strong mono, darkest text. */}
                <b className="mono" style={{ color: 'var(--text)', whiteSpace: 'nowrap' }}>
                  {itemCodeWithRev(line.itemCode, line.itemRevision)}
                </b>
                {line.itemName ? (
                  <span className="text2" style={{ fontSize: 12, marginLeft: 6 }}>
                    {line.itemName}
                  </span>
                ) : null}
              </Fact>
              <Fact label="Order Qty">
                <b className="mono">{line.orderQty}</b>
              </Fact>
              <Fact label="Plan Qty">
                <b className="mono" style={{ color: 'var(--cyan)' }}>
                  {line.totalPlanned}
                </b>
              </Fact>
              <Fact label="To Plan">
                <b className="mono" style={{ color: 'var(--green2)' }}>
                  {line.remaining}
                </b>
              </Fact>
              <Fact label="Available">
                <b className="mono">{line.stockQty}</b>
              </Fact>
            </div>
          </div>
        ) : null}
      </div>

      {blocker ? (
        <Banner tone="warn" flush>
          {blocker}{' '}
          <Link
            to="/planning"
            search={so ? { soId: so.soId, src: so.source } : {}}
            className="fw-700"
            style={{ color: 'var(--blue)' }}
          >
            Open SO Planning →
          </Link>
        </Banner>
      ) : null}

      {line && !blocker ? (
        <>
          <div className="panel">
            <div className="panel-hdr">
              <div className="panel-title">Plan</div>
            </div>
            <div
              className="panel-body"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 10,
              }}
            >
              <Field label="Plan Qty" required>
                <input
                  type="number"
                  min={1}
                  max={line.remaining}
                  className="innovic-input"
                  value={planQty}
                  onChange={(e) => edit(setPlanQty)(Number(e.target.value))}
                />
                <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
                  Max {line.remaining}
                </div>
              </Field>
              <Field label="Planned Start Date" required>
                <input
                  type="date"
                  className="innovic-input"
                  value={plannedStartDate}
                  onChange={(e) => edit(setPlannedStartDate)(e.target.value)}
                />
              </Field>
              <Field label="Planned End Date" required>
                <input
                  type="date"
                  className="innovic-input"
                  value={plannedEndDate}
                  onChange={(e) => edit(setPlannedEndDate)(e.target.value)}
                />
              </Field>
              <Field label="Customer Dispatch Date">
                <input
                  type="date"
                  className="innovic-input"
                  value={customerDispatchDate}
                  onChange={(e) => edit(setCustomerDispatchDate)(e.target.value)}
                />
              </Field>
              {/* ADR-217 — shown, not picked. These are the values the new plan
                  will be given; the Route Card (or the BOM line) owns them. */}
              <div style={{ gridColumn: 'span 2', minWidth: 0 }}>
                <RawMaterialGroup>
                  <Field label="RM Grade">
                    <MaterialValueDisplay value={defaultOps?.rawMaterialGradeText} />
                  </Field>
                  <Field label="RM Size">
                    <MaterialValueDisplay value={defaultOps?.rawMaterialSizeText} />
                  </Field>
                </RawMaterialGroup>
                <div className="text3" style={{ fontSize: 11, marginTop: 4 }}>
                  {RM_SOURCE_HELP}
                </div>
              </div>
              <Field label="Plan Remarks" full>
                <textarea
                  className="innovic-input"
                  rows={2}
                  maxLength={500}
                  value={remarks}
                  onChange={(e) => edit(setRemarks)(e.target.value)}
                />
              </Field>
            </div>
          </div>
          {defaultOps && !hasRouteCard ? (
            <div className="panel">
              <div className="panel-body text3" style={{ fontSize: 12 }}>
                <span style={{ color: 'var(--amber2)' }}>
                  This item has no Route Card yet — make one before the Production Order.
                </span>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <span style={{ fontSize: 11, color: 'var(--text3)' }}>{label}</span>
      <br />
      {children}
    </div>
  );
}

function Field({
  label,
  children,
  full,
  required,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
  required?: boolean;
}): React.JSX.Element {
  return (
    <div style={full ? { gridColumn: '1 / -1' } : undefined}>
      <label className="text3" style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>
        {label}
        {required ? <span className="req">★</span> : null}
      </label>
      {children}
    </div>
  );
}
