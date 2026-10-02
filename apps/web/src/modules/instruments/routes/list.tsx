// Instrument Register (ADR-193 phase 4a) — one row per serial-tracked Tool /
// Instrument piece: Instrument Status, calibration dates, who holds it. Click a
// row for its calibration history and actions. Registering never moves stock;
// the strip above the table lists pieces received but not yet registered.
//
// Migrated onto the standard <DataTable tableKey> sheet (ADR-199): the
// hand-written <table> is replaced, the FIRST (pinned) column is the Instrument
// Serial No. (ADR-199 decision #4 for this register), and an overdue-calibration
// row is washed with ROW_TINT.late. The query, the status + calibration-due
// filters, the "received but not registered" banner, the permission gate and the
// register / detail modals are unchanged.
import {
  INSTRUMENT_STATUSES,
  INSTRUMENT_STATUS_LABELS,
  type InstrumentListItem,
  type InstrumentStatus,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { normalizeSearchTerm } from '@/components/shared/search-match';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { LIST_PAGE_SIZE, pageOffset, pageSearchParam, useClampPage } from '@/lib/list-paging';
import { authenticatedRoute } from '@/routes/_authenticated';
import { DataTable, Panel, ROW_TINT, type DataTableColumn } from '@/ui/data';
import { useServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Banner } from '@/ui/feedback';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useInstrumentsList, useUnregisteredInstruments } from '../api';
import { InstrumentDetailModal } from '../components/instrument-detail-modal';
import {
  RegisterInstrumentModal,
  type RegisterSeed,
} from '../components/register-instrument-modal';
import { DUE_COLOUR, INSTRUMENT_STATUS_BADGE, dueTone } from '../lib/instrument-ui';

type DueFilter = '' | 'week' | 'overdue';
// Sort & Filter tick list (ADR-200): the stored status + the label shown.
const STATUS_OPTIONS = INSTRUMENT_STATUSES.map((s) => ({
  value: s,
  label: INSTRUMENT_STATUS_LABELS[s],
}));

export const instrumentsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'instruments',
  // Search, filters and the page live in the URL (ADR-201) so Refresh / Back
  // keep the page the user was on.
  validateSearch: z.object({
    search: z.string().optional(),
    status: z.enum(INSTRUMENT_STATUSES).optional(),
    due: z.enum(['week', 'overdue']).optional(),
    page: pageSearchParam,
  }),
  component: InstrumentsListPage,
});

function InstrumentsListPage(): React.JSX.Element {
  // Same form key as Tool Issue: the storekeeper who issues instruments keeps
  // their register. view → the page, entry → register / calibrate / scrap.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'toolissue_create');
  const urlSearch = instrumentsListRoute.useSearch();
  const navigate = instrumentsListRoute.useNavigate();
  const status: InstrumentStatus | '' = urlSearch.status ?? '';
  const due: DueFilter = urlSearch.due ?? '';
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
  // undefined = closed; null = open with no item chosen.
  const [registerSeed, setRegisterSeed] = useState<RegisterSeed | null | undefined>(undefined);
  const [viewId, setViewId] = useState<string | null>(null);

  const allowed = !eff || perms.view;
  // Sort & Filter runs on the SERVER here (ADR-200): the register is paged, so
  // filtering only the loaded page would miss instruments. Every change goes
  // back to page 1.
  const sf = useServerSortFilter(TABLE_KEYS.instruments, () => setPage(1));
  const { data, isLoading, isError, error } = useInstrumentsList(
    {
      search: urlSearch.search,
      sf: sf.param,
      status: status || undefined,
      due: due || undefined,
      limit: LIST_PAGE_SIZE,
      offset: pageOffset(page),
    },
    allowed,
  );
  useClampPage(page, data?.total, setPage);
  const { data: unregistered } = useUnregisteredInstruments();
  const pending = (unregistered ?? []).filter((u) => u.unregisteredQty > 0);

  const filtered = Boolean(search.trim() || status || due || sf.filtering);

  // The ruled sheet's columns. Serial No. is the pinned first column (ADR-199
  // #4). Instrument Status is a badge; Calibration Due keeps its amber/red
  // colour and "· Overdue" tag; the long free-text columns clip with a tooltip.
  const columns = useMemo<DataTableColumn<InstrumentListItem>[]>(
    () => [
      {
        id: 'serial_no',
        sortFilterField: 'serialNo',
        header: 'Instrument Serial No.',
        nowrap: true,
        className: 'mono fw-700',
        key: 'serialNo',
      },
      {
        id: 'item_code',
        sortFilterField: 'itemCode',
        filterType: 'text',
        header: 'Item Code',
        nowrap: true,
        render: (ins) => (
          <span className="td-code mono fw-700" style={{ color: 'var(--text)' }}>
            {ins.itemCode}
          </span>
        ),
      },
      {
        id: 'item_name',
        sortFilterField: 'itemName',
        header: 'Item Name',
        align: 'left',
        ellipsis: true,
        render: (ins) => ins.itemName || '—',
        title: (ins) => ins.itemName ?? '',
      },
      {
        id: 'status',
        sortFilterField: 'status',
        filterOptions: STATUS_OPTIONS,
        header: 'Instrument Status',
        kind: 'badge',
        nowrap: true,
        render: (ins) => (
          <>
            <span className={`badge ${INSTRUMENT_STATUS_BADGE[ins.status]}`}>
              {INSTRUMENT_STATUS_LABELS[ins.status]}
            </span>
            {ins.writeoffPending ? (
              <span className="badge b-red" style={{ marginLeft: 4 }}>
                Write-off pending
              </span>
            ) : null}
          </>
        ),
      },
      {
        id: 'calibration_due',
        sortFilterField: 'calibrationDueOn',
        header: 'Calibration Due',
        kind: 'date',
        nowrap: true,
        render: (ins) => {
          const tone = dueTone(ins.calibrationDueOn, ins.isCalibrationOverdue);
          return (
            <span
              style={{
                color: DUE_COLOUR[tone],
                fontWeight: tone === 'overdue' || tone === 'soon' ? 700 : undefined,
              }}
            >
              {fmtDate(ins.calibrationDueOn)}
              {tone === 'overdue' ? ' · Overdue' : ''}
            </span>
          );
        },
      },
      {
        id: 'last_calibrated',
        sortFilterField: 'lastCalibratedOn',
        header: 'Last Calibrated',
        kind: 'date',
        nowrap: true,
        render: (ins) => fmtDate(ins.lastCalibratedOn),
      },
      {
        id: 'location',
        sortFilterField: 'location',
        header: 'Location',
        ellipsis: true,
        render: (ins) => ins.location || '—',
        title: (ins) => ins.location ?? '',
      },
      {
        id: 'held_by',
        sortFilterField: 'heldBy',
        filterType: 'text',
        header: 'Held By',
        nowrap: true,
        render: (ins) => (
          <>
            {ins.heldBy || '—'}
            {ins.toolIssueCode ? (
              <span className="mono" style={{ marginLeft: 6, color: 'var(--purple)' }}>
                {ins.toolIssueCode}
              </span>
            ) : null}
          </>
        ),
      },
    ],
    [],
  );

  if (!allowed) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view the Instrument Register. Ask an admin.
      </div>
    );
  }

  return (
    <div>
      <ListHeader
        title="Instrument Register"
        icon="📏"
        count={data?.total}
        noun="instrument"
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search item code, name, Instrument Serial No., location, held by…"
        filters={
          <>
            <Select
              value={status}
              aria-label="Instrument Status"
              onChange={(e) => {
                const v = e.target.value as InstrumentStatus | '';
                void navigate({
                  search: (prev) => ({ ...prev, status: v || undefined, page: 1 }),
                  replace: true,
                });
              }}
              options={[
                { value: '', label: 'All' },
                ...INSTRUMENT_STATUSES.map((s) => ({
                  value: s,
                  label: INSTRUMENT_STATUS_LABELS[s],
                })),
              ]}
            />
            <Select
              value={due}
              aria-label="Calibration Due"
              onChange={(e) => {
                const v = e.target.value as DueFilter;
                void navigate({
                  search: (prev) => ({ ...prev, due: v || undefined, page: 1 }),
                  replace: true,
                });
              }}
              options={[
                { value: '', label: 'Any Calibration Due' },
                { value: 'week', label: 'Due in 7 days' },
                { value: 'overdue', label: 'Overdue' },
              ]}
            />
          </>
        }
        filtersActive={filtered}
        onClearFilters={() => {
          sf.clearFilters();
          setSearch('');
          void navigate({
            search: (prev) => ({
              ...prev,
              search: undefined,
              status: undefined,
              due: undefined,
              page: 1,
            }),
            replace: true,
          });
        }}
        primary={
          perms.entry ? (
            <button type="button" className="btn btn-primary" onClick={() => setRegisterSeed(null)}>
              <Plus size={14} /> Register Instrument
            </button>
          ) : null
        }
      />

      {pending.length > 0 ? (
        <Banner tone="info" title="Received but not registered">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {pending.map((u) => (
              <span key={u.itemId} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                  {u.itemCode}
                </span>
                × <span className="mono">{u.unregisteredQty}</span>
                {perms.entry ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setRegisterSeed({ itemId: u.itemId, itemCode: u.itemCode })}
                  >
                    Register
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        </Banner>
      ) : null}

      {isError ? (
        <div className="panel">
          <div className="panel-body empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Could not load instruments.'}
          </div>
        </div>
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.instruments}
            sortFilterServer={sf}
            columns={columns}
            rows={data?.items ?? []}
            loading={isLoading}
            emptyText={filtered ? 'No instruments match.' : 'No instruments registered yet.'}
            onRowClick={(ins) => setViewId(ins.id)}
            rowClassName={(ins) => (ins.isCalibrationOverdue ? ROW_TINT.late : undefined)}
          />
        </Panel>
      )}
      {data ? (
        <ListFooter
          total={data.total}
          noun="instrument"
          page={page}
          pageSize={LIST_PAGE_SIZE}
          onPage={setPage}
        />
      ) : null}

      {registerSeed !== undefined && perms.entry ? (
        <RegisterInstrumentModal seed={registerSeed} onClose={() => setRegisterSeed(undefined)} />
      ) : null}
      {viewId ? (
        <InstrumentDetailModal
          instrumentId={viewId}
          canAct={perms.entry}
          onClose={() => setViewId(null)}
        />
      ) : null}
    </div>
  );
}
