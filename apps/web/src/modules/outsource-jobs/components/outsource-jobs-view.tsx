// Outsource Jobs (OSP) view — mirror of legacy renderOutsourceJobs (L27044).
//
// Lifted verbatim from outsource-jobs/routes/list.tsx so the same screen can be
// embedded as a tab inside Purchase Requests without retiring the standalone
// route. The ONLY change from the route version: the two URL-driven filters
// (soNo, statusBand) are now LOCAL component state instead of useSearch/
// useNavigate. Every hook and the batch-PO write path are IDENTICAL.
//
// Pulls every PR with pr_type='jw_osp', shows status cards + search +
// JC-source filter + a checkbox-selectable table. "Create PO from Selected"
// opens a modal to choose vendor + per-line rate; POST batches them into a
// single JW PO via /purchase-orders/from-pr-batch (service.ts L1148 — traced
// against legacy `_ospCreatePO` L27166-27207: PO insert, per-PR line insert
// with rate override, PR stamp to po_created + poId + vendor, activity log.
// Ours is a superset — it adds a code-uniqueness check and blocks already-
// converted/cancelled PRs. Legacy's handler does NOT touch jc_ops here.
//
// 2026-09-08 (ADR-152 phase 2): the two clickable bands — Open PR / PO Created
// — used to test `status === 'po_created'`. That status now only means buying
// STARTED, so an OSP request for 100 with a purchase order for 10 was counted
// as finished and 90 quietly disappeared from the buyer's "still to do" pile.
// Both bands now read the BALANCE through purchase-requests/lib/pr-balance, the
// same helper the PR card, the PR detail page and the PO picker use, so the
// four screens agree.
//
// 2026-09-08 (ADR-152 phase 4): the CHECKBOX follows the balance too. It used
// to test `status open|approved`, which was correct only while the API refused
// a second purchase order against a job-work request — so a request for 100
// with a PO for 10 lost its checkbox and the other 90 could never be bought.
// That guard is gone (jc_op_po_lines lets one outsourced operation sit on
// several PO lines), so a PART-ordered request is selectable again and the
// batch modal quotes what is LEFT, which is the quantity the server writes.
// Same cards, same search, same JC-source filter, same batch-PO write path.
//
// Legacy's "SO" and "Plan" columns are not portable: PurchaseRequestListItem
// exposes sourceJcCode/sourceJcOpSeq (used here), a bare sourceSoLineId uuid
// with no code join, and no plan field at all. See report / ISSUE-067.

import type { ListPurchaseRequestsQuery, PurchaseRequestListItem } from '@innovic/shared';
import { Loader2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { todayLocal } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { useSession } from '@/lib/session';
import { useCreatePurchaseOrderFromPrBatch } from '@/modules/purchase-orders/api';
import { usePurchaseRequestsList } from '@/modules/purchase-requests/api';
import {
  prBalanceClosedText,
  prBalanceColor,
  prBalanceText,
  prHasBalanceToOrder,
  prOrderBalance,
} from '@/modules/purchase-requests/lib/pr-balance';
import { useVendorsList } from '@/modules/vendors/api';

const PAGE_SIZE = 100;

function inr(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}

function statusColor(s: string): string {
  if (s === 'po_created') return 'var(--green)';
  if (s === 'approved') return 'var(--blue)';
  if (s === 'open') return 'var(--amber)';
  return 'var(--text3)';
}

/** May this request go on a NEW purchase order? The QUANTITY question, asked
 *  through the one balance helper — the same test the API makes in
 *  `assertPrCanTakeAnotherPo`, so the checkbox and the server agree. Out:
 *  cancelled, short-closed, fully ordered, over-ordered. IN: anything with
 *  quantity still owed, INCLUDING a part-ordered request. */
function ospCanOrder(pr: PurchaseRequestListItem): boolean {
  if (pr.status === 'cancelled') return false;
  return prHasBalanceToOrder(prOrderBalance(pr));
}

/** How much a new purchase order takes from this request: what is LEFT, never
 *  the original qty. The batch endpoint has no qty field — it recomputes the
 *  remaining balance itself for the line it writes — so quoting `qty` in the
 *  modal would show the buyer a PO the server refuses ("PR X has N left to
 *  order; this line asks for M"). Floored at 0 so an over-ordered row prints a
 *  number instead of a minus. */
function ospOrderQty(pr: PurchaseRequestListItem): number {
  return Math.max(0, prOrderBalance(pr).balance);
}

/** Which band a request belongs in — the QUANTITY question, not the status one.
 *  "Open PR" = there is still something to buy, which is now exactly the set of
 *  rows that carry a checkbox. "PO Created" = the buying is finished, either
 *  because every piece is on a purchase order or because the buyer short-closed
 *  the remainder. A cancelled request is in neither, exactly as before (the old
 *  test only ever matched open / approved / po_created). */
function ospBand(pr: PurchaseRequestListItem): 'open' | 'po_created' | null {
  if (pr.status === 'cancelled') return null;
  return ospCanOrder(pr) ? 'open' : 'po_created';
}

export function OutsourceJobsView(): React.JSX.Element {
  // Legacy URL filters, now local (this view is embedded as a PR tab).
  const [soNo, setSoNo] = useState<string | undefined>(undefined);
  const [statusBand, setStatusBand] = useState<'open' | 'po_created' | undefined>(undefined);
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
  const [poDate, setPoDate] = useState<string>(() => todayLocal());
  const [poCode, setPoCode] = useState('');
  const [rateOverrides, setRateOverrides] = useState<Record<string, number>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Legacy `searchBox('ospSearch','ospTable',…)` (L27104) filters the rendered
  // rows client-side on their text content (searchFilter L1513). Mirrored here
  // over the fields this table actually renders.
  const [searchText, setSearchText] = useState('');

  const allPrs = data?.items ?? [];

  // Client-side filter for status + SO (legacy filters by these in-page).
  const filtered = useMemo(() => {
    return allPrs.filter((pr) => {
      if (soNo && pr.sourceJcCode !== soNo) return false;
      if (statusBand && ospBand(pr) !== statusBand) return false;
      // Every column this table shows, through the ONE shared matcher
      // (components/shared/search-match) instead of another hand-rolled
      // join-and-includes. Qty, Est. Rate and Due were columns you could read
      // but not search; they are covered now. Client-side is correct HERE and
      // only here: this tab loads its whole list in one fetch, so nothing the
      // box hides was left on the server.
      if (
        !matchesSearchTerm(
          [
            pr.code,
            pr.sourceJcCode,
            pr.sourceJcOpSeq,
            pr.itemCode,
            pr.itemCodeText,
            // The drawing revision is on screen beside the code, so it is
            // searchable too — a planner hunting "Rev B" work can type it.
            pr.itemRevision,
            pr.itemName,
            pr.operation,
            pr.vendorName,
            pr.vendorCodeText,
            pr.qty,
            pr.estCost,
            pr.requiredDate,
            pr.poCode,
            pr.status.replaceAll('_', ' '),
            // The Status cell's second line — "90 of 100 left" / "balance
            // closed" — is text the user can read, so it is text the box can
            // find. Only when the row actually shows it, which is the same
            // `ordered > 0` test OspRow makes.
            prOrderBalance(pr).ordered > 0 ? prBalanceText(pr) : null,
          ],
          searchText,
        )
      ) {
        return false;
      }
      return true;
    });
  }, [allPrs, soNo, statusBand, searchText]);

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
  const openPR = allPrs.filter((pr) => ospBand(pr) === 'open').length;
  const poCreated = allPrs.filter((pr) => ospBand(pr) === 'po_created').length;
  const totalQty = allPrs.reduce((s, pr) => s + pr.qty, 0);

  // A checkbox now means "this request still has quantity to buy", not "its
  // status is open/approved". `canEdit` gates it on top, exactly as before.
  const selectablePrs = filtered.filter(ospCanOrder);
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

  // Both totals are the quantity that will actually be ORDERED (each request's
  // remaining balance), not the quantity that was once requested.
  const selectedList = filtered.filter((pr) => selectedIds.has(pr.id));
  const totalSelectedQty = selectedList.reduce((s, pr) => s + ospOrderQty(pr), 0);
  const totalSelectedValue = selectedList.reduce(
    (s, pr) => s + ospOrderQty(pr) * (rateOverrides[pr.id] ?? (Number(pr.estCost) || 0)),
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
        <div className="section-hdr" style={{ marginBottom: 0 }}>
          📦 Outsource Jobs (OSP)
        </div>
        {canEdit && selectedIds.size > 0 ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={openModal}
            disabled={createBatchMut.isPending}
          >
            🛒 Create PO from Selected
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
            border: `2px solid ${statusBand === 'open' ? 'var(--amber)' : 'transparent'}`,
          }}
          onClick={() => setStatusBand((prev) => (prev === 'open' ? undefined : 'open'))}
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
            border: `2px solid ${statusBand === 'po_created' ? 'var(--green)' : 'transparent'}`,
          }}
          onClick={() => setStatusBand((prev) => (prev === 'po_created' ? undefined : 'po_created'))}
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

      {/* Search + JC-source filter (legacy L27103-27106) */}
      <div
        style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <input
          className="innovic-input"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="🔍 Search PR no, JC, item, process, vendor, qty, due, status…"
          style={{ width: 220, fontSize: 12 }}
        />
        <select
          className="innovic-select"
          value={soNo ?? ''}
          onChange={(e) => setSoNo(e.target.value || undefined)}
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
                <th>Qty</th>
                <th>Suggested Vendor</th>
                <th style={{ color: 'var(--green)' }}>Est. Rate</th>
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
                    canSelect={canEdit && ospCanOrder(pr)}
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
        💡 Select the PRs that still have quantity left → Click <b>🛒 Create PO</b>. A part-ordered
        PR can be picked again; the new PO covers what is LEFT, not the original qty. You can club
        multiple PRs into 1 PO (same vendor). Vendor and rate can be changed during PO creation.
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
            style={{ width: 'min(1100px, 96vw)', maxHeight: '92vh', overflow: 'auto' }}
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
                Creating PO for <b>{selectedIds.size} line(s)</b> · Qty to order:{' '}
                <b>{totalSelectedQty}</b> · Est. value:{' '}
                <b style={{ color: 'var(--green)' }}>₹{inr(totalSelectedValue)}</b>
              </div>
              <div className="form-grid-3">
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
                  <label className="form-label" style={{ color: 'var(--purple)' }}>
                    Vendor <span className="req">★</span> (can change from suggested)
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
                <div className="form-grp">
                  <label className="form-label">PO Date</label>
                  <input
                    type="date"
                    className="innovic-input"
                    value={poDate}
                    onChange={(e) => setPoDate(e.target.value)}
                  />
                </div>
              </div>

              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple)' }}>
                PO Lines (rate is editable per line)
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <table className="innovic-table">
                  <thead>
                    <tr style={{ background: 'var(--bg4)' }}>
                      <th>PR</th>
                      <th>JC Source</th>
                      <th>Item</th>
                      <th>Process</th>
                      <th>Qty to order</th>
                      <th style={{ color: 'var(--green)' }}>Rate ₹/pc</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedList.map((pr) => {
                      const rate = rateOverrides[pr.id] ?? (Number(pr.estCost) || 0);
                      const orderQty = ospOrderQty(pr);
                      return (
                        <tr key={pr.id}>
                          <td className="mono" style={{ color: 'var(--purple)', fontSize: 11 }}>{pr.code}</td>
                          <td className="mono" style={{ color: 'var(--cyan)', fontSize: 11 }}>
                            {pr.sourceJcCode ?? '—'}
                          </td>
                          <td style={{ fontSize: 11 }}>
                            {/* CODE/REV — the drawing revision off the SO line
                                behind this request; blank-free bare code when
                                the request has no SO behind it. */}
                            {itemCodeWithRev(pr.itemCode ?? pr.itemCodeText, pr.itemRevision)} —{' '}
                            {pr.itemName ?? '—'}
                          </td>
                          <td style={{ fontSize: 11, color: 'var(--purple)' }}>
                            {pr.operation ?? '—'}
                          </td>
                          <td className="mono fw-700">
                            {orderQty}
                            {orderQty !== pr.qty ? (
                              <div
                                className="text3"
                                style={{ fontSize: 10, fontWeight: 400 }}
                                title={`${pr.qty - orderQty} of ${pr.qty} is already on a purchase order`}
                              >
                                of {pr.qty} requested
                              </div>
                            ) : null}
                          </td>
                          <td>
                            <input
                              type="number"
                              className="innovic-input"
                              value={rate}
                              min={0}
                              step={0.01}
                              placeholder="₹0"
                              onChange={(e) =>
                                setRateOverrides((prev) => ({
                                  ...prev,
                                  [pr.id]: Number(e.target.value) || 0,
                                }))
                              }
                              style={{
                                width: 80,
                                fontSize: 12,
                                fontWeight: 700,
                                color: 'var(--green)',
                              }}
                            />
                          </td>
                          <td className="mono fw-700" style={{ color: 'var(--green)' }}>
                            ₹{inr(rate * orderQty)}
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
  const bal = prOrderBalance(pr);
  return (
    <tr>
      <td>
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
        {/* CODE/REV — same rule as the review table above. */}
        {itemCodeWithRev(pr.itemCode ?? pr.itemCodeText, pr.itemRevision)}{' '}
        <span className="text3">{pr.itemName ?? ''}</span>
      </td>
      <td style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 600 }}>
        {pr.operation ?? '—'}
      </td>
      <td className="mono fw-700">{pr.qty}</td>
      <td style={{ fontSize: 11 }}>
        {pr.vendorName ?? <span style={{ color: 'var(--amber)' }}>TBD</span>}
        {pr.vendorCodeText && pr.vendorCodeText !== pr.vendorName ? (
          <span style={{ color: 'var(--text3)', fontSize: 10 }}> [{pr.vendorCodeText}]</span>
        ) : null}
      </td>
      <td className="mono" style={{ color: 'var(--green)' }}>
        {Number(pr.estCost) > 0 ? `₹${Number(pr.estCost).toFixed(2)}` : '—'}
      </td>
      <td style={{ fontSize: 11 }}>{pr.requiredDate ?? '—'}</td>
      <td>
        <span style={{ fontWeight: 700, color: statusColor(pr.status) }}>
          {pr.status.replaceAll('_', ' ')}
        </span>
        {pr.poCode ? (
          <span className="mono" style={{ fontSize: 10, marginLeft: 4, color: 'var(--cyan)' }}>
            {pr.poCode}
          </span>
        ) : null}
        {/* Why a `po created` row can still sit in the Open PR band and still
            offer a checkbox: the status says buying STARTED, this says how much
            of it is left to buy — and that remainder is what the next PO will
            take. Shown only when something is ordered and something is still
            owed (or the balance was closed), so a plain open or fully-ordered
            row is as clean as it was. */}
        {bal.ordered > 0 && (bal.balance > 0 || bal.closed) ? (
          <div
            className="mono"
            style={{ fontSize: 10, color: prBalanceColor(bal.state) }}
            title={
              bal.closed
                ? `${prBalanceClosedText(bal)}${bal.closedReason ? ` — ${bal.closedReason}` : ''}`
                : `${bal.ordered} of ${bal.qty} ordered`
            }
          >
            {bal.closed ? '🚫 balance closed' : `${bal.balance} of ${bal.qty} left`}
          </div>
        ) : null}
      </td>
    </tr>
  );
}
