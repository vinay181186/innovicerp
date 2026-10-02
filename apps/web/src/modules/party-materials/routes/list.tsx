// Party Material Master (Store slice 1) — catalogue of client-supplied
// materials for Job Work orders.
// Mirrors legacy renderPartyMaterial (HTML L24129) + addPartyMaterial
// (L24173) + editPartyMaterial (L24214) + delPartyMaterial (L24233).
//
// ADR-199 table standard (2026-10-01): the master table runs on the shared FIT
// <DataTable tableKey={TABLE_KEYS.partyMaterials}>. The six master columns
// (Code · Name · UOM · Customer · In Stock · Issued) live in
// ../components/party-material-columns; the ▸ detail row reveals Description,
// Grade, Total Received, Returned and who/when recorded it. The two big Add /
// Edit modals moved to their own files so this route file stays under the
// 400-line ceiling. No row click — there is no Customer Material detail page.

import { type PartyMaterialListItem } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { usePartyMaterialsList } from '../api';
import { AddPartyMaterialModal } from '../components/add-party-material-modal';
import {
  PARTY_MATERIAL_HIDDEN_COLUMNS,
  PartyMaterialDetails,
  partyMaterialColumns,
} from '../components/party-material-columns';
import { DeletePartyMaterialModal } from '../components/delete-party-material-modal';
import { EditPartyMaterialModal } from '../components/edit-party-material-modal';
import { ReturnPartyMaterialModal } from '../components/return-party-material-modal';

export const partyMaterialsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'party-material',
  // Search and page live in the URL (ADR-201: 25 rows a page).
  validateSearch: z.object({ search: z.string().optional(), page: pageSearchParam }),
  component: PartyMaterialsListPage,
});

function PartyMaterialsListPage(): React.JSX.Element {
  // Tier-driven, per department (party_create sits in Store). Replaces the old
  // admin/manager flag, which collapsed all seven tiers into two.
  //   + Add -> entry (L2 Data Entry and up)
  //   Edit  -> edit  (L3 Editor and up; L2 creates but cannot alter)
  //   Del   -> edit AND approve. Delete is not one of the four tier actions, so
  //     it is expressed as the pair only L5 Department Admin and above hold: L3
  //     has edit without approve, L4 has approve without edit. Previously this
  //     was admin-only, which locked out the L5 Store Department Admin — the
  //     tier meant to have full rights inside Store.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'party_create');
  const canAdd = perms.entry;
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;
  // R7 (ADR-194): returning spare customer material reuses the jw_create key
  // (the same gate the JWSO create / invoice / return actions use), not
  // party_create — the server enforces jw_create on this endpoint.
  const canReturn = effectiveFormPerms(eff, 'jw_create').entry;
  const urlSearch = partyMaterialsListRoute.useSearch();
  const navigate = partyMaterialsListRoute.useNavigate();
  const page = urlSearch.page;
  const setPage = useCallback(
    (p: number) => void navigate({ search: (prev) => ({ ...prev, page: p }), replace: true }),
    [navigate],
  );
  // The box mirrors ?search=; a 300ms debounce writes it back on page 1.
  const [search, setSearch] = useState(urlSearch.search ?? '');
  useEffect(() => {
    setSearch((prev) =>
      normalizeSearchTerm(prev) === (urlSearch.search ?? '') ? prev : (urlSearch.search ?? ''),
    );
  }, [urlSearch.search]);
  useEffect(() => {
    const trimmed = normalizeSearchTerm(search);
    const next = trimmed === '' ? undefined : trimmed;
    if (next === urlSearch.search) return;
    const id = window.setTimeout(() => {
      void navigate({ search: (prev) => ({ ...prev, search: next, page: 1 }), replace: true });
    }, 300);
    return () => window.clearTimeout(id);
  }, [search, urlSearch.search, navigate]);
  const [showAdd, setShowAdd] = useState(false);
  const [editRow, setEditRow] = useState<PartyMaterialListItem | null>(null);
  const [returnRow, setReturnRow] = useState<PartyMaterialListItem | null>(null);
  // The material the Delete dialog is asking about, or null when closed. A row
  // with stock on hand never gets here — its Delete item is disabled.
  const [deleteRow, setDeleteRow] = useState<PartyMaterialListItem | null>(null);
  // Which rows have their ▸ detail open (the fit table's one expand control).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Sort & Filter runs on the SERVER here (ADR-200): the list is paged, so
  // filtering only the loaded page would miss materials. Every change goes back
  // to page 1.
  const sf = useServerSortFilter(TABLE_KEYS.partyMaterials, () => setPage(1));

  const { data, isLoading, isError, error } = usePartyMaterialsList({
    search: urlSearch.search,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  useClampPage(page, data?.total, setPage);

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / LIST_PAGE_SIZE));
  const rows = useMemo(() => data?.items ?? [], [data?.items]);
  const columns = useMemo(() => partyMaterialColumns(), []);

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
        You do not have permission to view Customer Materials. Ask an admin.
      </div>
    );
  }

  return (
    <div>
      {/* THE list header (ui/layout ListHeader): title · count · search ·
          + Add Material. */}
      <ListHeader
        title="Customer Material Master"
        icon="🏭"
        count={data?.total}
        noun="material"
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search code, material, customer…"
        primary={
          canAdd ? (
            <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
              <Plus size={14} /> Add Material
            </button>
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load customer materials. Try again.'
          }
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.partyMaterials}
            sortFilterServer={sf}
            defaultHidden={[...PARTY_MATERIAL_HIDDEN_COLUMNS]}
            columns={columns}
            rows={rows}
            loading={isLoading}
            emptyText={
              urlSearch.search || sf.filtering
                ? 'No customer materials match.'
                : 'No customer materials yet.'
            }
            // No row click — there is no Customer Material detail page.
            renderExpanded={(pm) => (expanded.has(pm.id) ? <PartyMaterialDetails pm={pm} /> : null)}
            onToggleExpanded={(pm) => toggleExpand(pm.id)}
            // ⋯ menu: Edit · Return (workflow) · ─ · Delete (danger) — same gates
            // as before; greyed with a reason where the server would refuse.
            rowMenu={(pm) => [
              {
                key: 'edit',
                label: 'Edit',
                icon: 'pencil',
                hidden: !canEdit,
                onSelect: () => setEditRow(pm),
              },
              {
                key: 'return',
                label: 'Return',
                icon: 'arrow-left',
                group: 'workflow',
                hidden: !canReturn,
                disabledReason: pm.stockQty <= 0 ? 'Nothing in stock' : undefined,
                onSelect: () => setReturnRow(pm),
              },
              {
                key: 'delete',
                label: 'Delete',
                icon: 'trash-2',
                group: 'danger',
                hidden: !canDelete,
                disabledReason:
                  pm.stockQty > 0 ? `${pm.stockQty} in stock — issue it first` : undefined,
                onSelect: () => setDeleteRow(pm),
              },
            ]}
          />
        </Panel>
      )}

      {data ? (
        <ListFooter
          total={data.total}
          noun="material"
          page={page}
          pageSize={LIST_PAGE_SIZE}
          onPage={(p) => setPage(Math.min(totalPages, Math.max(1, p)))}
        />
      ) : null}

      {showAdd ? <AddPartyMaterialModal onClose={() => setShowAdd(false)} /> : null}
      {editRow ? <EditPartyMaterialModal row={editRow} onClose={() => setEditRow(null)} /> : null}
      {returnRow ? (
        <ReturnPartyMaterialModal row={returnRow} onClose={() => setReturnRow(null)} />
      ) : null}
      {deleteRow ? (
        <DeletePartyMaterialModal
          id={deleteRow.id}
          code={deleteRow.code}
          name={deleteRow.name}
          onClose={() => setDeleteRow(null)}
        />
      ) : null}
    </div>
  );
}
