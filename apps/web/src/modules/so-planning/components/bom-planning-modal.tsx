// BOM Planning modal (PL-4b §8 + §9). Covers both:
//   §8 Equipment SO with bomMasterId (`mode='equipment'`)
//   §9 Assembly item where sales_order_lines.sourceBomMasterId is set
//
// Shows the BOM explosion (per child item: qty/set × orderQty = totalNeed,
// stock, shortfall) and lets the planner select which children to plan +
// what qty for each. Save creates one in_planning plan per checked child.
// Existing plans are shown disabled.

import type {
  PlanStatus,
  PlanningBomChild,
  PlanningBomResponse,
  CreatePlanInput,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { todayLocal } from '@/lib/date';
import { useCreatePlan } from '@/modules/plans/api';
import { useVendorsList } from '@/modules/vendors/api';
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
  /** Vendor for the types that cannot be planned without one — see NEEDS_VENDOR. */
  vendorId: string | null;
  vendorLabel: string;
  /** full_outsource also demands a process description. */
  process: string;
};

// A BOM line type maps to the plan type that actually does the work:
//   manufacture -> make it here          (job card, no vendor)
//   purchase    -> buy the finished part (direct_purchase, needs a vendor)
//   outsource   -> send it to a vendor   (full_outsource, needs vendor + process)
//
// `outsource` used to fall into the manufacture branch, so a BOM line marked
// Outsource quietly became an in-house job card — the type had no effect at all.
function planTypeFor(bomType: PlanningBomChild['bomType']): CreatePlanInput['planType'] {
  if (bomType === 'purchase') return 'direct_purchase';
  if (bomType === 'outsource') return 'full_outsource';
  return 'manufacture';
}

const NEEDS_VENDOR = new Set<PlanningBomChild['bomType']>(['purchase', 'outsource']);

// The BOM cascade stamps outsource PRs with operation='OUTSOURCE'; use the same
// word as the default so the two paths describe the work identically. Editable.
const DEFAULT_OSP_PROCESS = 'OUTSOURCE';

// Legacy renders the raw stored (Title Case) status text. Kept per-file, matching
// the plans module's existing convention (routes/list.tsx, detail.tsx, dashboard.tsx).
const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  in_planning: 'In Planning',
  planned: 'Planned',
  jc_created: 'JC Created',
  pr_created: 'PR Created',
  in_production: 'In Production',
  complete: 'Complete',
  cancelled: 'Cancelled',
};

// Status colour for the "Plan Status" cell. The two legacy builders differ:
// showBOMPlanning (assembly, L7137) has a 'PR Created' → purple branch;
// showEquipBOMPlanning (L8867) omits it, so PR Created falls through to green.
// Ported as-is rather than "corrected" — legacy is the spec.
function bomPlanStColor(status: PlanStatus, mode: 'equipment' | 'assembly'): string {
  if (status === 'in_planning') return 'var(--amber)';
  if (status === 'planned') return 'var(--blue)';
  if (status === 'jc_created') return 'var(--cyan)';
  if (status === 'pr_created' && mode === 'assembly') return 'var(--purple)';
  return 'var(--green)';
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
        vendorId: null,
        vendorLabel: '',
        process: c.bomType === 'outsource' ? DEFAULT_OSP_PROCESS : '',
      });
    }
    setRowState(next);
    if (data.supportsAssemblyPlan && !data.hasAssemblyPlan) setPlanAssembly(true);
  }, [data]);

  // Rows that are ticked but cannot be sent yet. Caught HERE so the planner is
  // told which row and what is missing, instead of the server's field-level
  // "dpVendorId: direct_purchase plan requires a vendor".
  const missing: string[] = [];
  for (const c of data?.children ?? []) {
    if (c.existingPlan) continue;
    const s = rowState.get(c.childItemCode);
    if (!s || !s.checked || s.qty <= 0) continue;
    if (NEEDS_VENDOR.has(c.bomType) && !s.vendorId) {
      missing.push(`${c.childItemCode} (${c.bomType}) — pick a vendor`);
    }
    if (c.bomType === 'outsource' && !s.process.trim()) {
      missing.push(`${c.childItemCode} (outsource) — describe the process`);
    }
  }

  const submit = async () => {
    if (!data) return;
    setSubmitErr(null);
    if (missing.length > 0) {
      setSubmitErr(`Cannot plan yet: ${missing.join('; ')}.`);
      return;
    }
    setSubmitting(true);
    let plansCreated = 0;
    // One child failing must NOT abandon the rest. The loop used to throw
    // straight out, so a purchase child that the server refused silently took
    // every child after it down with it: 3 ticked, 1 created, one message that
    // named neither of the two that were dropped.
    const failures: string[] = [];
    try {
      for (const c of data.children) {
        if (c.existingPlan) continue;
        const s = rowState.get(c.childItemCode);
        if (!s || !s.checked || s.qty <= 0) continue;
        const qty = Math.min(s.qty, c.totalNeed);
        const planType = planTypeFor(c.bomType);
        const input: CreatePlanInput = {
          // code omitted → server assigns the next sequential PLN-NNNN.
          planDate: todayLocal(),
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
          ...(planType === 'direct_purchase' ? { dpVendorId: s.vendorId } : {}),
          ...(planType === 'full_outsource'
            ? { foVendorId: s.vendorId, foProcess: s.process.trim() }
            : {}),
        };
        try {
          await createPlan.mutateAsync(input);
          plansCreated++;
        } catch (e) {
          failures.push(`${c.childItemCode}: ${e instanceof Error ? e.message : 'failed'}`);
        }
      }
      if (data.supportsAssemblyPlan && !data.hasAssemblyPlan && planAssembly) {
        const input: CreatePlanInput = {
          // code omitted → server assigns the next sequential PLN-NNNN.
          planDate: todayLocal(),
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
        try {
          await createPlan.mutateAsync(input);
          plansCreated++;
        } catch (e) {
          failures.push(`assembly: ${e instanceof Error ? e.message : 'failed'}`);
        }
      }
      if (failures.length > 0) {
        // Say what DID land as well as what did not — the planner has to know
        // the partial state before deciding what to do next.
        setSubmitErr(
          `${plansCreated} plan(s) created. ${failures.length} failed — ${failures.join('; ')}`,
        );
        if (plansCreated > 0) onSaved();
        return;
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
        className="btn btn-success"
        disabled={submitting || isLoading || !data}
        onClick={submit}
      >
        {submitting ? (
          <>
            <Loader2 className="inline-block animate-spin" style={{ width: 14, height: 14 }} />{' '}
            …
          </>
        ) : (
          // showModalLg with an explicit saveLabel → btn-success, and L28044
          // renders `&#10003; ${_saveLabel}` so the ✓ prefixes the label too.
          `✓ Create ${unplannedCount} Plans`
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
  // Vendors for the Buy / Outsource rows. Server-side search, one shared term —
  // only one picker is open at a time.
  const [vendorSearch, setVendorSearch] = useState('');
  const { data: vendorPage, isFetching: vendorsFetching } = useVendorsList({
    ...(vendorSearch.trim() ? { search: vendorSearch.trim() } : {}),
    limit: 50,
    offset: 0,
  });
  const vendors = useMemo(() => vendorPage?.vendors ?? [], [vendorPage]);
  const vendorOptions = useMemo(
    () => vendors.map((v) => ({ id: v.id, code: v.code, name: v.name })),
    [vendors],
  );

  const update = (childCode: string, patch: Partial<RowState>) => {
    setRowState((prev) => {
      const next = new Map(prev);
      const cur: RowState = next.get(childCode) ?? {
        checked: false,
        qty: 0,
        vendorId: null,
        vendorLabel: '',
        process: '',
      };
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
        {/* Equipment (L8899): "📦 BOM Explosion — N sets × BOM-NO".
            Assembly  (L7172): "📦 BOM Explosion — N units" — no BOM no. */}
        📦 BOM Explosion — {data.orderQty}{' '}
        {mode === 'equipment' ? `sets × ${data.bomNo}` : 'units'}
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
              const s = rowState.get(c.childItemCode) ?? {
                checked: false,
                qty: c.shortfall,
                vendorId: null,
                vendorLabel: '',
                process: '',
              };
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
                      <>
                        <span
                          style={{
                            fontWeight: 700,
                            color: bomPlanStColor(c.existingPlan.planStatus, mode),
                          }}
                        >
                          {PLAN_STATUS_LABEL[c.existingPlan.planStatus]}
                        </span>
                        {c.existingPlan.jcCode ? (
                          <>
                            {' '}
                            <span
                              className="mono"
                              style={{ fontSize: 10, color: 'var(--cyan)' }}
                            >
                              {c.existingPlan.jcCode}
                            </span>
                          </>
                        ) : null}
                        {/* Only the assembly builder shows the DP PR no. (L7141);
                            the equipment builder omits it. */}
                        {mode === 'assembly' && c.existingPlan.dpPrCode ? (
                          <>
                            {' '}
                            <span
                              className="mono"
                              style={{ fontSize: 10, color: 'var(--purple)' }}
                            >
                              {c.existingPlan.dpPrCode}
                            </span>
                          </>
                        ) : null}
                      </>
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
            {/* Buy and Outsource rows need a vendor before a plan can exist
                (and Outsource a process too). A second row under the item
                rather than another column: the table already carries eleven,
                and only two of the three types ever need these. */}
            {data.children.map((c: PlanningBomChild) => {
              if (c.existingPlan || !NEEDS_VENDOR.has(c.bomType)) return null;
              const s = rowState.get(c.childItemCode);
              if (!s?.checked) return null;
              const needProcess = c.bomType === 'outsource';
              return (
                <tr key={`${c.childItemCode}-vendor`} style={{ background: 'var(--bg3)' }}>
                  <td />
                  <td colSpan={10} style={{ padding: '8px 10px' }}>
                    <div
                      style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700 }}>
                        ↳ {c.childItemCode} · {c.bomType === 'purchase' ? 'Buy from' : 'Send to'}
                      </span>
                      <div style={{ minWidth: 260 }}>
                        <SearchableSelect
                          id={`bomplan-vendor-${c.childItemCode}`}
                          value={s.vendorId}
                          onChange={(id) => {
                            const v = vendors.find((x) => x.id === id);
                            update(c.childItemCode, {
                              vendorId: id,
                              vendorLabel: v ? `${v.code} — ${v.name}` : '',
                            });
                          }}
                          onSearch={setVendorSearch}
                          loading={vendorsFetching}
                          options={vendorOptions}
                          placeholder="Search vendor code or name…"
                          emptyText="No matching vendor"
                          {...(s.vendorLabel ? { valueLabel: s.vendorLabel } : {})}
                        />
                      </div>
                      {needProcess ? (
                        <input
                          className="innovic-input"
                          style={{ width: 220, fontSize: 12 }}
                          placeholder="Process (e.g. OUTSOURCE)"
                          value={s.process}
                          onChange={(e) => update(c.childItemCode, { process: e.target.value })}
                        />
                      ) : null}
                      {!s.vendorId ? (
                        <span style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 700 }}>
                          vendor required
                        </span>
                      ) : null}
                    </div>
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
        {/* The two modes have different footnotes in legacy — equipment L8901,
            assembly L7185. They are not interchangeable. */}
        {mode === 'equipment'
          ? 'ℹ Total Need = Equipment Qty × Qty per Set. Shortfall = Total Need − Current Stock.'
          : 'ℹ Shortfall = Total Need − Current Stock. You can adjust Qty to Plan up to Total Need if you want to plan more than shortfall.'}
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
