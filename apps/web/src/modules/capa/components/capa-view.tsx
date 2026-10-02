// CAPA — Corrective & Preventive Action (legacy renderCAPA L22779 + _capaNew /
// _capaEdit 5-step). 6-counter strip + overdue alert + the shared fit table
// (ADR-199) + New modal + 5-step edit modal. Backed by /capa (capa_records,
// migration 0034).
//
// Extracted from capa/routes/list.tsx so the same screen can render both as its
// own route AND as the "🛡 CAPA" tab on NC Register (screen-merge audit). All
// state here is local — CAPA has no URL-driven search params — so the view is
// safe to mount inside another route (the page number is component state).
// ADR-201: 25 rows a page; search, Sort & Filter, the counter strip and the
// overdue count all come from the server over EVERY CAPA. Pass `title` when it IS the page.
// `initialSearch` is a one-time seed for the search box (Global Search deep
// link via the host's ?search); typing afterwards stays local.
//
// The row sheet, row tint and ⋯ menu live in ./capa-list-columns; the two
// modals in ./capa-new-modal and ./capa-edit-modal (ADR-199 split).

import { type CapaRecord } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtDate } from '@/lib/date';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { LIST_PAGE_SIZE, pageOffset, useClampPage } from '@/lib/list-paging';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { StatStrip } from '@/components/shared/stat-strip';
import { ListFooter, ListHeader } from '@/ui/layout';
import { DataTable, Panel } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { AssignTaskModal } from '@/modules/tasks/components/assign-task-modal';
import { useCapaList } from '../api';
import { capaListColumns, capaRowMenu, capaRowTint } from './capa-list-columns';
import { NewCapaModal } from './capa-new-modal';
import { EditCapaModal } from './capa-edit-modal';

type ModalState =
  | { kind: 'none' }
  | { kind: 'new' }
  | { kind: 'edit'; capa: CapaRecord; readOnly: boolean };

export function CapaView(props: {
  title?: string;
  initialSearch?: string | undefined;
  /** Open the CAPA named by initialSearch in its 5-step edit (not read-only) —
   *  used right after "Create CAPA" on an NC so the user lands on the work. */
  openForEdit?: boolean | undefined;
}): React.JSX.Element {
  const [term, setTerm] = useState(() => props.initialSearch ?? '');
  const [page, setPage] = useState(1);
  // The search box goes to the server 300 ms after typing stops → page 1.
  const [search, setSearch] = useState(() => normalizeSearchTerm(props.initialSearch ?? ''));
  useEffect(() => {
    const next = normalizeSearchTerm(term);
    if (next === search) return;
    const id = window.setTimeout(() => {
      setSearch(next);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [term, search]);
  const sf = useServerSortFilter(TABLE_KEYS.capaList, () => setPage(1));
  const { data, isLoading, isFetching, isError, error } = useCapaList({
    search: search || undefined,
    sf: sf.param,
    limit: LIST_PAGE_SIZE,
    offset: pageOffset(page),
  });
  useClampPage(page, data?.total, setPage);
  const { data: eff } = useMyAccess();
  // Tier-driven, per department (QC), on the CAPA form key — `capa_create` was
  // a registered key nothing consulted, so this screen ran on the global role
  // string (admin||manager||qc) and ignored the user's actual QC tier.
  const perms = effectiveFormPerms(eff, 'capa_create');
  // Raising a CAPA is a create → entry. Progressing one through the 5 steps
  // (root cause → verification → closure) rewrites a saved record → edit.
  const canCreate = perms.entry;
  const canEdit = perms.edit;
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [assignCapa, setAssignCapa] = useState<CapaRecord | null>(null);
  // The fit table's ▸ is the row's one expand control (CAPA Date + Root Cause).
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());
  const columns = useMemo(() => capaListColumns(), []);

  const items = useMemo(() => data?.items ?? [], [data]);
  const counters = data?.counters;

  // A link that names one CAPA (NC chip, Global Search) opens that CAPA, not
  // just the filtered list. Once, when the list first arrives.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !props.initialSearch || items.length === 0) return;
    const want = props.initialSearch.trim().toLowerCase();
    const hit = items.find((c) => c.code.toLowerCase() === want);
    // A just-created CAPA may not be in the cached list yet — wait for the
    // refetch before giving up.
    if (!hit && isFetching) return;
    autoOpened.current = true;
    if (hit) setModal({ kind: 'edit', capa: hit, readOnly: !props.openForEdit });
  }, [items, isFetching, props.initialSearch, props.openForEdit]);
  // Overdue = Open / In Progress past target, counted by the server over ALL
  // CAPAs (not the 25 on this page).
  const overdueCount = counters?.overdue ?? 0;
  const total = data?.total ?? 0;

  const toggleExpand = (id: string): void =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div>
      <ListHeader
        title={props.title ?? 'CAPA'}
        icon="🛡"
        count={data ? total : undefined}
        noun="CAPA"
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search CAPA no., type, NC no., problem, responsible, status…"
        updating={isFetching && !isLoading}
        onClearFilters={() => {
          sf.clearFilters();
          setTerm('');
        }}
        filtersActive={sf.filtering || term !== ''}
        primary={
          canCreate ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setModal({ kind: 'new' })}
            >
              ➕ New CAPA
            </button>
          ) : null
        }
      >
        {/* Counter cards — one strip */}
        {counters ? (
          <StatStrip
            items={[
              { key: 'total', label: 'Total', count: counters.total, color: 'var(--purple2)' },
              { key: 'open', label: 'Open', count: counters.open, color: 'var(--blue)' },
              {
                key: 'inProgress',
                label: 'In Progress',
                count: counters.inProgress,
                color: 'var(--amber2)',
              },
              {
                key: 'verified',
                label: 'Verified',
                count: counters.verified,
                color: 'var(--blue)',
              },
              { key: 'closed', label: 'Closed', count: counters.closed, color: 'var(--green2)' },
              {
                key: 'effectiveness',
                label: 'Effectiveness',
                count: `${counters.effectivenessPct}%`,
                color: 'var(--green2)',
              },
            ]}
          />
        ) : null}
      </ListHeader>

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading CAPA…
          </div>
        </div>
      ) : isError || !data ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Could not load CAPA. Try again.'}
          </div>
        </div>
      ) : (
        <>
          {overdueCount > 0 ? (
            <div
              style={{
                padding: '10px 14px',
                background: 'var(--amber3)',
                border: '1px solid var(--amber2)',
                borderRadius: 8,
                marginBottom: 12,
                fontSize: 12,
                display: 'flex',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 16 }}>⚠️</span>
              <b style={{ color: 'var(--amber2)' }}>{overdueCount} CAPAs overdue</b>
            </div>
          ) : null}

          <Panel bodyPadding="none">
            <DataTable<CapaRecord>
              tableKey={TABLE_KEYS.capaList}
              columns={columns}
              rows={items}
              sortFilterServer={sf}
              rowKey={(c) => c.id}
              empty={search || sf.filtering ? 'No CAPAs match.' : 'No CAPAs yet.'}
              rowClassName={(c) => capaRowTint(c)}
              onRowClick={(c) => setModal({ kind: 'edit', capa: c, readOnly: true })}
              // The fit table's ▸ is the row's one expand control: it reveals
              // CAPA Date and Root Cause. renderExpanded returns null for a
              // collapsed row.
              renderExpanded={(c) =>
                expandedIds.has(c.id) ? (
                  <div
                    style={{
                      display: 'flex',
                      gap: 24,
                      flexWrap: 'wrap',
                      fontSize: 12,
                      padding: '2px 2px',
                    }}
                  >
                    <span>
                      <span className="text3">CAPA Date</span>{' '}
                      <b className="mono">{fmtDate(c.capaDate)}</b>
                    </span>
                    <span style={{ flex: '1 1 320px', minWidth: 0 }}>
                      <span className="text3">Root Cause</span>{' '}
                      {c.rootCause ? c.rootCause : <span className="text3">—</span>}
                    </span>
                  </div>
                ) : null
              }
              onToggleExpanded={(c) => toggleExpand(c.id)}
              rowMenu={(c) =>
                capaRowMenu(c, {
                  canEdit,
                  onEdit: (row) => setModal({ kind: 'edit', capa: row, readOnly: false }),
                  onAssign: (row) => setAssignCapa(row),
                })
              }
            />
          </Panel>
          <ListFooter
            total={total}
            noun="CAPA"
            page={page}
            pageSize={LIST_PAGE_SIZE}
            onPage={setPage}
          />
        </>
      )}

      {modal.kind === 'new' ? (
        <NewCapaModal
          onClose={() => setModal({ kind: 'none' })}
          // The CAPA's real work (root cause, actions…) is in the 5-step edit —
          // open it straight after save instead of dropping the user on the list.
          onCreated={(capa) => setModal({ kind: 'edit', capa, readOnly: false })}
        />
      ) : null}
      {modal.kind === 'edit' ? (
        <EditCapaModal
          capa={modal.capa}
          readOnly={modal.readOnly || !canEdit}
          onClose={() => setModal({ kind: 'none' })}
        />
      ) : null}

      {assignCapa ? (
        <AssignTaskModal
          linkedRef={{
            type: 'capa',
            id: assignCapa.id,
            display: `CAPA ${assignCapa.code}`,
            navPage: '/capa',
          }}
          suggestedTitle={`Continue ${assignCapa.code}`}
          onClose={() => setAssignCapa(null)}
        />
      ) : null}
    </div>
  );
}
