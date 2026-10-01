// Customer Material Issue (ADR-079 — job-work cycle completion) — folded in as
// the "Issue" tab of the Party Material screen (formerly standalone
// /party-material-issues). Issues client-supplied ("party") material to a Job
// Card for in-house machining; debits the separate party stock, never own-stock
// store_transactions.
//
// ADR-199 conversion (table standard 2026-10-01): the hand-written
// `.innovic-table` is now the shared FIT table (<DataTable tableKey={
// partyMaterialIssues}>). Columns, the ▸ Remarks expand and both modals live in
// sibling files so every file clears the 400-line rule (this one was 724). Data,
// filters, the server-side search and the mutations are unchanged.

import {
  type ListPartyMaterialIssuesQuery,
  type PartyMaterialIssueListItem,
} from '@innovic/shared';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { DataTable, Panel, ROW_TINT } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { usePartyMaterialIssuesList } from '../api';
import { CancelIssueModal } from './cancel-issue-modal';
import { NewPartyMaterialIssueModal } from './new-party-material-issue-modal';
import { partyMaterialIssueColumns } from './party-material-issue-columns';
import { PartyMaterialIssueExpand } from './party-material-issue-expand';

// The register scrolls; it has no Prev/Next. 500 is the endpoint's ceiling and
// exactly the cap this list already ran under, so nothing that was visible
// before disappears — what changed is that the SEARCH now runs on the server,
// over the whole book, instead of over the rows that happened to be downloaded.
const LIST_LIMIT = 500;

// `initialSearch` — one-time seed from the host route's ?search param (Global
// Search deep link). It fills the box AND the debounced term, so the first fetch
// already carries it; typing afterwards is local and never touches the URL.
export function PartyMaterialIssueView({
  initialSearch,
}: {
  initialSearch?: string | undefined;
}): React.JSX.Element {
  // Tier-driven, per department (party_create sits in Store). This view renders
  // as the Issue tab of /party-grn, so it has to gate itself — the host screen
  // passes it no access props. Cancel reverses an issued quantity, so it is the
  // L5+ pair only L5/L6 hold: L3 has edit without approve, L4 approve without
  // edit.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'party_create');
  const canIssue = perms.entry;
  const canCancel = perms.edit && perms.approve;
  const [searchInput, setSearchInput] = useState(() => initialSearch ?? '');
  const [term, setTerm] = useState(() => normalizeSearchTerm(initialSearch ?? ''));
  const [showModal, setShowModal] = useState(false);
  const [cancelRow, setCancelRow] = useState<PartyMaterialIssueListItem | null>(null);

  useEffect(() => {
    // normalizeSearchTerm (shared) — trims and collapses inner spacing so
    // "  IN-PMI  26 " and "IN-PMI 26" are one query, one cache entry, one fetch.
    const next = normalizeSearchTerm(searchInput);
    if (next === term) return;
    const id = window.setTimeout(() => setTerm(next), 300);
    return () => window.clearTimeout(id);
  }, [searchInput, term]);

  // The term goes to the SERVER now. It used to filter the downloaded rows in
  // the browser, which only ever searched the capped page the endpoint had
  // sent — past the cap the box quietly hid matching issues. A new term is a
  // new query key, so it refetches, and the read always starts at the first
  // page (offset 0) rather than stranding the user mid-list.
  const query: ListPartyMaterialIssuesQuery = useMemo(
    () => ({ ...(term ? { search: term } : {}), limit: LIST_LIMIT, offset: 0 }),
    [term],
  );

  const { data, isLoading, isError, error } = usePartyMaterialIssuesList(query);
  const rows = data?.items ?? [];
  const columns = useMemo(() => partyMaterialIssueColumns(), []);

  // ▸ expand — Remarks are already on the row, so no extra fetch.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Customer Material Issues. Ask an admin.
      </div>
    );
  }

  return (
    <div>
      {/* THE list header (ui/layout ListHeader): title · count · search ·
          + New Issue. */}
      <ListHeader
        title="Customer Material Issue"
        icon="📤"
        count={data?.total}
        noun="issue"
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search Issue No., date, JWSO, Job Card, material, remarks…"
        primary={
          canIssue ? (
            <button type="button" className="btn btn-primary" onClick={() => setShowModal(true)}>
              <Plus size={14} /> New Issue
            </button>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error
              ? error.message
              : 'Could not load party material issues. Try again.'
          }
        />
      ) : (
        // THE shared FIT table (ADR-199). First column (Issue No.) is pinned;
        // the ▸ reveals Remarks. There is no detail page for an issue, so a row
        // is not clickable. Cancelled/reversed issues are soft-deleted and
        // filtered out by the API, so the only tint is the defensive cancelled
        // wash. The one per-row action is Cancel, gated by canCancel exactly as
        // the old ⋯ menu was.
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.partyMaterialIssues}
            columns={columns}
            rows={rows}
            rowKey={(it) => it.id}
            loading={isLoading}
            emptyText={
              term ? 'No Customer Material Issues match.' : 'No Customer Material Issues yet.'
            }
            rowClassName={(it) => (it.deletedAt ? ROW_TINT.cancelled : undefined)}
            renderExpanded={(it) =>
              expanded.has(it.id) ? <PartyMaterialIssueExpand it={it} /> : null
            }
            onToggleExpanded={(it) => toggleExpand(it.id)}
            rowMenu={(it) => [
              {
                key: 'cancel',
                label: 'Cancel Issue',
                icon: 'x',
                group: 'danger',
                hidden: !canCancel,
                onSelect: () => setCancelRow(it),
              },
            ]}
          />
        </Panel>
      )}

      {data ? (
        <ListFooter total={data.total} shown={rows.length} noun="issue" limit={LIST_LIMIT} />
      ) : null}

      {showModal ? <NewPartyMaterialIssueModal onClose={() => setShowModal(false)} /> : null}
      {cancelRow ? <CancelIssueModal row={cancelRow} onClose={() => setCancelRow(null)} /> : null}
    </div>
  );
}
