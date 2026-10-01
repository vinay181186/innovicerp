// Outward Register — JW DC material sent out to a vendor, on the shared FIT
// DataTable (ADR-199, table standard 2026-10-01). Split out of routes/list.tsx.
//
// Row click opens the outward detail (/jw-dc/$id); the ▸ reveals the DC's item
// lines plus Vehicle / Remarks, fetched only for an opened row. The whole row is
// washed by its return status (ROW_TINT). RowActions carries View as a real link
// so ctrl-click still opens a new tab.

import { type JwDcOutwardListItem } from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState, RowActions } from '@/ui/layout';
import { useJwDcOutwardDetail, useJwDcOutwardList } from '../api';
import { outwardColumns } from './outward-columns';
import { NewOutwardModal } from './new-outward-modal';

const PAGE_SIZE = 50;

export function OutwardView({
  forJwId,
  initialSearch,
}: {
  forJwId?: string | undefined;
  /** Seeded ONCE from the route's ?search (deep link); keystrokes stay local. */
  initialSearch?: string | undefined;
}): React.JSX.Element {
  const navigate = useNavigate();
  // Same right the server checks (ADR-193): OSP Outward DC entry.
  const { data: eff } = useMyAccess();
  const canWrite = effectiveFormPerms(eff, 'ospdc_create').entry;
  // Seeded once from ?search (deep link); keystrokes stay local after that.
  const [search, setSearch] = useState(() => initialSearch ?? '');
  const [page, setPage] = useState(1);
  // A `?jw=` landing opens New Outward DC at once (write access only — the
  // modal is gated the same way the + button is).
  const [showModal, setShowModal] = useState(() => Boolean(forJwId));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, error } = useJwDcOutwardList({
    search: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const columns = useMemo(() => outwardColumns(), []);
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

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
        noun="outward DC"
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
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
            tableKey={TABLE_KEYS.jwDcOutward}
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(dc) => dc.id}
            loading={isLoading}
            empty={search.trim() ? 'No outward DCs match.' : 'No outward DCs yet.'}
            onRowClick={(dc) => void navigate({ to: '/jw-dc/$id', params: { id: dc.id } })}
            // Green when every unit is back, amber while a return is still
            // partial. A freshly-sent DC (nothing back yet) stays untinted.
            rowClassName={(dc) =>
              dc.returnStatus === 'fully_returned'
                ? ROW_TINT.done
                : dc.returnStatus === 'partial'
                  ? ROW_TINT.pending
                  : undefined
            }
            // The fit table's ▸ is the row's one expand control: it reveals the
            // DC's item lines, fetched only for an opened row.
            renderExpanded={(dc) => (expanded.has(dc.id) ? <ExpandedOutward dcId={dc.id} /> : null)}
            onToggleExpanded={(dc) => toggleExpand(dc.id)}
            rowActionsWidth="1%"
            rowActions={(dc: JwDcOutwardListItem) => (
              <RowActions viewTo={`/jw-dc/${dc.id}`} renderLink={(p) => <Link {...p} />} />
            )}
          />
        </Panel>
      )}

      {data ? (
        <ListFooter
          total={data.total}
          noun="outward DC"
          page={page}
          pageSize={PAGE_SIZE}
          onPage={(p) => setPage(Math.min(totalPages, Math.max(1, p)))}
        />
      ) : null}

      {showModal && canWrite ? (
        <NewOutwardModal forJwId={forJwId} onClose={() => setShowModal(false)} />
      ) : null}
    </div>
  );
}

/** The DC's item lines + Vehicle / Remarks, under an opened row. Its own fetch,
 *  so the list endpoint stays one request and only opened rows cost anything. */
function ExpandedOutward({ dcId }: { dcId: string }): React.JSX.Element {
  const { data, isLoading } = useJwDcOutwardDetail(dcId);

  if (isLoading) return <PageState as="inline" state="loading" message="⟳ Loading items…" />;
  if (!data) return <PageState as="inline" state="empty" message="—" />;

  return (
    <div style={{ padding: 'var(--sp-2) var(--sp-3) var(--sp-3) var(--sp-6)' }}>
      <div
        className="mono fw-700"
        style={{ fontSize: 'var(--fs-xs)', color: 'var(--purple)', marginBottom: 'var(--sp-1)' }}
      >
        ▸ Items — {data.code}
      </div>
      <table className="innovic-table tbl-grid tbl-compact">
        <thead>
          <tr>
            <th style={{ color: 'var(--purple)' }}>POL</th>
            <th>Item Code · Name</th>
            <th className="th-num">Sent</th>
            <th className="th-num">Returned</th>
            <th className="th-num">Pending</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.map((l) => (
            <tr key={l.id}>
              <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                {l.clientPoLineNo ?? '—'}
              </td>
              <td>
                <b>{itemCodeWithRev(l.itemCode ?? l.itemCodeText, l.itemRevision)}</b>{' '}
                <span style={{ color: 'var(--text3)' }}>{l.itemName ?? l.itemNameText ?? ''}</span>
              </td>
              <td className="mono td-num">{l.sentQty}</td>
              <td className="mono td-num" style={{ color: 'var(--green2)' }}>
                {l.alreadyReturned}
              </td>
              <td className="mono fw-700 td-num" style={{ color: 'var(--red2)' }}>
                {l.pending}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text3" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-2)' }}>
        <b>Vehicle No.:</b> {data.vehicleNo ?? '—'} &nbsp;·&nbsp; <b>Remarks:</b>{' '}
        {data.remarks ?? '—'}
      </div>
    </div>
  );
}
