// BOM Planning modal (PL-4b §8 + §9). Covers both:
//   §8 Equipment SO with bomMasterId (`mode='equipment'`)
//   §9 Assembly item where sales_order_lines.sourceBomMasterId is set
//
// Shows the BOM explosion (per child item: qty/set × orderQty = totalNeed,
// stock, shortfall) and lets the planner select which children to plan +
// what qty for each. Save creates one in_planning plan per checked child.
// Existing plans are shown disabled.

import type {
  PlanningBomChild,
  PlanningBomResponse,
  CreatePlanInput,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCreatePlan } from '@/modules/plans/api';
import { usePlanningBom } from '../api';
import { Modal } from './modal';

interface Props {
  mode: 'equipment' | 'assembly';
  soId: string;
  soCode: string;
  soLineId: string;
  onClose: () => void;
  onSaved: () => void;
}

type RowState = {
  checked: boolean;
  qty: number;
};

function nextPlanCode(): string {
  const ts = Date.now().toString(36).toUpperCase().slice(-6);
  return `PLN-${ts}`;
}

export function BomPlanningModal({
  mode,
  soId,
  soCode,
  soLineId,
  onClose,
  onSaved,
}: Props): JSX.Element {
  const { data, isLoading, error } = usePlanningBom(soId, soLineId);
  const createPlan = useCreatePlan();
  const [rowState, setRowState] = useState<Map<string, RowState>>(new Map());
  const [planAssembly, setPlanAssembly] = useState<boolean>(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (!data) return;
    const next = new Map<string, RowState>();
    for (const c of data.children) {
      const hasShortfall = c.shortfall > 0;
      next.set(c.childItemCode, {
        checked: !c.existingPlan && hasShortfall,
        qty: c.shortfall,
      });
    }
    setRowState(next);
    if (data.supportsAssemblyPlan && !data.hasAssemblyPlan) setPlanAssembly(true);
  }, [data]);

  const submit = async () => {
    if (!data) return;
    setSubmitErr(null);
    setSubmitting(true);
    let plansCreated = 0;
    try {
      for (const c of data.children) {
        if (c.existingPlan) continue;
        const s = rowState.get(c.childItemCode);
        if (!s || !s.checked || s.qty <= 0) continue;
        const qty = Math.min(s.qty, c.totalNeed);
        const planType: 'manufacture' | 'direct_purchase' =
          c.bomType === 'purchase' ? 'direct_purchase' : 'manufacture';
        const input: CreatePlanInput = {
          code: nextPlanCode() + '-' + plansCreated.toString(36).toUpperCase(),
          planDate: new Date().toISOString().slice(0, 10),
          planType,
          soLineId,
          soCodeText: soCode,
          itemId: c.childItemId,
          itemCodeText: c.childItemCode,
          itemNameText: c.childItemName,
          orderQty: c.totalNeed,
          planQty: qty,
          bomMasterId: data.bomMasterId,
          bomParentCode: data.parentItemCode ?? null,
          bomChildCode: c.childItemCode,
        };
        await createPlan.mutateAsync(input);
        plansCreated++;
      }
      if (data.supportsAssemblyPlan && !data.hasAssemblyPlan && planAssembly) {
        const input: CreatePlanInput = {
          code: nextPlanCode() + '-ASSY',
          planDate: new Date().toISOString().slice(0, 10),
          planType: 'assembly',
          soLineId,
          soCodeText: soCode,
          itemCodeText: data.parentItemCode ?? '',
          itemNameText: data.parentItemName ?? '',
          orderQty: data.orderQty,
          planQty: data.orderQty,
          bomMasterId: data.bomMasterId,
          bomParentCode: data.parentItemCode ?? null,
        };
        await createPlan.mutateAsync(input);
        plansCreated++;
      }
      if (plansCreated === 0) {
        setSubmitErr('No plans to create. Check at least one item.');
        return;
      }
      onSaved();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setSubmitting(false);
    }
  };

  const unplannedCount = data?.children.filter((c) => !c.existingPlan).length ?? 0;

  const title =
    mode === 'equipment'
      ? `📦 Equipment BOM Planning — ${soCode}`
      : `📦 BOM Planning — ${data?.parentItemCode ?? ''} × ${data?.orderQty ?? ''}`;

  const footer = (
    <>
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
      <button
        type="button"
        className="btn btn-primary"
        disabled={submitting || isLoading || !data}
        onClick={submit}
      >
        {submitting ? (
          <>
            <Loader2 className="inline-block animate-spin" style={{ width: 14, height: 14 }} />{' '}
            …
          </>
        ) : (
          `Create ${unplannedCount} Plans`
        )}
      </button>
    </>
  );

  return (
    <Modal title={title} size="lg" onClose={onClose} footer={footer}>
      {isLoading && (
        <div className="empty-state" style={{ padding: 30 }}>
          <Loader2 className="inline-block animate-spin" /> Loading BOM…
        </div>
      )}
      {error && (
        <div
          style={{
            padding: 8,
            borderRadius: 4,
            background: 'rgba(239,68,68,0.1)',
            color: 'var(--red)',
            fontSize: 12,
          }}
        >
          {error instanceof Error ? error.message : 'Failed to load BOM'}
        </div>
      )}
      {data && <BomBody mode={mode} data={data} rowState={rowState} setRowState={setRowState} planAssembly={planAssembly} setPlanAssembly={setPlanAssembly} submitErr={submitErr} />}
    </Modal>
  );
}

function BomBody({
  mode,
  data,
  rowState,
  setRowState,
  planAssembly,
  setPlanAssembly,
  submitErr,
}: {
  mode: 'equipment' | 'assembly';
  data: PlanningBomResponse;
  rowState: Map<string, RowState>;
  setRowState: React.Dispatch<React.SetStateAction<Map<string, RowState>>>;
  planAssembly: boolean;
  setPlanAssembly: React.Dispatch<React.SetStateAction<boolean>>;
  submitErr: string | null;
}): JSX.Element {
  const update = (childCode: string, patch: Partial<RowState>) => {
    setRowState((prev) => {
      const next = new Map(prev);
      const cur = next.get(childCode) ?? { checked: false, qty: 0 };
      next.set(childCode, { ...cur, ...patch });
      return next;
    });
  };

  return (
    <>
      <div
        style={{
          background: 'var(--bg3)',
          padding: 12,
          borderRadius: 8,
          border: '1px solid var(--border)',
          marginBottom: 14,
        }}
      >
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {mode === 'equipment' ? (
            <>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>EQUIPMENT SO</span>
                <br />
                <b style={{ color: 'var(--cyan)' }}>{data.soCode}</b>
              </div>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>EQUIPMENT</span>
                <br />
                <b style={{ color: 'var(--purple)' }}>
                  {data.parentItemCode} {data.parentItemName}
                </b>
              </div>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>EQUIP QTY</span>
                <br />
                <b style={{ fontSize: 18 }}>{data.orderQty}</b>
              </div>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>BOM</span>
                <br />
                <b style={{ color: 'var(--green)' }}>
                  {data.bomNo} Rev {data.bomRev}
                </b>
              </div>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>BOM ITEMS</span>
                <br />
                <b style={{ fontSize: 18 }}>{data.children.length}</b>
              </div>
            </>
          ) : (
            <>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>ASSEMBLY</span>
                <br />
                <b style={{ color: 'var(--purple)' }}>{data.parentItemCode}</b>{' '}
                {data.parentItemName}
              </div>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>SO/JW</span>
                <br />
                <b className="mono">{data.soCode}</b>
              </div>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>ORDER QTY</span>
                <br />
                <b style={{ fontSize: 18 }}>{data.orderQty}</b> units
              </div>
              <div>
                <span style={{ fontSize: 10, color: 'var(--text3)' }}>BOM ITEMS</span>
                <br />
                <b style={{ fontSize: 18 }}>{data.children.length}</b>
              </div>
            </>
          )}
        </div>
      </div>

      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--cyan)',
          marginBottom: 8,
        }}
      >
        📦 BOM Explosion — {data.orderQty} {mode === 'equipment' ? 'sets' : 'units'} ×{' '}
        {data.bomNo}
      </div>

      <div
        className="tbl-wrap"
        style={{
          marginBottom: 14,
          border: '1px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <table style={{ width: '100%' }}>
          <thead>
            <tr style={{ background: 'var(--bg4)' }}>
              <th>#</th>
              <th>{mode === 'equipment' ? 'Item Code' : 'Child Item'}</th>
              <th>{mode === 'equipment' ? 'Item Name' : 'Name'}</th>
              <th>{mode === 'equipment' ? 'Qty/Set' : 'Per Unit'}</th>
              <th>Total Need</th>
              <th style={{ color: 'var(--green)' }}>Stock</th>
              <th style={{ color: 'var(--red)' }}>Shortfall</th>
              <th>Type</th>
              <th>Plan Status</th>
              <th>Plan?</th>
              <th>{mode === 'equipment' ? 'Qty' : 'Qty to Plan'}</th>
            </tr>
          </thead>
          <tbody>
            {data.children.map((c: PlanningBomChild, i) => {
              const s = rowState.get(c.childItemCode) ?? { checked: false, qty: c.shortfall };
              const hasSufficient = c.shortfall === 0;
              const typeIcon =
                c.bomType === 'manufacture'
                  ? '🏭 Mfg'
                  : c.bomType === 'purchase'
                    ? '🛒 Buy'
                    : '🏭 Outsrc';
              const typeColor =
                c.bomType === 'manufacture'
                  ? 'var(--cyan)'
                  : c.bomType === 'purchase'
                    ? 'var(--green)'
                    : 'var(--amber)';
              return (
                <tr
                  key={c.childItemCode}
                  style={{ background: hasSufficient ? 'rgba(34,197,94,0.04)' : 'var(--bg)' }}
                >
                  <td className="td-ctr mono fw-700">{i + 1}</td>
                  <td style={{ color: 'var(--purple)', fontWeight: 600 }}>{c.childItemCode}</td>
                  <td>{c.childItemName}</td>
                  <td className="td-ctr">{c.qtyPerSet}</td>
                  <td className="td-ctr fw-700">{c.totalNeed}</td>
                  <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
                    {c.stockQty}
                  </td>
                  <td
                    className="td-ctr mono fw-700"
                    style={{ color: c.shortfall > 0 ? 'var(--red)' : 'var(--green)' }}
                  >
                    {c.shortfall}
                    {hasSufficient ? ' ✅' : ''}
                  </td>
                  <td>
                    <span style={{ color: typeColor, fontSize: 11, fontWeight: 700 }}>
                      {typeIcon}
                    </span>
                  </td>
                  <td style={{ minWidth: 120 }}>
                    {c.existingPlan ? (
                      <span style={{ fontWeight: 700, color: 'var(--cyan)' }}>
                        {c.existingPlan.planStatus}{' '}
                        {c.existingPlan.jcCode ? (
                          <span className="mono" style={{ fontSize: 10 }}>
                            {c.existingPlan.jcCode}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text3)', fontSize: 11 }}>Not planned</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      disabled={!!c.existingPlan}
                      checked={c.existingPlan ? true : s.checked}
                      onChange={(e) => update(c.childItemCode, { checked: e.target.checked })}
                      style={{ width: 16, height: 16, accentColor: 'var(--cyan)' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={c.totalNeed}
                      disabled={!!c.existingPlan}
                      value={c.existingPlan ? c.existingPlan.planQty : s.qty}
                      onChange={(e) => update(c.childItemCode, { qty: Number(e.target.value) })}
                      style={{
                        width: 70,
                        textAlign: 'center',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data.supportsAssemblyPlan && (
        <div
          style={{
            padding: '10px 14px',
            background: 'var(--bg3)',
            borderRadius: 8,
            border: '1px solid var(--border)',
            marginBottom: 14,
          }}
        >
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              cursor: data.hasAssemblyPlan ? 'not-allowed' : 'pointer',
            }}
          >
            <input
              type="checkbox"
              disabled={data.hasAssemblyPlan}
              checked={data.hasAssemblyPlan || planAssembly}
              onChange={(e) => setPlanAssembly(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--green)' }}
            />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>
              🛠 Final Assembly Job Card
            </span>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>
              (created after child items are ready — operations planned separately)
            </span>
            {data.hasAssemblyPlan ? (
              <span style={{ fontWeight: 700, color: 'var(--cyan)', fontSize: 11 }}>
                — already created
              </span>
            ) : null}
          </label>
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>
        ℹ Total Need = {mode === 'equipment' ? 'Equipment Qty' : 'Order Qty'} × Qty per Set.
        Shortfall = Total Need − Current Stock.
      </div>

      {submitErr ? (
        <div
          style={{
            padding: 8,
            borderRadius: 4,
            background: 'rgba(239,68,68,0.1)',
            color: 'var(--red)',
            fontSize: 12,
          }}
        >
          {submitErr}
        </div>
      ) : null}
    </>
  );
}
