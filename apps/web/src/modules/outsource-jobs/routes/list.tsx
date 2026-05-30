// Outsource Jobs (OSP) — mirror of legacy renderOutsourceJobs (L27044).
//
// Pulls every PR with pr_type='jw_osp', shows status cards + SO filter +
// a checkbox-selectable table. "Create JW PO from Selected" opens a
// modal to choose vendor + per-line rate; POST batches them into a
// single JW PO via /purchase-orders/from-pr-batch.

import type { ListPurchaseRequestsQuery, PurchaseRequestListItem } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2, ShoppingCart, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreatePurchaseOrderFromPrBatch } from '@/modules/purchase-orders/api';
import { usePurchaseRequestsList } from '@/modules/purchase-requests/api';
import { useVendorsList } from '@/modules/vendors/api';

const PAGE_SIZE = 100;

const listSearchSchema = z.object({
  soNo: z.string().optional(),
  statusBand: z.enum(['open', 'po_created']).optional(),
});

export const outsourceJobsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'outsource-jobs',
  validateSearch: listSearchSchema,
  component: OutsourceJobsPage,
});

function inr(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}

function statusColor(s: string): string {
  if (s === 'po_created') return 'var(--green)';
  if (s === 'approved') return 'var(--blue)';
  if (s === 'open') return 'var(--amber)';
  return 'var(--text3)';
}

function OutsourceJobsPage(): React.JSX.Element {
  const search = outsourceJobsRoute.useSearch();
  const navigate = outsourceJobsRoute.useNavigate();
  const { data: me } = useSession();
  const canEdit = me?.role === 'admin' || me?.role === 'manager';

  const query: ListPurchaseRequestsQuery = useMemo(
    () => ({
      prType: 'jw_osp',
      limit: PAGE_SIZE,
      offset: 0,
    }),
    [],
  );

  const { data, isLoading, isError, error } = usePurchaseRequestsList(query);
  const { data: vendorsList } = useVendorsList({ limit: 200, offset: 0 }, { enabled: canEdit });
  const createBatchMut = useCreatePurchaseOrderFromPrBatch();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [poDate, setPoDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [poCode, setPoCode] = useState('');
  const [rateOverrides, setRateOverrides] = useState<Record<string, number>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const allPrs = data?.items ?? [];

  // Client-side filter for status + SO (legacy filters by these in-page).
  const filtered = useMemo(() => {
    return allPrs.filter((pr) => {
      if (search.soNo && pr.sourceJcCode !== search.soNo) return false;
      if (search.statusBand === 'open' && pr.status !== 'open' && pr.status !== 'approved') return false;
      if (search.statusBand === 'po_created' && pr.status !== 'po_created') return false;
      return true;
    });
  }, [allPrs, search.soNo, search.statusBand]);

  // Distinct source JC codes for SO filter.
  const soNos = useMemo(() => {
    const set = new Set<string>();
    allPrs.forEach((pr) => {
      if (pr.sourceJcCode) set.add(pr.sourceJcCode);
    });
    return Array.from(set).sort();
  }, [allPrs]);

  // Cards
  const totalPR = allPrs.length;
  const openPR = allPrs.filter((pr) => pr.status === 'open' || pr.status === 'approved').length;
  const poCreated = allPrs.filter((pr) => pr.status === 'po_created').length;
  const totalQty = allPrs.reduce((s, pr) => s + pr.qty, 0);

  const selectablePrs = filtered.filter(
    (pr) => pr.status === 'open' || pr.status === 'approved',
  );
  const allSelectedOnPage =
    selectablePrs.length > 0 && selectablePrs.every((pr) => selectedIds.has(pr.id));

  function toggleAll(checked: boolean): void {
    if (checked) {
      setSelectedIds(new Set(selectablePrs.map((pr) => pr.id)));
    } else {
      setSelectedIds(new Set());
    }
  }

  function togglePr(id: string, checked: boolean): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function openModal(): void {
    setSubmitError(null);
    const selected = selectablePrs.filter((pr) => selectedIds.has(pr.id));
    // Suggest vendor from first selected PR
    setVendorId(selected[0]?.vendorId ?? '');
    // Seed rate overrides with each PR's estCost
    const overrides: Record<string, number> = {};
    for (const pr of selected) overrides[pr.id] = Number(pr.estCost) || 0;
    setRateOverrides(overrides);
    setModalOpen(true);
  }

  async function submitBatch(): Promise<void> {
    setSubmitError(null);
    if (!vendorId) {
      setSubmitError('Select a vendor');
      return;
    }
    if (!poCode.trim()) {
      setSubmitError('PO code is required');
      return;
    }
    try {
      await createBatchMut.mutateAsync({
        prIds: Array.from(selectedIds),
        vendorId,
        header: {
          code: poCode.trim(),
          poDate,
          poType: 'job_work',
          sgstPct: 0,
          cgstPct: 0,
          igstPct: 0,
        },
        rateOverrides,
      });
      setModalOpen(false);
      setSelectedIds(new Set());
      setPoCode('');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Create PO failed');
    }
  }

  const selectedList = filtered.filter((pr) => selectedIds.has(pr.id));
  const totalSelectedQty = selectedList.reduce((s, pr) => s + pr.qty, 0);
  const totalSelectedValue = selectedList.reduce(
    (s, pr) => s + pr.qty * (rateOverrides[pr.id] ?? (Number(pr.estCost) || 0)),
    0,
  );

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <div>
          <div className="section-hdr" style={{ marginBottom: 0 }}>
            📦 Outsource Jobs (OSP)
          </div>
          <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
            JW_OSP Purchase Requests auto-generated from outsource JC ops. Select multiple PRs to
            club into one JW PO.
          </div>
        </div>
        {canEdit && selectedIds.size > 0 ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={openModal}
            disabled={createBatchMut.isPending}
          >
            <ShoppingCart size={14} /> Create JW PO from {selectedIds.size} selected
          </button>
        ) : null}
      </div>

      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div className="panel" style={{ minWidth: 100, padding: 12, textAlign: 'center' }}>
          <div className="text3" style={{ fontSize: 10 }}>Total OSP</div>
          <div className="mono fw-700" style={{ fontSize: 22 }}>{totalPR}</div>
        </div>
        <div
          className="panel"
          style={{
            minWidth: 100,
            padding: 12,
            textAlign: 'center',
            cursor: 'pointer',
            border: `2px solid ${search.statusBand === 'open' ? 'var(--amber)' : 'transparent'}`,
          }}
          onClick={() =>
            void navigate({
              search: (prev) => ({
                ...prev,
                statusBand: prev.statusBand === 'open' ? undefined : 'open',
              }),
              replace: true,
            })
          }
        >
          <div className="text3" style={{ fontSize: 10 }}>Open PR</div>
          <div className="mono fw-700" style={{ fontSize: 22, color: 'var(--amber)' }}>
            {openPR}
          </div>
        </div>
        <div
          className="panel"
          style={{
            minWidth: 100,
            padding: 12,
            textAlign: 'center',
            cursor: 'pointer',
            border: `2px solid ${search.statusBand === 'po_created' ? 'var(--green)' : 'transparent'}`,
          }}
          onClick={() =>
            void navigate({
              search: (prev) => ({
                ...prev,
                statusBand: prev.statusBand === 'po_created' ? undefined : 'po_created',
              }),
              replace: true,
            })
          }
        >
          <div className="text3" style={{ fontSize: 10 }}>PO Created</div>
          <div className="mono fw-700" style={{ fontSize: 22, color: 'var(--green)' }}>
            {poCreated}
          </div>
        </div>
        <div className="panel" style={{ minWidth: 100, padding: 12, textAlign: 'center' }}>
          <div className="text3" style={{ fontSize: 10 }}>Total Qty</div>
          <div className="mono fw-700" style={{ fontSize: 22 }}>{totalQty}</div>
        </div>
      </div>

      {/* SO filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <select
          className="innovic-select"
          value={search.soNo ?? ''}
          onChange={(e) =>
            void navigate({
              search: (prev) => ({ ...prev, soNo: e.target.value || undefined }),
              replace: true,
            })
          }
          style={{ width: 200, fontSize: 12 }}
        >
          <option value="">All JC sources</option>
          {soNos.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th style={{ width: 30 }}>
                  <input
                    type="checkbox"
                    checked={allSelectedOnPage}
                    onChange={(e) => toggleAll(e.target.checked)}
                    style={{ width: 16, height: 16 }}
                    disabled={!canEdit || selectablePrs.length === 0}
                  />
                </th>
                <th>PR No.</th>
                <th>JC Source</th>
                <th>Item</th>
                <th style={{ color: 'var(--purple)' }}>Process</th>
                <th className="td-ctr">Qty</th>
                <th>Suggested Vendor</th>
                <th className="td-ctr" style={{ color: 'var(--green)' }}>Est. Rate</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="empty-state">
                    <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={10} className="empty-state" style={{ color: 'var(--red)' }}>
                    {error instanceof Error ? error.message : 'Failed to load'}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="empty-state">
                    No OSP requests. Create Full Outsource plans in SO/JW Planning.
                  </td>
                </tr>
              ) : (
                filtered.map((pr) => (
                  <OspRow
                    key={pr.id}
                    pr={pr}
                    canSelect={canEdit && (pr.status === 'open' || pr.status === 'approved')}
                    selected={selectedIds.has(pr.id)}
                    onToggle={(c) => togglePr(pr.id, c)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
        💡 Select open PRs using checkboxes → Click <b>Create JW PO from N selected</b>. You can
        club multiple PRs into one PO (same vendor). Vendor and rate can be changed during PO
        creation.
      </div>

      {/* Batch-create modal */}
      {modalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.45)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: '4vh 16px',
            zIndex: 60,
          }}
        >
          <div
            className="panel"
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(900px, 96vw)', maxHeight: '92vh', overflow: 'auto' }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 16px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div className="fw-700" style={{ color: 'var(--purple)' }}>
                🛒 Create JW PO from {selectedIds.size} OSP PR(s)
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setModalOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div style={{ padding: 16, display: 'grid', gap: 12 }}>
              <div
                style={{
                  padding: '10px 14px',
                  background: 'var(--bg3)',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  fontSize: 12,
                  color: 'var(--text3)',
                }}
              >
                Creating PO for <b>{selectedIds.size} line(s)</b> · Total qty:{' '}
                <b>{totalSelectedQty}</b> · Est. value:{' '}
                <b style={{ color: 'var(--green)' }}>₹{inr(totalSelectedValue)}</b>
              </div>
              <div className="form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="form-grp">
                  <label className="form-label">PO No. <span className="req">★</span></label>
                  <input
                    className="innovic-input"
                    value={poCode}
                    onChange={(e) => setPoCode(e.target.value)}
                    placeholder="IN-JWPO-00001"
                  />
                </div>
                <div className="form-grp">
                  <label className="form-label">PO Date</label>
                  <input
                    type="date"
                    className="innovic-input"
                    value={poDate}
                    onChange={(e) => setPoDate(e.target.value)}
                  />
                </div>
                <div className="form-grp">
                  <label className="form-label" style={{ color: 'var(--purple)' }}>
                    Vendor <span className="req">★</span>
                  </label>
                  <select
                    className="innovic-select"
                    value={vendorId}
                    onChange={(e) => setVendorId(e.target.value)}
                  >
                    <option value="">— Select vendor —</option>
                    {(vendorsList?.vendors ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.code} — {v.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple)' }}>
                PO Lines (rate editable per line)
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <table className="innovic-table">
                  <thead>
                    <tr style={{ background: 'var(--bg4)' }}>
                      <th>PR</th>
                      <th>JC Source</th>
                      <th>Item</th>
                      <th>Process</th>
                      <th className="td-ctr">Qty</th>
                      <th className="td-ctr" style={{ color: 'var(--green)' }}>Rate ₹/pc</th>
                      <th className="td-ctr">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedList.map((pr) => {
                      const rate = rateOverrides[pr.id] ?? (Number(pr.estCost) || 0);
                      return (
                        <tr key={pr.id}>
                          <td className="mono" style={{ color: 'var(--purple)', fontSize: 11 }}>{pr.code}</td>
                          <td className="mono" style={{ color: 'var(--cyan)', fontSize: 11 }}>
                            {pr.sourceJcCode ?? '—'}
                          </td>
                          <td style={{ fontSize: 11 }}>
                            {pr.itemCode ?? pr.itemCodeText ?? '—'} — {pr.itemName ?? '—'}
                          </td>
                          <td style={{ fontSize: 11, color: 'var(--purple)' }}>
                            {pr.operation ?? '—'}
                          </td>
                          <td className="td-ctr mono fw-700">{pr.qty}</td>
                          <td className="td-ctr">
                            <input
                              type="number"
                              className="innovic-input"
                              value={rate}
                              min={0}
                              step={0.01}
                              onChange={(e) =>
                                setRateOverrides((prev) => ({
                                  ...prev,
                                  [pr.id]: Number(e.target.value) || 0,
                                }))
                              }
                              style={{ width: 100, fontSize: 12, fontWeight: 700, color: 'var(--green)', textAlign: 'right' }}
                            />
                          </td>
                          <td className="td-ctr mono fw-700" style={{ color: 'var(--green)' }}>
                            ₹{inr(rate * pr.qty)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {submitError ? (
                <div
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(239,68,68,0.06)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: 6,
                    color: 'var(--red)',
                    fontSize: 12,
                  }}
                >
                  {submitError}
                </div>
              ) : null}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={createBatchMut.isPending}
                  onClick={() => void submitBatch()}
                >
                  {createBatchMut.isPending ? (
                    <>
                      <Loader2 className="inline h-3 w-3 animate-spin" /> Creating…
                    </>
                  ) : (
                    'Create JW PO'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OspRow({
  pr,
  canSelect,
  selected,
  onToggle,
}: {
  pr: PurchaseRequestListItem;
  canSelect: boolean;
  selected: boolean;
  onToggle: (checked: boolean) => void;
}): React.JSX.Element {
  return (
    <tr style={{ background: selected ? 'rgba(124,58,237,0.06)' : undefined }}>
      <td className="td-ctr">
        {canSelect ? (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onToggle(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: 'var(--purple)' }}
          />
        ) : null}
      </td>
      <td className="mono fw-700" style={{ color: 'var(--purple)' }}>{pr.code}</td>
      <td className="mono" style={{ color: 'var(--cyan)', fontSize: 11 }}>
        {pr.sourceJcCode ? `${pr.sourceJcCode}${pr.sourceJcOpSeq ? ' op' + pr.sourceJcOpSeq : ''}` : '—'}
      </td>
      <td style={{ fontSize: 11 }}>
        {pr.itemCode ?? pr.itemCodeText ?? '—'}{' '}
        <span className="text3">{pr.itemName ?? ''}</span>
      </td>
      <td style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 600 }}>
        {pr.operation ?? '—'}
      </td>
      <td className="td-ctr mono fw-700">{pr.qty}</td>
      <td style={{ fontSize: 11 }}>
        {pr.vendorName ?? <span style={{ color: 'var(--amber)' }}>TBD</span>}
      </td>
      <td className="td-ctr mono" style={{ color: 'var(--green)' }}>
        {Number(pr.estCost) > 0 ? `₹${Number(pr.estCost).toFixed(2)}` : '—'}
      </td>
      <td style={{ fontSize: 11 }}>{pr.requiredDate ?? '—'}</td>
      <td>
        <span style={{ fontWeight: 700, color: statusColor(pr.status) }}>{pr.status}</span>
        {pr.poCode ? (
          <span className="mono" style={{ fontSize: 10, marginLeft: 4, color: 'var(--cyan)' }}>
            {pr.poCode}
          </span>
        ) : null}
      </td>
    </tr>
  );
}
