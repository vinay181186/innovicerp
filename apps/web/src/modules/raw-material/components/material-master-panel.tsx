// One master table + inline New/Edit modal + Excel template/import, shared by
// BOTH tabs of Raw Material Master (Grade and Size). The two masters differ only
// in the noun on the column head / buttons and in which hooks feed them, so the
// tab wrappers (grade-tab.tsx / size-tab.tsx) own the hooks and hand the rows
// and the four write callbacks down here. One file instead of two 250-line
// copies that would drift apart on the first fix.
//
// ADR-199 table standard (2026-10-01): the master runs on the shared FIT
// <DataTable tableKey=…> — each tab passes its own key so the user's column
// layout is remembered per master. First column (Code) pinned; the ⋯ row menu
// carries Edit / Move to Trash. Styling still follows the `styling` skill:
// <ListHeader> band, an All / Active / Inactive dropdown in the filter bar whose
// labels carry the counts (owner's filter-bar decision 2026-09-26), clickable
// rows. ADR-201: 25 rows a page (Prev / Next); search, the Active filter and
// the column ▾ Sort & Filter run on the server, and the dropdown counts are
// server totals — the tab wrappers fetch; this panel only draws.

import { Loader2, Plus } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { LIST_PAGE_SIZE, useClampPage } from '@/lib/list-paging';
import { DataTable, Panel, type DataTableColumn } from '@/ui/data';
import type { ServerSortFilter } from '@/ui/data/sort-filter/server-state';
import { ConfirmDialog } from '@/ui/feedback';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader, PageState } from '@/ui/layout';
import { MaterialRowModal } from './material-row-modal';
import type { MaterialStatusFilter } from './use-material-master-paging';

const ACTIVE_OPTIONS = [
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
];

/** The subset of MaterialGrade / MaterialSize this table renders. Both shared
 *  types are structurally assignable to it. */
export interface MaterialMasterRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
}

export interface MaterialMasterSaveInput {
  name: string;
  description: string | null;
  isActive: boolean;
}

export interface MaterialMasterPanelProps {
  /** 'Grade' or 'Size' — the noun used in the column head, buttons and messages. */
  noun: string;
  /** The shared FIT table's saved-layout key (TABLE_KEYS.rawMaterialGrade / …Size). */
  tableKey: string;
  /** The 25 rows of this page (search / Active / ▾ applied on the server). */
  rows: MaterialMasterRow[];
  /** Rows matching the filters, all pages (undefined while loading). */
  total: number | undefined;
  /** Server totals for the All / Active / Inactive dropdown labels. */
  counts: { all: number | undefined; active: number | undefined; inactive: number | undefined };
  status: MaterialStatusFilter;
  onStatus: (s: MaterialStatusFilter) => void;
  sf: ServerSortFilter;
  page: number;
  onPage: (p: number) => void;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  /** Search box text + setter — the tab wrapper debounces it into the hook. */
  searchInput: string;
  onSearchInput: (v: string) => void;
  searchPlaceholder: string;
  namePlaceholder: string;
  /** Create when `id` is null, update otherwise. Throws on failure. */
  onSave: (input: MaterialMasterSaveInput, id: string | null) => Promise<void>;
  saving: boolean;
  onDelete: (row: MaterialMasterRow) => void;
  deleting: boolean;
  onDownloadTemplate: () => void;
  /** Parses + posts the whole sheet in ONE request; resolves to the status line. */
  onImportFile: (file: File) => Promise<string>;
  /** The page's Grade | Size tab strip, drawn inside the one header band. */
  tabs?: React.ReactNode;
}

type ModalState = { kind: 'none' } | { kind: 'new' } | { kind: 'edit'; row: MaterialMasterRow };

export function MaterialMasterPanel(props: MaterialMasterPanelProps): React.JSX.Element {
  const {
    noun,
    tableKey,
    rows,
    total: totalOrUndef,
    counts,
    status,
    onStatus,
    sf,
    page,
    onPage,
    isLoading,
    isFetching,
    isError,
    error,
    searchInput,
    onSearchInput,
    searchPlaceholder,
    namePlaceholder,
    onSave,
    saving,
    onDelete,
    deleting,
    onDownloadTemplate,
    onImportFile,
    tabs,
  } = props;

  // Tier-driven, per department (rawmat_create sits in Production). Add/Import =
  // entry; Edit = edit; Del = the edit+approve pair only L5+ hold.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'rawmat_create');
  const canAdd = perms.entry;
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  const total = totalOrUndef ?? 0;
  useClampPage(page, totalOrUndef, onPage);
  const fmtCount = (n: number | undefined): string => (n === undefined ? '…' : String(n));
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  // The row waiting on the Move-to-Trash confirm (app ConfirmDialog, not window.confirm).
  const [trashRow, setTrashRow] = useState<MaterialMasterRow | null>(null);

  // The four master columns (first pinned = Code). Headers stay noun-qualified
  // (Grade Code / Grade, Size Code / Size) so a joined label never reads as a
  // bare "Code" app-wide. Code is mono + cyan; the name is bold; the description
  // is long free text that shares the spare width and clips with "…"; Active is
  // a status badge.
  const columns = useMemo<DataTableColumn<MaterialMasterRow>[]>(
    () => [
      {
        id: 'code',
        header: `${noun} Code`,
        kind: 'code',
        nowrap: true,
        render: (row) => (
          <span className="td-code" style={{ color: 'var(--cyan)' }}>
            {row.code}
          </span>
        ),
        sortFilterField: 'code',
      },
      {
        id: 'name',
        header: noun,
        align: 'left',
        className: 'fw-700',
        ellipsis: true,
        key: 'name',
        title: (row) => row.name,
        sortFilterField: 'name',
      },
      {
        id: 'description',
        header: 'Description',
        align: 'left',
        kind: 'text',
        ellipsis: true,
        render: (row) => <span className="text2">{row.description || '—'}</span>,
        title: (row) => row.description ?? '',
        sortFilterField: 'description',
      },
      {
        id: 'active',
        header: 'Active',
        kind: 'badge',
        nowrap: true,
        filterValue: (row) => (row.isActive ? 'Active' : 'Inactive'),
        render: (row) => (
          <span className={`badge ${row.isActive ? 'b-green' : 'b-grey'}`}>
            {row.isActive ? 'Active' : 'Inactive'}
          </span>
        ),
        sortFilterField: 'isActive',
        filterType: 'list',
        filterOptions: ACTIVE_OPTIONS,
      },
    ],
    [noun],
  );

  // Excel import — the WHOLE sheet goes in one request, and the list reloads
  // once at the end (never a per-row loop; that ran at ~1 row/second live).
  const fileRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  async function handleFile(file: File): Promise<void> {
    setImporting(true);
    setImportMsg(null);
    try {
      setImportMsg(await onImportFile(file));
    } catch (e) {
      setImportMsg(e instanceof Error ? e.message : 'Could not import the file. Try again.');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div>
      {/* THE list header (2026-09-26 list standard): title · count … + Add;
          filter bar: search · status (counts in the labels) · Clear; the
          Grade | Size tabs in the band. */}
      <ListHeader
        title="Raw Material Master"
        icon="▬"
        count={total}
        noun={noun.toLowerCase()}
        filterNote={status === 'all' ? undefined : status}
        search={searchInput}
        onSearch={onSearchInput}
        searchPlaceholder={searchPlaceholder}
        updating={isFetching && !isLoading}
        filters={
          <Select
            aria-label={`${noun} Status`}
            title={`${noun} Status`}
            value={status}
            options={[
              { value: 'all', label: `All ${noun}s (${fmtCount(counts.all)})` },
              { value: 'active', label: `Active (${fmtCount(counts.active)})` },
              { value: 'inactive', label: `Inactive (${fmtCount(counts.inactive)})` },
            ]}
            onChange={(e) => onStatus(e.target.value as MaterialStatusFilter)}
          />
        }
        onClearFilters={() => {
          sf.clearFilters();
          onSearchInput('');
          onStatus('all');
        }}
        filtersActive={searchInput.trim() !== '' || status !== 'all' || sf.filtering}
        primary={
          canAdd ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setModal({ kind: 'new' })}
            >
              <Plus size={14} /> Add {noun}
            </button>
          ) : null
        }
      >
        {tabs}
      </ListHeader>

      {importMsg ? (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-body" style={{ padding: '10px 14px', fontSize: 12 }}>
            {importMsg}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: 8, fontSize: 11 }}
              onClick={() => setImportMsg(null)}
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error
              ? error.message
              : `Could not load material ${noun.toLowerCase()}s. Try again.`
          }
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={tableKey}
            columns={columns}
            rows={rows}
            loading={isLoading}
            sortFilterServer={sf}
            emptyText={
              !searchInput.trim() && status === 'all' && !sf.filtering
                ? `No ${noun}s yet.`
                : `No ${noun}s match.`
            }
            onRowClick={canEdit ? (row) => setModal({ kind: 'edit', row }) : undefined}
            // ⋯ menu: Edit · ─ · Move to Trash (danger) — same gates as before.
            rowMenu={(row) => [
              {
                key: 'edit',
                label: 'Edit',
                icon: 'pencil',
                hidden: !canEdit,
                onSelect: () => setModal({ kind: 'edit', row }),
              },
              {
                key: 'trash',
                label: 'Move to Trash',
                icon: 'trash-2',
                group: 'danger',
                hidden: !canDelete,
                disabledReason: deleting ? 'Working…' : undefined,
                onSelect: () => setTrashRow(row),
              },
            ]}
          />
        </Panel>
      )}

      {/* 25 a page with Prev / Next (ADR-201). Excel template + import sit
          under it; import creates rows, so it follows the create (entry) right. */}
      <ListFooter
        total={total}
        noun={noun.toLowerCase()}
        page={page}
        pageSize={LIST_PAGE_SIZE}
        onPage={onPage}
        actions={
          canAdd ? (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11 }}
                onClick={onDownloadTemplate}
              >
                ⬇ Download Excel Template
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11 }}
                disabled={importing}
                onClick={() => fileRef.current?.click()}
              >
                {importing ? <Loader2 className="inline h-3 w-3 animate-spin" /> : '⬆'} Import from
                Excel
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
            </>
          ) : undefined
        }
      />

      {trashRow ? (
        <ConfirmDialog
          title={`Move ${noun} ${trashRow.code} to Trash?`}
          message="You can restore it from Trash."
          confirmLabel="Move to Trash"
          onConfirm={() => {
            onDelete(trashRow);
            setTrashRow(null);
          }}
          onCancel={() => setTrashRow(null)}
        />
      ) : null}

      {modal.kind !== 'none' ? (
        <MaterialRowModal
          noun={noun}
          namePlaceholder={namePlaceholder}
          {...(modal.kind === 'edit' ? { row: modal.row } : {})}
          saving={saving}
          onSave={onSave}
          onClose={() => setModal({ kind: 'none' })}
        />
      ) : null}
    </div>
  );
}
