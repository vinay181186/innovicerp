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
import { ToolIssueRegisterView } from '@/modules/tool-issues/components/tool-issue-register-view';
import { todayLocal } from '@/lib/date';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useItemsList } from '../../items/api';
import { useCreateStoreIssue, useNextStoreIssueCode, useStoreIssuesList } from '../api';

const PAGE_SIZE = 25;

export const storeIssuesListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'issue-register',
  component: StoreIssuesListPage,
});

function StoreIssuesListPage(): React.JSX.Element {
  const [tab, setTab] = useState<'items' | 'tools'>('items');
  const [search, setSearch] = useState('');
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
      <div className="empty-state" style={{ color: 'var(--amber)', padding: 40 }}>
        ⛔ This page is hidden for your access. Ask an admin if you need access to it.
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
            {t === 'items' ? '📋 Item Issues' : '🔧 Tool Issues'}
          </button>
        ))}
      </div>

      {tab === 'tools' ? (
        <ToolIssueRegisterView />
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 14,
            }}
          >
            <div className="section-hdr" style={{ marginBottom: 0 }}>
              📋 Item Issue Register
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                className="innovic-input"
                placeholder="🔍 Search issue, item, JC…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                style={{ minWidth: 220, fontSize: 13 }}
              />
              {perms.entry ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowModal(true)}
                >
                  <Plus size={14} /> New Issue
                </button>
              ) : null}
            </div>
          </div>

          <div className="panel">
            {isLoading ? (
              <div className="panel-body">
                <div className="text3" style={{ fontSize: 12 }}>
                  <Loader2 size={14} className="inline animate-spin" /> Loading…
                </div>
              </div>
            ) : isError ? (
              <div className="panel-body">
                <div className="empty-state" style={{ color: 'var(--red)' }}>
                  {error instanceof Error ? error.message : 'Failed to load issues'}
                </div>
              </div>
            ) : data ? (
              <div className="tbl-wrap">
                <table className="innovic-table">
                  <thead>
                    <tr>
                      <th>Issue No.</th>
                      <th>Date</th>
                      <th>Item Code</th>
                      <th>Item Name</th>
                      <th className="td-ctr">Qty</th>
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
                        <td>
                          <span className="td-code" style={{ color: 'var(--cyan)' }}>
                            {iss.code}
                          </span>
                        </td>
                        <td className="text2" style={{ fontSize: 11 }}>
                          {iss.issueDate}
                        </td>
                        <td>
                          <span className="td-code" style={{ color: 'var(--purple)' }}>
                            {iss.itemCode ?? iss.itemCodeText ?? '—'}
                          </span>
                        </td>
                        <td>{iss.itemName || '—'}</td>
                        <td className="td-ctr mono fw-700" style={{ fontSize: 14 }}>
                          {iss.qty}
                        </td>
                        <td>{iss.issuedTo || '—'}</td>
                        <td className="mono" style={{ fontSize: 11, color: 'var(--purple)' }}>
                          {`${iss.refType ?? ''} ${iss.refNo || '—'}`}
                        </td>
                        <td className="text3" style={{ fontSize: 11 }}>
                          {iss.purpose || '—'}
                        </td>
                        <td
                          className="text3"
                          style={{
                            fontSize: 11,
                            maxWidth: 100,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={iss.remarks ?? ''}
                        >
                          {iss.remarks || '—'}
                        </td>
                        <td>{iss.issuedByName || '—'}</td>
                      </tr>
                    ))}
                    {data.items.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="empty-state">
                          No issues recorded — click + New Issue
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

          {data ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 8,
                fontSize: 12,
                color: 'var(--text3)',
              }}
            >
              <span>
                {data.total === 0
                  ? 'No issues'
                  : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, data.total)} of ${data.total}`}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </button>
                <span style={{ fontFamily: 'var(--mono)', padding: '0 8px' }}>
                  {page} / {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}

          <div className="text3" style={{ fontSize: 11, marginTop: 6 }}>
            💡 Item Issue Register tracks material/consumables issued from Store. Stock is
            auto-deducted. For returnable tools, use the{' '}
            <button
              type="button"
              onClick={() => setTab('tools')}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                color: 'var(--cyan)',
                cursor: 'pointer',
                textDecoration: 'underline',
                font: 'inherit',
              }}
            >
              🔧 Tool Issues
            </button>{' '}
            tab.
          </div>

          {showModal && perms.entry ? <NewIssueModal onClose={() => setShowModal(false)} /> : null}
        </>
      )}
    </div>
  );
}

function NewIssueModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [date, setDate] = useState(todayLocal());
  const [itemId, setItemId] = useState<string | null>(null);
  const [qty, setQty] = useState('');
  const [issuedTo, setIssuedTo] = useState('');
  const [refType, setRefType] = useState<StoreIssueRefType>('Job Card');
  const [refNo, setRefNo] = useState('');
  const [purpose, setPurpose] = useState('');
  const [remarks, setRemarks] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const createMut = useCreateStoreIssue();
  const { data: next } = useNextStoreIssueCode();
  const { data: itemsData } = useItemsList({
    search: itemSearch.trim() || undefined,
    limit: 50,
    offset: 0,
  });

  const selectedItem = useMemo(
    () => itemsData?.items.find((i) => i.id === itemId) ?? null,
    [itemsData, itemId],
  );

  const onSave = (): void => {
    setErr(null);
    if (!itemId) {
      setErr('Select an item');
      return;
    }
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      setErr('Qty must be ≥ 1');
      return;
    }
    if (!issuedTo.trim()) {
      setErr('Enter who this is issued to');
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
      onSuccess: () => onClose(),
      onError: (e) => setErr(e instanceof Error ? e.message : 'Failed to create issue'),
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
          <span className="modal-title">📋 New Item Issue</span>
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
              <label className="form-label">Date</label>
              <input
                type="date"
                className="innovic-input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            <div className="form-grp form-full">
              <label className="form-label">Item ★ (type to search from Item Master)</label>
              <input
                type="text"
                className="innovic-input"
                placeholder="🔍 Type item code or name…"
                value={selectedItem ? `${selectedItem.code} — ${selectedItem.name}` : itemSearch}
                onChange={(e) => {
                  setItemId(null);
                  setItemSearch(e.target.value);
                }}
              />
              {!itemId && itemSearch && itemsData ? (
                <div
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    background: 'var(--bg2)',
                    marginTop: 4,
                    maxHeight: 180,
                    overflowY: 'auto',
                  }}
                >
                  {itemsData.items.slice(0, 20).map((it) => (
                    <div
                      key={it.id}
                      onClick={() => {
                        setItemId(it.id);
                        setItemSearch('');
                      }}
                      style={{
                        padding: '6px 10px',
                        cursor: 'pointer',
                        fontSize: 12,
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{it.code}</span> —{' '}
                      {it.name}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="form-grp">
              <label className="form-label">Qty to Issue ★</label>
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
              <label className="form-label">Issued To ★</label>
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
                placeholder="e.g. JC-00001, SO-001"
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

          {err ? (
            <div
              style={{
                marginTop: 12,
                padding: 8,
                background: 'rgba(239,68,68,0.08)',
                color: 'var(--red)',
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
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={createMut.isPending}
            onClick={onSave}
          >
            {createMut.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
