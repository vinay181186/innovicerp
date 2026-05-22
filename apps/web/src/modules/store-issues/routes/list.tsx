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
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useItemsList } from '../../items/api';
import { useCreateStoreIssue, useStoreIssuesList } from '../api';

const PAGE_SIZE = 25;

export const storeIssuesListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'issue-register',
  component: StoreIssuesListPage,
});

function StoreIssuesListPage(): React.JSX.Element {
  const { data: me } = useSession();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const canWrite = me?.role === 'admin' || me?.role === 'manager';

  const { data, isLoading, isError, error } = useStoreIssuesList({
    search: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">📋 Item Issue Register</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Search issue, item, JC…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            style={{ width: 240, fontSize: 12 }}
          />
          {canWrite ? (
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
        ) : data && data.items.length === 0 ? (
          <div className="panel-body">
            <div className="empty-state">
              <div className="empty-icon">📋</div>
              No issues recorded — click <strong>+ New Issue</strong>.
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
                    <td>{iss.itemName}</td>
                    <td className="td-ctr mono fw-700" style={{ fontSize: 14 }}>
                      {iss.qty}
                    </td>
                    <td>{iss.issuedTo}</td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--purple)' }}>
                      {iss.refType ? `${iss.refType} ${iss.refNo ?? ''}`.trim() : iss.refNo ?? '—'}
                    </td>
                    <td className="text3" style={{ fontSize: 11 }}>
                      {iss.purpose ?? '—'}
                    </td>
                    <td
                      className="text3"
                      style={{
                        fontSize: 11,
                        maxWidth: 120,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={iss.remarks ?? ''}
                    >
                      {iss.remarks ?? '—'}
                    </td>
                    <td className="text3" style={{ fontSize: 11 }}>
                      {iss.issuedByName ?? '—'}
                    </td>
                  </tr>
                ))}
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

      <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
        💡 Item Issue Register tracks material/consumables issued from Store. Stock is auto-deducted.
        For returnable tools, use Tool Issue Register (coming soon).
      </div>

      {showModal ? <NewIssueModal onClose={() => setShowModal(false)} /> : null}
    </div>
  );
}

function NewIssueModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
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
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          width: 'min(560px, 95vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          📋 New Item Issue
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Date">
            <input
              type="date"
              className="innovic-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </Field>

          <Field label="Qty to Issue ★">
            <input
              type="number"
              min={1}
              className="innovic-input"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              style={{ fontSize: 16, fontWeight: 700 }}
            />
          </Field>

          <div style={{ gridColumn: 'span 2' }}>
            <Field label="Item ★ (type to search Item Master)">
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
            </Field>
          </div>

          <div style={{ gridColumn: 'span 2' }}>
            <Field label="Issued To ★">
              <input
                type="text"
                className="innovic-input"
                placeholder="Person / Dept / Machine"
                value={issuedTo}
                onChange={(e) => setIssuedTo(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Reference Type">
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
          </Field>

          <Field label="Reference No.">
            <input
              type="text"
              className="innovic-input"
              placeholder="e.g. JC-00001, SO-001"
              value={refNo}
              onChange={(e) => setRefNo(e.target.value)}
            />
          </Field>

          <div style={{ gridColumn: 'span 2' }}>
            <Field label="Purpose">
              <input
                type="text"
                className="innovic-input"
                placeholder="Manufacturing / Testing / Repair"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              />
            </Field>
          </div>

          <div style={{ gridColumn: 'span 2' }}>
            <Field label="Remarks">
              <input
                type="text"
                className="innovic-input"
                placeholder="Additional notes"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </Field>
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

        <div
          style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}
        >
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
              'Save Issue'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div
        className="text3"
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
