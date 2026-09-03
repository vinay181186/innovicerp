// One master table + inline New/Edit modal + Excel template/import, shared by
// BOTH tabs of Raw Material Master (Grade and Size). The two masters differ only
// in the noun on the column head / buttons and in which hooks feed them, so the
// tab wrappers (grade-tab.tsx / size-tab.tsx) own the hooks and hand the rows
// and the four write callbacks down here. One file instead of two 250-line
// copies that would drift apart on the first fix.
//
// Styling follows the `styling` skill: tbl-wrap + innovic-table (no-wrap cells +
// side scroll for free), ONE StatStrip row for the counts (which double as the
// Active/Inactive filter), clickable rows, and a scrolling list — masters do not
// paginate.

import { Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StatStrip } from '@/components/shared/stat-strip';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';

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
  /** The WHOLE master in one fetch (search-filtered server-side, Active filtered
   *  here so the strip can show all three counts at once). */
  rows: MaterialMasterRow[];
  total: number;
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
}

type ModalState = { kind: 'none' } | { kind: 'new' } | { kind: 'edit'; row: MaterialMasterRow };
type StatusFilter = 'all' | 'active' | 'inactive';

export function MaterialMasterPanel(props: MaterialMasterPanelProps): React.JSX.Element {
  const {
    noun,
    rows,
    total,
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
  } = props;

  // Tier-driven, per department (rawmat_create sits in Production). Add/Import =
  // entry; Edit = edit; Del = the edit+approve pair only L5+ hold.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'rawmat_create');
  const canAdd = perms.entry;
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;

  const [status, setStatus] = useState<StatusFilter>('all');
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });

  const activeCount = rows.filter((r) => r.isActive).length;
  const inactiveCount = rows.length - activeCount;
  const visible = useMemo(
    () =>
      status === 'all' ? rows : rows.filter((r) => (status === 'active' ? r.isActive : !r.isActive)),
    [rows, status],
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
      setImportMsg(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          marginBottom: 12,
          gap: 8,
        }}
      >
        <input
          className="innovic-input"
          placeholder={searchPlaceholder}
          value={searchInput}
          onChange={(e) => onSearchInput(e.target.value)}
          style={{ width: 260, fontSize: 12 }}
        />
        {isFetching && !isLoading ? (
          <span className="text3" style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
            <Loader2 className="inline h-3 w-3 animate-spin" /> Updating…
          </span>
        ) : null}
        {canAdd ? (
          <button type="button" className="btn btn-primary" onClick={() => setModal({ kind: 'new' })}>
            <Plus size={14} /> Add {noun}
          </button>
        ) : null}
      </div>

      {/* Counts + the Active/Inactive filter in ONE strip (styling skill Rule 3). */}
      <div style={{ marginBottom: 12 }}>
        <StatStrip
          items={[
            {
              key: 'all',
              label: `All ${noun}s`,
              count: rows.length,
              color: 'var(--cyan)',
              active: status === 'all',
              onClick: () => setStatus('all'),
            },
            {
              key: 'active',
              label: 'Active',
              count: activeCount,
              color: 'var(--green)',
              active: status === 'active',
              onClick: () => setStatus('active'),
            },
            {
              key: 'inactive',
              label: 'Inactive',
              count: inactiveCount,
              color: 'var(--amber)',
              active: status === 'inactive',
              onClick: () => setStatus('inactive'),
            },
          ]}
        />
      </div>

      {importMsg ? (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="panel-body" style={{ padding: '10px 14px', fontSize: 12 }}>
            {importMsg}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: 8, fontSize: 10 }}
              onClick={() => setImportMsg(null)}
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}

      <div className="panel">
        <div className="tbl-wrap">
          <table className="innovic-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>{noun}</th>
                <th>Description</th>
                <th>Active</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="empty-state">
                    <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
                  </td>
                </tr>
              ) : isError ? (
                <tr>
                  <td colSpan={5} className="empty-state" style={{ color: 'var(--red)' }}>
                    {error instanceof Error
                      ? error.message
                      : `Failed to load material ${noun.toLowerCase()}s`}
                  </td>
                </tr>
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-state">
                    No {noun.toLowerCase()}s — click <strong>+ Add {noun}</strong> to begin
                  </td>
                </tr>
              ) : (
                visible.map((row) => (
                  <tr
                    key={row.id}
                    onClick={canEdit ? () => setModal({ kind: 'edit', row }) : undefined}
                    style={canEdit ? { cursor: 'pointer' } : undefined}
                  >
                    <td className="td-code" style={{ color: 'var(--cyan)' }}>
                      {row.code}
                    </td>
                    <td className="fw-700">{row.name}</td>
                    {/* Long free text — clip with an ellipsis, full value on hover. */}
                    <td className="text2" style={{ fontSize: 12 }}>
                      <span
                        style={{
                          maxWidth: 340,
                          display: 'inline-block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          verticalAlign: 'bottom',
                        }}
                        title={row.description ?? ''}
                      >
                        {row.description || '—'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${row.isActive ? 'b-green' : 'b-grey'}`}>
                        {row.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      {/* Stop once on the wrapper so an action never also fires
                          the row's own open-for-edit click. */}
                      <div
                        style={{ display: 'flex', gap: 4 }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canEdit ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setModal({ kind: 'edit', row })}
                          >
                            Edit
                          </button>
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={deleting}
                            onClick={() => {
                              if (confirm(`Move ${noun.toLowerCase()} "${row.name}" to Trash?`)) {
                                onDelete(row);
                              }
                            }}
                          >
                            Del
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Masters scroll, they do not paginate — one fetch, no Prev/Next. The
          count line says which of the two happened so a capped list can never
          look complete. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 6,
          gap: 12,
          fontSize: 11,
          color: 'var(--text3)',
        }}
      >
        <span>
          {canEdit ? `💡 Click a row to edit that ${noun.toLowerCase()}.` : ''}
        </span>
        <span>
          {total > rows.length
            ? `Showing first ${rows.length} of ${total} — refine with search`
            : `Showing all ${total} ${noun.toLowerCase()}${total === 1 ? '' : 's'}`}
        </span>
      </div>

      {/* Excel template + import sit below the table (mirror of the Operator
          Master). Import creates rows, so it follows the create (entry) right. */}
      {canAdd ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
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
            {importing ? <Loader2 className="inline h-3 w-3 animate-spin" /> : '⬆'} Import from Excel
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
        </div>
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

/** New/Edit modal. Same shape as the Report Type master's inline modal — this
 *  page has no separate create/edit route because it is one tabbed screen. */
function MaterialRowModal({
  noun,
  namePlaceholder,
  row,
  saving,
  onSave,
  onClose,
}: {
  noun: string;
  namePlaceholder: string;
  row?: MaterialMasterRow;
  saving: boolean;
  onSave: (input: MaterialMasterSaveInput, id: string | null) => Promise<void>;
  onClose: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(row?.name ?? '');
  const [description, setDescription] = useState(row?.description ?? '');
  const [isActive, setIsActive] = useState(row?.isActive ?? true);
  const [err, setErr] = useState<string | null>(null);

  // Esc closes, matching every other modal on the app.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(): Promise<void> {
    setErr(null);
    if (!name.trim()) {
      setErr(`${noun} is required.`);
      return;
    }
    try {
      await onSave(
        {
          name: name.trim(),
          description: description.trim() || null,
          isActive,
        },
        row?.id ?? null,
      );
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 100,
        padding: 24,
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        className="panel"
        style={{ width: 'min(620px, 96vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-hdr">
          <span className="panel-title">
            {row ? `✏ Edit ${noun}` : `＋ Add ${noun}`}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            {row ? (
              <div className="form-grp">
                <label className="form-label">Code</label>
                <input className="innovic-input" value={row.code} readOnly />
              </div>
            ) : null}
            <div className={row ? 'form-grp' : 'form-grp form-full'}>
              <label className="form-label">
                {noun} <span className="req">★</span>
              </label>
              <input
                className="innovic-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={namePlaceholder}
                autoFocus
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label">Description</label>
              <input
                className="innovic-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional note — standard, equivalent, stock form…"
              />
            </div>
            <div className="form-grp">
              <label className="form-label">Status</label>
              <select
                className="innovic-select"
                value={isActive ? 'active' : 'inactive'}
                onChange={(e) => setIsActive(e.target.value === 'active')}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          {err ? (
            <div role="alert" style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>
              {err}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving}
              onClick={() => void submit()}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
