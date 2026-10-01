// Outsource Jobs (OSP) view — mirror of legacy renderOutsourceJobs (L27044),
// embedded as a tab inside Purchase Requests. ADR-199 conversion: the hand-built
// table is now the shared FIT table (DataTable + tableKey); its columns, ▸
// expand, status tint and per-row action live in ./outsource-jobs-columns, and
// the two balance questions in ../lib/osp-band.
//
// Pulls every PR with pr_type='jw_osp', shows status counts in the filter bar +
// universal search + JC-source filter + a tick-box-selectable table. "Create PO
// from Selected" opens the full PO form at /purchase-orders/from-pr?prIds=… —
// exactly what the Purchase Requests tab does, with the same one-vendor-per-PO
// rule (prVendorKey) and the same po_create entry gate.
//
// 2026-09-08 (ADR-152): the bands, the tick box and the Pending column all read
// the BALANCE (purchase-requests/lib/pr-balance), not `status === 'po_created'`
// — an OSP request for 100 bought 10 keeps 90 to do, stays in Open PR and keeps
// its tick box. One outsourced op may sit on several PO lines.
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
import { useMemo, useState } from 'react';

import { matchesSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { prBalanceText, prOrderBalance } from '@/modules/purchase-requests/lib/pr-balance';
import { PR_STATUS_LABELS } from '@/modules/purchase-requests/lib/pr-labels';
import { prVendorKey } from '@/modules/purchase-requests/lib/pr-vendor-key';
import { usePurchaseRequestsList } from '@/modules/purchase-requests/api';
import { DataTable, Panel } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';

import {
  OutsourceJobExpand,
  OutsourceJobRowActions,
  ospRowTint,
  outsourceJobsColumns,
} from './outsource-jobs-columns';
import { ospBand, ospCanOrder } from '../lib/osp-band';

const PAGE_SIZE = 100;

export function OutsourceJobsView(): React.JSX.Element {
  // Legacy URL filters, now local (this view is embedded as a PR tab).
  const [soNo, setSoNo] = useState<string | undefined>(undefined);
  const [statusBand, setStatusBand] = useState<'open' | 'po_created' | undefined>(undefined);
  const [searchText, setSearchText] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Ticking a row raises a PURCHASE ORDER, so it follows po_create entry — the
  // same key the Purchase Requests tab gates its tick boxes on, and the key
  // /purchase-orders/from-pr itself guards on.
  const { data: eff } = useMyAccess();
  const canEdit = effectiveFormPerms(eff, 'po_create').entry;

  const query: ListPurchaseRequestsQuery = useMemo(
    () => ({ prType: 'jw_osp', limit: PAGE_SIZE, offset: 0 }),
    [],
  );
  const { data, isLoading, isError, error } = usePurchaseRequestsList(query);
  const allPrs = data?.items ?? [];

  // Client-side filter — status band + JC + universal search. Correct HERE and
  // only here: this tab loads its whole list in one fetch, so nothing the box
  // hides was left on the server.
  const filtered = useMemo(() => {
    return allPrs.filter((pr) => {
      if (soNo && pr.sourceJcCode !== soNo) return false;
      if (statusBand && ospBand(pr) !== statusBand) return false;
      const bal = prOrderBalance(pr);
      // Every column this table shows, through the ONE shared matcher.
      return matchesSearchTerm(
        [
          pr.code,
          pr.sourceJcCode,
          pr.sourceJcOpSeq ? opSrNo(pr.sourceJcOpSeq) : null,
          pr.itemCode,
          pr.itemCodeText,
          pr.itemRevision,
          pr.itemName,
          pr.operation,
          pr.qty,
          bal.balance,
          pr.vendorName,
          pr.vendorCodeText,
          pr.estCost,
          pr.requiredDate,
          pr.poCode,
          PR_STATUS_LABELS[pr.status],
          bal.ordered > 0 ? prBalanceText(pr) : null,
        ],
        searchText,
      );
    });
  }, [allPrs, soNo, statusBand, searchText]);

  // Distinct source JC codes for the JC filter.
  const soNos = useMemo(() => {
    const set = new Set<string>();
    allPrs.forEach((pr) => {
      if (pr.sourceJcCode) set.add(pr.sourceJcCode);
    });
    return Array.from(set).sort();
  }, [allPrs]);

  // Counts for the status dropdown labels (owner decision 2026-09-26).
  const totalPR = allPrs.length;
  const openPR = allPrs.filter((pr) => ospBand(pr) === 'open').length;
  const poCreated = allPrs.filter((pr) => ospBand(pr) === 'po_created').length;

  // One vendor per PO — the Purchase Requests tab's rule, same key (prVendorKey).
  // Once a request with a vendor is ticked, a request of a different vendor
  // cannot be; a request whose vendor is still TBD fits any vendor.
  const lockedVendor = useMemo(() => {
    const hit = allPrs.find((pr) => selectedIds.has(pr.id) && prVendorKey(pr) !== null);
    const key = hit ? prVendorKey(hit) : null;
    return hit && key !== null ? { key, label: hit.vendorName ?? hit.vendorCodeText ?? '—' } : null;
  }, [allPrs, selectedIds]);

  // The engine's per-row tick gate: orderable, the user may buy, AND the row
  // fits the one locked vendor (an already-ticked row always fits itself).
  const isRowSelectable = (pr: PurchaseRequestListItem): boolean => {
    if (!canEdit || !ospCanOrder(pr)) return false;
    if (!lockedVendor || selectedIds.has(pr.id)) return true;
    const key = prVendorKey(pr);
    return key === null || key === lockedVendor.key;
  };

  const onToggleRow = (
    key: string | number,
    _row: PurchaseRequestListItem,
    next: boolean,
  ): void => {
    setSelectedIds((prev) => {
      const nextSet = new Set(prev);
      if (next) nextSet.add(String(key));
      else nextSet.delete(String(key));
      return nextSet;
    });
  };

  // Select-all honours the one-vendor rule: when nothing is locked yet, it ties
  // the page to the first vendor it finds and ticks only that vendor's rows
  // (plus the vendor-TBD rows, which fit any PO).
  const onToggleAll = (next: boolean, keys: (string | number)[]): void => {
    if (!next) {
      setSelectedIds(new Set());
      return;
    }
    const keySet = new Set(keys.map(String));
    const rowsForKeys = filtered.filter((pr) => keySet.has(pr.id));
    const lockKey =
      lockedVendor?.key ??
      rowsForKeys.map(prVendorKey).find((k): k is string => k !== null) ??
      null;
    const picked = rowsForKeys.filter((pr) => {
      const k = prVendorKey(pr);
      return k === null || lockKey === null || k === lockKey;
    });
    setSelectedIds(new Set(picked.map((pr) => pr.id)));
  };

  const columns = useMemo(() => outsourceJobsColumns(), []);

  return (
    <div>
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
        searchPlaceholder="Search PR No., JC, item, process, vendor, qty, pending, due, status…"
        filters={
          <>
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
      />

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load outsource jobs. Try again.'
          }
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.outsourceJobs}
            columns={columns}
            rows={filtered}
            rowKey={(pr) => pr.id}
            loading={isLoading}
            emptyText={
              searchText || soNo || statusBand
                ? 'No Outsource Jobs match.'
                : 'No Outsource Jobs yet.'
            }
            rowClassName={ospRowTint}
            renderExpanded={(pr) => <OutsourceJobExpand pr={pr} />}
            rowActions={(pr) => <OutsourceJobRowActions pr={pr} canCreatePo={canEdit} />}
            selectable
            selectedKeys={selectedIds}
            onToggleRow={onToggleRow}
            onToggleAll={onToggleAll}
            isRowSelectable={isRowSelectable}
            selectionActions={() => (
              <>
                {lockedVendor ? (
                  <span className="text3" style={{ fontSize: 12 }}>
                    Vendor <span className="text2 fw-700">{lockedVendor.label}</span>
                  </span>
                ) : null}
                <Link
                  to="/purchase-orders/from-pr"
                  search={{ prIds: Array.from(selectedIds).join(',') }}
                  className="btn btn-primary btn-sm"
                  title="Raises one PO per vendor from the ticked OSP requests."
                >
                  🛒 Create PO from Selected ({selectedIds.size})
                </Link>
              </>
            )}
          />
        </Panel>
      )}

      <ListFooter
        total={data?.total ?? allPrs.length}
        shown={filtered.length}
        limit={PAGE_SIZE}
        noun="OSP request"
        hint="Tick OSP requests → Create PO from Selected."
      />
    </div>
  );
}
