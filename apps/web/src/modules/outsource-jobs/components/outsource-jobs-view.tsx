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
// opens the full PO form at /purchase-orders/from-pr?prIds=… — exactly what
// the Purchase Requests tab's own "Create PO from Selected" does, with the
// same one-vendor-per-PO tick rule and the same po_create entry gate
// (2026-09-28). The old popup posted to /purchase-orders/from-pr-batch with
// 0% tax, no due date and no remarks, and closed without ever telling the
// buyer the PO number; the full form carries every header field and lands
// on the new PO's detail page after save.
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
// several PO lines), so a PART-ordered request is selectable again.
// Same cards, same search, same JC-source filter.
//
// Legacy's "SO" and "Plan" columns are not portable: PurchaseRequestListItem
// exposes sourceJcCode/sourceJcOpSeq (used here), a bare sourceSoLineId uuid
// with no code join, and no plan field at all. See report / ISSUE-067.

import {
  type ListPurchaseRequestsQuery,
  type PurchaseRequestListItem,
  opSrNo,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { usePurchaseRequestsList } from '@/modules/purchase-requests/api';
import {
  prBalanceClosedText,
  prBalanceColor,
  prBalanceText,
  prHasBalanceToOrder,
  prOrderBalance,
} from '@/modules/purchase-requests/lib/pr-balance';
import { PR_STATUS_LABELS } from '@/modules/purchase-requests/lib/pr-labels';
import { prVendorKey } from '@/modules/purchase-requests/lib/pr-vendor-key';
import { ListFooter, ListHeader } from '@/ui/layout';

const PAGE_SIZE = 100;

function statusColor(s: string): string {
  if (s === 'po_created') return 'var(--green)';
  if (s === 'approved') return 'var(--blue)';
  if (s === 'open') return 'var(--blue)';
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
  // Ticking a row raises a PURCHASE ORDER, so it follows po_create entry — the
  // same key the Purchase Requests tab gates its tick boxes on, and the key
  // /purchase-orders/from-pr itself guards on. (It used to be admin/manager
  // role, which could show the button to someone the PO form then refuses.)
  const { data: eff } = useMyAccess();
  const canEdit = effectiveFormPerms(eff, 'po_create').entry;

  const query: ListPurchaseRequestsQuery = useMemo(
    () => ({
      prType: 'jw_osp',
      limit: PAGE_SIZE,
      offset: 0,
    }),
    [],
  );

  const { data, isLoading, isError, error } = usePurchaseRequestsList(query);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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
            // Searched by the number on screen (display rule, see opSrNo).
            pr.sourceJcOpSeq ? opSrNo(pr.sourceJcOpSeq) : null,
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
            PR_STATUS_LABELS[pr.status],
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

  // A checkbox now means "this request still has quantity to buy", not "its
  // status is open/approved". `canEdit` (po_create entry) gates it on top.
  const selectablePrs = filtered.filter(ospCanOrder);

  // One vendor per PO — the Purchase Requests tab's rule, same key
  // (prVendorKey) and same wording. Once a request with a vendor is ticked, a
  // request of a different vendor cannot be; a request whose vendor is still
  // TBD fits any vendor, and the PO form treats it the same way.
  const lockedVendor = useMemo(() => {
    const hit = allPrs.find((pr) => selectedIds.has(pr.id) && prVendorKey(pr) !== null);
    const key = hit ? prVendorKey(hit) : null;
    return hit && key !== null ? { key, label: hit.vendorName ?? hit.vendorCodeText ?? '—' } : null;
  }, [allPrs, selectedIds]);
  function vendorClash(pr: PurchaseRequestListItem): string | null {
    const key = prVendorKey(pr);
    return lockedVendor && key !== null && key !== lockedVendor.key && !selectedIds.has(pr.id)
      ? lockedVendor.label
      : null;
  }

  // The header box ticks every row that fits ONE vendor: the one already
  // ticked, else the first vendor on the list. A mixed page never produces a
  // selection the PO form would have to refuse.
  const headerLockKey =
    lockedVendor?.key ??
    selectablePrs.map(prVendorKey).find((k): k is string => k !== null) ??
    null;
  const headerTickable = selectablePrs.filter((pr) => {
    const key = prVendorKey(pr);
    return key === null || headerLockKey === null || key === headerLockKey;
  });
  const allSelectedOnPage =
    headerTickable.length > 0 && headerTickable.every((pr) => selectedIds.has(pr.id));

  function toggleAll(checked: boolean): void {
    if (checked) {
      setSelectedIds(new Set(headerTickable.map((pr) => pr.id)));
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

  return (
    <div>
      {/* THE list header (ui/layout ListHeader): title · count · Create PO
          from Selected, then the filter bar (search · status with counts ·
          JC No. · Clear). */}
      <ListHeader
        title="Outsource Jobs"
        icon="📦"
        count={filtered.length}
        noun="OSP request"
        filterNote={
          [
            statusBand === 'open' ? 'Open' : statusBand === 'po_created' ? 'PO Created' : null,
            soNo ?? null,
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        search={searchText}
        onSearch={setSearchText}
        searchPlaceholder="Search PR No., JC, item, process, vendor, qty, due, status…"
        filters={
          <>
            {/* Status band, with the counts the old strip showed in the option
                labels (owner decision 2026-09-26). No qty total: it would add
                different items' quantities together. */}
            <select
              className="innovic-select"
              aria-label="OSP status"
              title="OSP status"
              value={statusBand ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                setStatusBand(v === 'open' || v === 'po_created' ? v : undefined);
              }}
            >
              <option value="">All ({totalPR})</option>
              <option value="open">Open ({openPR})</option>
              <option value="po_created">PO Created ({poCreated})</option>
            </select>
            <select
              className="innovic-select"
              aria-label="JC No."
              title="JC No."
              value={soNo ?? ''}
              onChange={(e) => setSoNo(e.target.value || undefined)}
            >
              <option value="">All JC Nos.</option>
              {soNos.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </>
        }
        onClearFilters={() => {
          setSearchText('');
          setSoNo(undefined);
          setStatusBand(undefined);
        }}
        filtersActive={statusBand !== undefined || soNo !== undefined || searchText !== ''}
        primary={
          canEdit && selectedIds.size > 0 ? (
            <Link
              to="/purchase-orders/from-pr"
              search={{ prIds: Array.from(selectedIds).join(',') }}
              className="btn btn-primary"
            >
              🛒 Create PO from Selected ({selectedIds.size})
            </Link>
          ) : null
        }
      />

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table tbl-grid">
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
                <th>JC No.</th>
                <th>Item Code</th>
                <th style={{ color: 'var(--purple)' }}>Process</th>
                <th className="th-num">Qty</th>
                <th>Suggested Vendor</th>
                <th className="th-num" style={{ color: 'var(--green2)' }}>
                  Est. Rate (₹)
                </th>
                <th>Due Date</th>
                <th>PR Status</th>
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
                  <td colSpan={10} className="empty-state" style={{ color: 'var(--red2)' }}>
                    {error instanceof Error
                      ? error.message
                      : 'Could not load outsource jobs. Try again.'}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="empty-state">
                    {searchText || soNo || statusBand
                      ? 'No Outsource Jobs match.'
                      : 'No Outsource Jobs yet.'}
                  </td>
                </tr>
              ) : (
                filtered.map((pr) => {
                  const clashWith = vendorClash(pr);
                  return (
                    <OspRow
                      key={pr.id}
                      pr={pr}
                      canSelect={canEdit && ospCanOrder(pr)}
                      selected={selectedIds.has(pr.id)}
                      disabledReason={
                        clashWith !== null
                          ? `Only one vendor per PO — ${clashWith} is already selected`
                          : undefined
                      }
                      onToggle={(c) => togglePr(pr.id, c)}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <ListFooter
        total={data?.total ?? allPrs.length}
        shown={filtered.length}
        limit={PAGE_SIZE}
        noun="OSP request"
        hint="Tick PRs → Create PO from Selected."
      />
    </div>
  );
}

function OspRow({
  pr,
  canSelect,
  selected,
  disabledReason,
  onToggle,
}: {
  pr: PurchaseRequestListItem;
  canSelect: boolean;
  selected: boolean;
  /** Set when the box cannot be ticked (another vendor is already selected). */
  disabledReason?: string | undefined;
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
            disabled={disabledReason !== undefined}
            title={disabledReason ?? 'Tick to add this PR to one PO'}
            onChange={(e) => onToggle(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: 'var(--purple)' }}
          />
        ) : null}
      </td>
      <td className="mono fw-700" style={{ color: 'var(--purple)', whiteSpace: 'nowrap' }}>
        {pr.code}
      </td>
      <td className="mono" style={{ color: 'var(--cyan)', fontSize: 11, whiteSpace: 'nowrap' }}>
        {pr.sourceJcCode
          ? `${pr.sourceJcCode}${pr.sourceJcOpSeq ? ` · Op ${opSrNo(pr.sourceJcOpSeq)}` : ''}`
          : '—'}
      </td>
      <td style={{ fontSize: 11 }}>
        {/* CODE/REV — the drawing revision off the SO line behind this
            request; the bare code when the request has no SO behind it. */}
        <span className="mono fw-700" style={{ color: 'var(--text)' }}>
          {itemCodeWithRev(pr.itemCode ?? pr.itemCodeText, pr.itemRevision)}
        </span>{' '}
        <span className="text3">{pr.itemName ?? ''}</span>
      </td>
      <td style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 600 }}>
        {pr.operation ?? '—'}
      </td>
      <td className="mono fw-700 td-num">{pr.qty}</td>
      <td style={{ fontSize: 11 }}>
        {pr.vendorName ?? <span className="text3">—</span>}
        {pr.vendorCodeText && pr.vendorCodeText !== pr.vendorName ? (
          <span style={{ color: 'var(--text3)', fontSize: 11 }}> [{pr.vendorCodeText}]</span>
        ) : null}
      </td>
      <td className="mono td-num" style={{ color: 'var(--green2)', whiteSpace: 'nowrap' }}>
        {Number(pr.estCost) > 0 ? `₹${Number(pr.estCost).toFixed(2)}` : '—'}
      </td>
      <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{fmtDate(pr.requiredDate)}</td>
      <td>
        <span style={{ fontWeight: 700, color: statusColor(pr.status) }}>
          {PR_STATUS_LABELS[pr.status]}
        </span>
        {pr.poCode ? (
          <span className="mono" style={{ fontSize: 11, marginLeft: 4, color: 'var(--cyan)' }}>
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
            style={{ fontSize: 11, color: prBalanceColor(bal.state) }}
            title={
              bal.closed
                ? `${prBalanceClosedText(bal)}${bal.closedReason ? ` — ${bal.closedReason}` : ''}`
                : `${bal.ordered} of ${bal.qty} ordered`
            }
          >
            {bal.closed ? '🚫 Short Closed' : `${bal.balance} of ${bal.qty} pending`}
          </div>
        ) : null}
      </td>
    </tr>
  );
}
