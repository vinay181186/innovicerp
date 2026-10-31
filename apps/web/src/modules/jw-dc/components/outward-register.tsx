// Outward Register — JW DC material sent out to a vendor, on the shared FIT
// DataTable (ADR-199, table standard 2026-10-01). Split out of routes/list.tsx.
//
// ONE ROW PER DC LINE (ADR-261, GET /jw-dc/outward/lines). Row click opens the
// line's outward DC (/jw-dc/$id) and the ⋯ acts on that DC, as before; the ▸
// reveals the DC's Vehicle / Remarks (and a Cancelled DC's reason) off the row. The whole row is
// washed by its return status (ROW_TINT). RowActions carries View as a real link
// so ctrl-click still opens a new tab.

import { type JwDcOutwardLineRow } from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { fmtDateTime } from '@/lib/date';
import { CancelDocDialog } from '@/modules/cancel-requests/components/cancel-doc-dialog';
import { useJwDcOutwardLines } from '../api';
import { isJwDcCancelled, outwardColumns } from './outward-columns';
import { useJwDcPrint } from './use-jwdc-print';
import { NewOutwardModal } from './new-outward-modal';

const TABLE_KEY = TABLE_KEYS.jwDcOutward;

export function OutwardView({
  forJwId,
  initialSearch,
}: {
  forJwId?: string | undefined;
  /** Seeded ONCE from the route's ?search (deep link); keystrokes stay local. */
  initialSearch?: string | undefined;
}): React.JSX.Element {
  const navigate = useNavigate();
  const jwDcPrint = useJwDcPrint();
  // Same right the server checks (ADR-193): OSP Outward DC entry.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'ospdc_create');
  const canWrite = perms.entry;
  // Cancel JW DC -> Edit OR Approve (ADR-235, the ONE standard Cancel): Edit
  // sends a Cancel Request, Approve decides it; the dialog's server preview
  // says which buttons this user gets.
  const canCancel = perms.edit || perms.approve;
  const [cancelRow, setCancelRow] = useState<JwDcOutwardLineRow | null>(null);
  // Seeded once from ?search (deep link); keystrokes stay local after that.
  const [search, setSearch] = useState(() => initialSearch ?? '');
  const [page, setPage] = useState(1);
  // The box is debounced into the server search; a new term goes to page 1.
  const [term, setTerm] = useState(() => (initialSearch ?? '').trim());
  useEffect(() => {
    const next = search.trim();
    if (next === term) return;
    const id = window.setTimeout(() => {
      setTerm(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [search, term]);
  // Sort & Filter runs on the SERVER (ADR-200): the register is paged 25 at a
  // time, so filtering only the loaded page would miss rows. Every change goes
  // back to page 1.
  const sf = useServerSortFilter(TABLE_KEY, () => setPage(1));
  // A `?jw=` landing opens New Outward DC at once (write access only — the
  // modal is gated the same way the + button is).
  const [showModal, setShowModal] = useState(() => Boolean(forJwId));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, error } = useJwDcOutwardLines({
    search: term || undefined,
    sf: sf.param,
    // ADR-235 — Cancelled DCs stay on the register, washed and marked Cancelled.
    includeCancelled: true,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  useClampPage(page, data?.total, setPage);

  const columns = useMemo(() => outwardColumns(), []);
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / LIST_PAGE_SIZE));

  const toggleExpand = useCallback((id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div>
      {/* THE list header (ui/layout ListHeader): title · count · search ·
          + New Outward DC. */}
      <ListHeader
        title="Outward Register"
        icon="📤"
        count={data?.total}
        noun="DC line"
        search={search}
        onSearch={setSearch}
        filtersActive={sf.filtering || search !== ''}
        onClearFilters={() => {
          sf.clearFilters();
          setSearch('');
        }}
        searchPlaceholder="Search DC, PO, vendor…"
        primary={
          canWrite ? (
            <button type="button" className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={14} /> New Outward DC
            </button>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load outward DCs. Try again.'
          }
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEY}
            sortFilterServer={sf}
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(dc) => dc.lineId}
            loading={isLoading}
            empty={term || sf.filtering ? 'No outward DC lines match.' : 'No outward DCs yet.'}
            onRowClick={(dc) => void navigate({ to: '/jw-dc/$id', params: { id: dc.docId } })}
            // Green when every unit is back, amber while a return is still
            // partial. A freshly-sent DC (nothing back yet) stays untinted.
            rowClassName={(dc) =>
              isJwDcCancelled(dc)
                ? ROW_TINT.cancelled
                : dc.returnStatus === 'fully_returned'
                  ? ROW_TINT.done
                  : dc.returnStatus === 'partial'
                    ? ROW_TINT.pending
                    : undefined
            }
            // The fit table's ▸: the DC's Vehicle / Remarks, off the row.
            renderExpanded={(dc) => (expanded.has(dc.lineId) ? <ExpandedOutward dc={dc} /> : null)}
            onToggleExpanded={(dc) => toggleExpand(dc.lineId)}
            rowActionsWidth="1%"
            rowActions={(dc: JwDcOutwardLineRow) => (
              <RowActions
                viewTo={`/jw-dc/${dc.docId}`}
                renderLink={(p) => <Link {...p} />}
                items={[
                  {
                    key: 'preview',
                    label: 'Preview',
                    icon: 'eye',
                    onSelect: () =>
                      jwDcPrint('preview', {
                        id: dc.docId,
                        code: dc.docCode,
                        vendorId: dc.vendorId,
                      }),
                  },
                  {
                    key: 'download',
                    label: 'Download PDF',
                    icon: 'download',
                    onSelect: () =>
                      jwDcPrint('download', {
                        id: dc.docId,
                        code: dc.docCode,
                        vendorId: dc.vendorId,
                      }),
                  },
                  {
                    // A Cancelled DC's ⋯ offers only View / Preview / Download.
                    key: 'cancel',
                    label: 'Cancel JW DC',
                    icon: 'x',
                    group: 'danger',
                    hidden: !canCancel || isJwDcCancelled(dc),
                    onSelect: () => setCancelRow(dc),
                  },
                ]}
              />
            )}
          />
        </Panel>
      )}

      {data ? (
        <ListFooter
          total={data.total}
          noun="DC line"
          page={page}
          pageSize={LIST_PAGE_SIZE}
          onPage={(p) => setPage(Math.min(totalPages, Math.max(1, p)))}
        />
      ) : null}

      {showModal && canWrite ? (
        <NewOutwardModal forJwId={forJwId} onClose={() => setShowModal(false)} />
      ) : null}
      {cancelRow ? (
        <CancelDocDialog
          docType="jw_dc_outward"
          docId={cancelRow.docId}
          docCode={cancelRow.docCode}
          onClose={() => setCancelRow(null)}
        />
      ) : null}
    </div>
  );
}

/** The DC's Vehicle / Remarks (and a Cancelled DC's reason) under an opened
 *  row — all on the line row already, so no extra fetch. */
function ExpandedOutward({ dc }: { dc: JwDcOutwardLineRow }): React.JSX.Element {
  return (
    <div
      className="text3"
      style={{
        padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)',
        fontSize: 'var(--fs-xs)',
      }}
    >
      <b>Process:</b> {dc.processText ?? '—'} &nbsp;·&nbsp; <b>Vehicle No.:</b>{' '}
      {dc.vehicleNo ?? '—'} &nbsp;·&nbsp; <b>Remarks:</b> {dc.remarks ?? '—'}
      {/* ADR-235 — why and when a Cancelled DC was cancelled. */}
      {isJwDcCancelled(dc) ? (
        <div style={{ marginTop: 'var(--sp-1)' }}>
          <b>Reason:</b> {dc.cancelReason ?? '—'}
          {dc.cancelledAt ? ` · Cancelled ${fmtDateTime(dc.cancelledAt)}` : ''}
        </div>
      ) : null}
    </div>
  );
}
