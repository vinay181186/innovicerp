// Item Issue Register (PL-II-1) — daily-use consumable register.
// Mirrors legacy renderIssueRegister (HTML L23874) + addIssue (L23914).

import {
  type CreateStoreIssueInput,
  STORE_ISSUE_REF_TYPES,
  type StoreIssueRefType,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { ToolIssueRegisterView } from '@/modules/tool-issues/components/tool-issue-register-view';
import { fmtDate, todayIst } from '@/lib/date';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useItemBalance } from '@/modules/store-transactions/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { SearchableSelect } from '@/ui/forms';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useItemsList } from '../../items/api';
import { useCreateStoreIssue, useNextStoreIssueCode, useStoreIssuesList } from '../api';

const PAGE_SIZE = 25;

// Deep-link seed for Global Search (no detail page here): `?tab=tools&search=
// TIS-00003` opens the Tool Issues tab with its box pre-filled. Read ONCE into
// the local state below — tab clicks and typing stay local, never navigate.
const searchSchema = z.object({
  tab: z.enum(['items', 'tools']).optional(),
  search: z.string().optional(),
});

export const storeIssuesListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'issue-register',
  validateSearch: (search) => searchSchema.parse(search),
  component: StoreIssuesListPage,
});

function StoreIssuesListPage(): React.JSX.Element {
  const routeSearch = storeIssuesListRoute.useSearch();
  const [tab, setTab] = useState<'items' | 'tools'>(() => routeSearch.tab ?? 'items');
  // Seed this tab's box only when the landing targets it; a `?tab=tools`
  // landing must not pre-fill the Items box with a tool-issue code.
  const [search, setSearch] = useState(() =>
    (routeSearch.tab ?? 'items') === 'items' ? (routeSearch.search ?? '') : '',
  );
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  // Tier-driven, per department (Store). Was `role === admin || manager`, which
  // let any manager in any department post a stock issue and locked out the
  // L2 storekeeper whose job this is. This gate covers the Item Issues tab
  // only — the Tool Issues tab hits a different endpoint under a different key
  // (`toolissue_create`) and carries its own create control inside
  // `tool-issues/components/tool-issue-register-view.tsx`, still on the old
  // role check. The server-side `toolissue_create` guard is in place either way.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'issue_create');

  const { data, isLoading, isError, error } = useStoreIssuesList({
    search: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !perms.view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view Issues. Ask an admin.
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border)',
          marginBottom: 14,
        }}
      >
        {(['items', 'tools'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--cyan)' : '2px solid transparent',
              color: tab === t ? 'var(--cyan)' : 'var(--text3)',
              fontSize: 12,
              fontWeight: 700,
              padding: '6px 12px',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t === 'items' ? 'Item Issues' : 'Tool Issues'}
          </button>
        ))}
      </div>

      {tab === 'tools' ? (
        // key: a new ?search landing while already on this page remounts the
        // view so it re-seeds; nothing else changes the key.
        <ToolIssueRegisterView key={routeSearch.search ?? ''} initialSearch={routeSearch.search} />
      ) : (
        <>
          {/* THE list header (ui/layout ListHeader): title · count · search ·
              + New Issue. */}
          <ListHeader
            title="Item Issue Register"
            icon="📋"
            count={data?.total}
            noun="issue"
            search={search}
            onSearch={(v) => {
              setSearch(v);
              setPage(1);
            }}
            searchPlaceholder="Search issue, item, JC…"
            primary={
              perms.entry ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowModal(true)}
                >
                  <Plus size={14} /> New Issue
                </button>
              ) : null
            }
          />

          <div className="panel">
            {isLoading ? (
              <div className="panel-body">
                <div className="text3" style={{ fontSize: 12 }}>
                  <Loader2 size={14} className="inline animate-spin" /> Loading…
                </div>
              </div>
            ) : isError ? (
              <div className="panel-body">
                <div className="empty-state" style={{ color: 'var(--red2)' }}>
                  {error instanceof Error ? error.message : 'Could not load issues. Try again.'}
                </div>
              </div>
            ) : data ? (
              <div className="tbl-wrap">
                <table className="innovic-table tbl-grid">
                  <thead>
                    <tr>
                      <th>Issue No.</th>
                      <th>Issue Date</th>
                      <th>Item Code</th>
                      <th>Item Name</th>
                      <th className="th-num">Issue Qty</th>
                      <th>Issued To</th>
                      <th>Reference</th>
                      <th>Purpose</th>
                      <th>Remarks</th>
                      <th>Issued By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((iss) => (
                      <tr key={iss.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span className="td-code" style={{ color: 'var(--cyan)' }}>
                            {iss.code}
                          </span>
                        </td>
                        <td className="text2" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                          {fmtDate(iss.issueDate)}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span className="td-code fw-700" style={{ color: 'var(--text)' }}>
                            {iss.itemCode ?? iss.itemCodeText ?? '—'}
                          </span>
                        </td>
                        <td>{iss.itemName || '—'}</td>
                        <td className="mono fw-700 td-num" style={{ fontSize: 14 }}>
                          {iss.qty}
                        </td>
                        <td>{iss.issuedTo || '—'}</td>
                        <td
                          className="mono"
                          style={{ fontSize: 11, color: 'var(--purple)', whiteSpace: 'nowrap' }}
                        >
                          {iss.refNo ? `${iss.refType ?? ''} ${iss.refNo}` : '—'}
                        </td>
                        <td className="text3" style={{ fontSize: 11 }}>
                          {iss.purpose || '—'}
                        </td>
                        <td className="text3" style={{ fontSize: 11 }} title={iss.remarks ?? ''}>
                          {iss.remarks || '—'}
                        </td>
                        <td>{iss.issuedByName || '—'}</td>
                      </tr>
                    ))}
                    {data.items.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="empty-state">
                          {search.trim() ? 'No issues match.' : 'No issues yet.'}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

          {data ? (
            <ListFooter
              total={data.total}
              noun="issue"
              page={page}
              pageSize={PAGE_SIZE}
              onPage={(p) => setPage(Math.min(totalPages, Math.max(1, p)))}
            />
          ) : null}

          {showModal && perms.entry ? <NewIssueModal onClose={() => setShowModal(false)} /> : null}
        </>
      )}
    </div>
  );
}

function NewIssueModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [date, setDate] = useState(todayIst());
  const [itemId, setItemId] = useState<string | null>(null);
  const [qty, setQty] = useState('');
  const [issuedTo, setIssuedTo] = useState('');
  const [refType, setRefType] = useState<StoreIssueRefType>('Job Card');
  const [refNo, setRefNo] = useState('');
  const [purpose, setPurpose] = useState('');
  const [remarks, setRemarks] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [err, setErr] = useState<string | null>(null);
  // "Save & New": the code of the issue just saved, shown as a note
  // while the next one is keyed in. Bumping `pickerKey` remounts the item
  // picker so its typed text clears with the value.
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState(0);

  const createMut = useCreateStoreIssue();
  const { data: next } = useNextStoreIssueCode();
  const { data: itemsData, isFetching: itemsFetching } = useItemsList({
    search: itemSearch.trim() || undefined,
    limit: 50,
    offset: 0,
  });
  const itemOptions = useMemo(
    () => (itemsData?.items ?? []).map((it) => ({ id: it.id, code: it.code, name: it.name })),
    [itemsData],
  );
  // Physical stock of the picked item — the same per-item balance the Item
  // Master detail page shows as "Physical".
  const balanceQ = useItemBalance(itemId ?? undefined);

  const save = (andAnother: boolean): void => {
    setErr(null);
    if (!date) {
      setErr('Issue Date is required.');
      return;
    }
    if (!itemId) {
      setErr('Item is required.');
      return;
    }
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      setErr('Qty to Issue must be more than 0.');
      return;
    }
    if (!issuedTo.trim()) {
      setErr('Issued To is required.');
      return;
    }
    const input: CreateStoreIssueInput = {
      issueDate: date,
      itemId,
      qty: q,
      issuedTo: issuedTo.trim(),
      refType,
    };
    if (refNo.trim()) input.refNo = refNo.trim();
    if (purpose.trim()) input.purpose = purpose.trim();
    if (remarks.trim()) input.remarks = remarks.trim();
    createMut.mutate(input, {
      onSuccess: (created) => {
        if (!andAnother) {
          onClose();
          return;
        }
        // Keep Issue Date, Issued To and the Reference; clear the rest.
        setLastSaved(created.code);
        setItemId(null);
        setItemSearch('');
        setQty('');
        setPurpose('');
        setRemarks('');
        setPickerKey((k) => k + 1);
      },
      onError: (e) => setErr(e instanceof Error ? e.message : 'Could not save issue. Try again.'),
    });
  };

  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-hdr">
          <span className="modal-title">New Item Issue</span>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label">Issue No.</label>
              <input
                type="text"
                className="innovic-input"
                value={next?.code ?? '(auto on save)'}
                readOnly
              />
            </div>

            <div className="form-grp">
              <label className="form-label">
                Issue Date <span className="req">★</span>
              </label>
              <input
                type="date"
                className="innovic-input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            <div className="form-grp form-full">
              <label className="form-label" htmlFor="si-item">
                Item <span className="req">★</span>
              </label>
              {/* Keyboard-friendly type-to-search picker (↑/↓ + Enter), over
                  the same item search this modal always used. */}
              <SearchableSelect
                key={pickerKey}
                id="si-item"
                value={itemId}
                onChange={setItemId}
                options={itemOptions}
                onSearch={setItemSearch}
                loading={itemsFetching}
                placeholder="🔍 Type item code or name…"
                emptyText="No matching item"
              />
              {itemId ? (
                <div className="text3" style={{ fontSize: 12, marginTop: 4 }}>
                  In stock:{' '}
                  <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                    {balanceQ.isLoading ? '…' : (balanceQ.data?.onHand ?? 0)}
                  </span>
                </div>
              ) : null}
            </div>

            <div className="form-grp">
              <label className="form-label">
                Qty to Issue <span className="req">★</span>
              </label>
              <input
                type="number"
                min={1}
                className="innovic-input"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="0"
                style={{ fontSize: 16, fontWeight: 700 }}
              />
            </div>

            <div className="form-grp">
              <label className="form-label">
                Issued To <span className="req">★</span>
              </label>
              <input
                type="text"
                className="innovic-input"
                placeholder="Person / Dept / Machine"
                value={issuedTo}
                onChange={(e) => setIssuedTo(e.target.value)}
              />
            </div>

            <div className="form-grp">
              <label className="form-label">Reference Type</label>
              <select
                className="innovic-select"
                value={refType}
                onChange={(e) => setRefType(e.target.value as StoreIssueRefType)}
              >
                {STORE_ISSUE_REF_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-grp">
              <label className="form-label">Reference No.</label>
              <input
                type="text"
                className="innovic-input"
                placeholder="e.g. IN-JC-26-00001, IN-SO-00417"
                value={refNo}
                onChange={(e) => setRefNo(e.target.value)}
              />
            </div>

            <div className="form-grp">
              <label className="form-label">Purpose</label>
              <input
                type="text"
                className="innovic-input"
                placeholder="Manufacturing / Testing / Repair"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              />
            </div>

            <div className="form-grp form-full">
              <label className="form-label">Remarks</label>
              <input
                type="text"
                className="innovic-input"
                placeholder="Additional notes"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>

          {lastSaved && !err ? (
            <div className="text2" style={{ marginTop: 12, fontSize: 12 }}>
              ✓ Saved <span className="td-code">{lastSaved}</span> — enter the next issue.
            </div>
          ) : null}
          {err ? (
            <div
              style={{
                marginTop: 12,
                padding: 8,
                background: 'var(--red3)',
                color: 'var(--red2)',
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              {err}
            </div>
          ) : null}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {lastSaved ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={createMut.isPending}
            onClick={() => save(true)}
            title="Save, then start the next issue with the same Issued To and Reference"
          >
            Save &amp; New
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={createMut.isPending}
            onClick={() => save(false)}
          >
            {createMut.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : (
              'Save Issue'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
