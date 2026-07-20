// Tool Issue Register (PL-TI-1) — returnable items register.
// Mirrors legacy renderToolIssue (HTML L23965) + addToolIssue (L24038) +
// _toolReturn (L24080).

import {
  type CreateToolIssueInput,
  STORE_ISSUE_REF_TYPES,
  type StoreIssueRefType,
  type RecordToolReturnInput,
  type ToolIssueListItem,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useItemsList } from '../../items/api';
import {
  useCreateToolIssue,
  useNextToolIssueCode,
  useRecordToolReturn,
  useToolIssuesList,
} from '../api';

type FilterKey = 'all' | 'out' | 'overdue' | 'returned';
const PAGE_SIZE = 25;

export const toolIssuesListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'tool-issues',
  component: ToolIssuesListPage,
});

function ToolIssuesListPage(): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showNew, setShowNew] = useState(false);
  const [returnTarget, setReturnTarget] = useState<ToolIssueListItem | null>(null);

  const { data, isLoading, isError, error } = useToolIssuesList({
    filter,
    search: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <div>
      {/* Legacy renders the stat cards ABOVE the header row — renderToolIssue L24018. */}
      {data?.summary ? (
        <KpiStrip
          summary={data.summary}
          filter={filter}
          setFilter={(k) => {
            setFilter(k);
            setPage(1);
          }}
        />
      ) : null}

      <div
        className="mb-3 flex items-center justify-between gap-3"
        style={{ flexWrap: 'wrap' }}
      >
        <div className="section-hdr m-0">🔧 Tool Issue Register (Returnable)</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Search..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            style={{ minWidth: 160, fontSize: 12 }}
          />
          <select
            className="innovic-select"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as FilterKey);
              setPage(1);
            }}
          >
            <option value="all">All</option>
            <option value="out">Currently Out</option>
            <option value="overdue">Overdue</option>
            <option value="returned">Returned</option>
          </select>
          {canWrite ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowNew(true)}
            >
              + Issue Tool
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
              {error instanceof Error ? error.message : 'Failed to load tool issues'}
            </div>
          </div>
        ) : data ? (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Issue No.</th>
                  <th>Date</th>
                  <th>Item</th>
                  <th className="td-ctr">Qty</th>
                  <th>Issued To</th>
                  <th>Ref</th>
                  <th>Exp Return</th>
                  <th>Status</th>
                  <th className="td-ctr" style={{ color: 'var(--green)' }}>
                    Good
                  </th>
                  <th className="td-ctr" style={{ color: 'var(--red)' }}>
                    Dmg
                  </th>
                  <th className="td-ctr" style={{ color: 'var(--amber)' }}>
                    Used
                  </th>
                  <th className="td-ctr">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="empty-state">
                      No tool issues — click + Issue Tool
                    </td>
                  </tr>
                ) : null}
                {data.items.map((ti) => (
                  <tr
                    key={ti.id}
                    style={{
                      background: ti.isOverdue ? 'rgba(239,68,68,0.03)' : 'var(--bg)',
                    }}
                  >
                    <td>
                      <span className="td-code" style={{ color: 'var(--cyan)' }}>
                        {ti.code}
                      </span>
                    </td>
                    <td className="text2" style={{ fontSize: 11 }}>
                      {ti.issueDate}
                    </td>
                    <td>
                      <span
                        style={{ color: 'var(--purple)', fontWeight: 600, fontSize: 11 }}
                      >
                        {ti.itemCode ?? ti.itemCodeText ?? '—'}
                      </span>
                      <br />
                      <span style={{ fontSize: 11 }}>{ti.itemName}</span>
                    </td>
                    <td className="td-ctr mono fw-700" style={{ fontSize: 14 }}>
                      {ti.qty}
                    </td>
                    <td style={{ fontSize: 12 }}>{ti.issuedTo}</td>
                    <td className="mono" style={{ fontSize: 11, color: 'var(--purple)' }}>
                      {ti.refNo ?? '—'}
                    </td>
                    <td className="text2" style={{ fontSize: 11 }}>
                      {ti.expectedReturnDate ?? '—'}
                    </td>
                    <td>
                      <StatusBadge issue={ti} />
                    </td>
                    <td
                      className="td-ctr mono"
                      style={{
                        color: ti.returnGoodQty > 0 ? 'var(--green)' : 'var(--text3)',
                      }}
                    >
                      {ti.returnGoodQty}
                    </td>
                    <td
                      className="td-ctr mono"
                      style={{
                        color: ti.returnDamagedQty > 0 ? 'var(--red)' : 'var(--text3)',
                      }}
                    >
                      {ti.returnDamagedQty}
                    </td>
                    <td
                      className="td-ctr mono"
                      style={{
                        color: ti.returnConsumedQty > 0 ? 'var(--amber)' : 'var(--text3)',
                      }}
                    >
                      {ti.returnConsumedQty}
                    </td>
                    <td className="td-ctr">
                      {ti.returnStatus !== 'returned' && canWrite ? (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setReturnTarget(ti)}
                          style={{
                            background: 'rgba(20,184,166,0.08)',
                            color: '#14b8a6',
                            border: '1px solid rgba(20,184,166,0.3)',
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          ↩ Return
                        </button>
                      ) : null}
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
              ? 'No tool issues'
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
        🔧 Tool Issue Register tracks returnable items (tools, inserts, spanners, fixtures).
        Return button records Good/Damaged/Consumed breakdown. Good qty added back to stock.
      </div>

      {showNew ? <NewToolIssueModal onClose={() => setShowNew(false)} /> : null}
      {returnTarget ? (
        <ReturnModal issue={returnTarget} onClose={() => setReturnTarget(null)} />
      ) : null}
    </div>
  );
}

function StatusBadge({ issue }: { issue: ToolIssueListItem }): React.JSX.Element {
  if (issue.returnStatus === 'returned') {
    return (
      <span
        style={{
          background: 'rgba(34,197,94,0.12)',
          color: 'var(--green)',
          padding: '2px 8px',
          borderRadius: 10,
          fontSize: 10,
          fontWeight: 700,
        }}
      >
        Returned ✓
      </span>
    );
  }
  if (issue.returnStatus === 'partial') {
    const out =
      issue.qty - (issue.returnGoodQty + issue.returnDamagedQty + issue.returnConsumedQty);
    return (
      <span
        style={{
          background: 'rgba(34,211,238,0.12)',
          color: 'var(--cyan)',
          padding: '2px 8px',
          borderRadius: 10,
          fontSize: 10,
          fontWeight: 700,
        }}
      >
        Partial ({out} out)
      </span>
    );
  }
  if (issue.isOverdue) {
    return (
      <span
        style={{
          background: 'rgba(239,68,68,0.12)',
          color: 'var(--red)',
          padding: '2px 8px',
          borderRadius: 10,
          fontSize: 10,
          fontWeight: 700,
        }}
      >
        Overdue
      </span>
    );
  }
  return (
    <span
      style={{
        background: 'rgba(245,158,11,0.12)',
        color: 'var(--amber)',
        padding: '2px 8px',
        borderRadius: 10,
        fontSize: 10,
        fontWeight: 700,
      }}
    >
      Issued
    </span>
  );
}

function KpiStrip({
  summary,
  filter,
  setFilter,
}: {
  summary: { total: number; out: number; returned: number; overdue: number };
  filter: FilterKey;
  setFilter: (k: FilterKey) => void;
}): React.JSX.Element {
  const tiles: Array<{ key: FilterKey; label: string; value: number; color: string }> = [
    { key: 'all', label: 'Total', value: summary.total, color: 'var(--blue)' },
    { key: 'out', label: 'Currently Out', value: summary.out, color: 'var(--red)' },
    { key: 'returned', label: 'Returned', value: summary.returned, color: 'var(--green)' },
  ];
  // Legacy only emits the Overdue card when the count is non-zero (L24016).
  if (summary.overdue > 0) {
    tiles.push({ key: 'overdue', label: 'Overdue', value: summary.overdue, color: 'var(--red)' });
  }
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 10,
        marginBottom: 16,
      }}
    >
      {tiles.map((t) => (
        <div
          key={t.key}
          onClick={() => setFilter(t.key === filter && t.key !== 'all' ? 'all' : t.key)}
          style={{
            cursor: 'pointer',
            textAlign: 'center',
            padding: 12,
            borderRadius: 10,
            background: t.key === 'overdue' ? 'rgba(239,68,68,0.06)' : 'var(--bg2)',
            border:
              t.key === 'overdue' ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: 10, color: t.key === 'overdue' ? 'var(--red)' : 'var(--text3)' }}>
            {t.label}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: t.color }}>{t.value}</div>
        </div>
      ))}
    </div>
  );
}

function NewToolIssueModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [expRet, setExpRet] = useState('');
  const [itemId, setItemId] = useState<string | null>(null);
  const [itemSearch, setItemSearch] = useState('');
  const [qty, setQty] = useState('');
  const [issuedTo, setIssuedTo] = useState('');
  const [refType, setRefType] = useState<StoreIssueRefType>('Job Card');
  const [refNo, setRefNo] = useState('');
  const [purpose, setPurpose] = useState('');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const createMut = useCreateToolIssue();
  const { data: next } = useNextToolIssueCode();
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
    if (!expRet) {
      setErr('Expected return date is required');
      return;
    }
    const input: CreateToolIssueInput = {
      issueDate: date,
      expectedReturnDate: expRet,
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
      onError: (e) => setErr(e instanceof Error ? e.message : 'Failed to issue tool'),
    });
  };

  return (
    <ModalShell
      title="🔧 Issue Tool"
      onClose={onClose}
      footer={<ModalFooter onClose={onClose} onSave={onSave} saving={createMut.isPending} />}
    >
      <div className="form-grid">
        <Field label="Issue No.">
          <input
            type="text"
            className="innovic-input"
            value={next?.code ?? '(auto on save)'}
            readOnly
          />
        </Field>
        <Field label="Date">
          <input
            type="date"
            className="innovic-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label="Tool / Item ★ (type to search)" full>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Type item code or name..."
            value={selectedItem ? `${selectedItem.code} — ${selectedItem.name}` : itemSearch}
            onChange={(e) => {
              setItemId(null);
              setItemSearch(e.target.value);
            }}
            style={{ width: '100%', fontSize: 13, fontWeight: 600 }}
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
          {selectedItem ? (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
              <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{selectedItem.code}</span> —{' '}
              {selectedItem.name} | {selectedItem.uom}
            </div>
          ) : null}
        </Field>
        <Field label="Qty to Issue ★">
          <input
            type="number"
            min={1}
            className="innovic-input"
            placeholder="0"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            style={{ fontSize: 16, fontWeight: 700 }}
          />
        </Field>
        <Field label="Issued To ★">
          <input
            type="text"
            className="innovic-input"
            placeholder="Person / Dept / Machine"
            value={issuedTo}
            onChange={(e) => setIssuedTo(e.target.value)}
          />
        </Field>
        <Field label="Expected Return Date ★">
          <input
            type="date"
            className="innovic-input"
            value={expRet}
            onChange={(e) => setExpRet(e.target.value)}
          />
        </Field>
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
            placeholder="e.g. JC-00001"
            value={refNo}
            onChange={(e) => setRefNo(e.target.value)}
          />
        </Field>
        <Field label="Purpose">
          <input
            type="text"
            className="innovic-input"
            placeholder="CNC Turning / Grinding / Assembly"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
        </Field>
        <Field label="Remarks" full>
          <input
            type="text"
            className="innovic-input"
            placeholder="Additional notes"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </Field>
      </div>
      {err ? <ErrorBanner msg={err} /> : null}
    </ModalShell>
  );
}

function ReturnModal({
  issue,
  onClose,
}: {
  issue: ToolIssueListItem;
  onClose: () => void;
}): React.JSX.Element {
  const alreadyTotal =
    issue.returnGoodQty + issue.returnDamagedQty + issue.returnConsumedQty;
  const remaining = issue.qty - alreadyTotal;

  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [returnedBy, setReturnedBy] = useState(issue.issuedTo);
  const [good, setGood] = useState('0');
  const [damaged, setDamaged] = useState('0');
  const [consumed, setConsumed] = useState('0');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const mut = useRecordToolReturn(issue.id);

  const onSave = (): void => {
    setErr(null);
    const g = Number(good) || 0;
    const d = Number(damaged) || 0;
    const c = Number(consumed) || 0;
    if (g === 0 && d === 0 && c === 0) {
      setErr('Enter at least one return qty');
      return;
    }
    if (g + d + c > remaining) {
      setErr(
        `Return total (${g + d + c}) exceeds remaining (${remaining}). Issued ${issue.qty}, already returned ${alreadyTotal}.`,
      );
      return;
    }
    const input: RecordToolReturnInput = {
      returnDate,
      goodQty: g,
      damagedQty: d,
      consumedQty: c,
    };
    if (returnedBy.trim()) input.returnedBy = returnedBy.trim();
    if (remarks.trim()) input.remarks = remarks.trim();
    mut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) => setErr(e instanceof Error ? e.message : 'Return failed'),
    });
  };

  return (
    <ModalShell
      title={`↩ Return — ${issue.code}`}
      onClose={onClose}
      footer={<ModalFooter onClose={onClose} onSave={onSave} saving={mut.isPending} />}
    >
      <div
        style={{
          background: 'var(--bg3)',
          padding: '10px 14px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          marginBottom: 14,
          fontSize: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <span className="text3">Item:</span>{' '}
            <b style={{ color: 'var(--purple)' }}>{issue.itemCode ?? issue.itemCodeText ?? '—'}</b>{' '}
            {issue.itemName}
          </div>
          <div>
            <span className="text3">Issued:</span> <b>{issue.qty}</b>
          </div>
          <div>
            <span className="text3">To:</span> {issue.issuedTo}
          </div>
          <div>
            <span className="text3">Date:</span> {issue.issueDate}
          </div>
        </div>
        {alreadyTotal > 0 ? (
          <div className="text3" style={{ marginTop: 6, fontSize: 11 }}>
            Already returned: Good {issue.returnGoodQty} | Damaged {issue.returnDamagedQty} |
            Consumed {issue.returnConsumedQty} = {alreadyTotal} |{' '}
            <b style={{ color: 'var(--red)' }}>Remaining: {remaining}</b>
          </div>
        ) : null}
      </div>

      <div className="form-grid">
        <Field label="Return Date">
          <input
            type="date"
            className="innovic-input"
            value={returnDate}
            onChange={(e) => setReturnDate(e.target.value)}
          />
        </Field>
        <Field label="Returned By">
          <input
            type="text"
            className="innovic-input"
            value={returnedBy}
            onChange={(e) => setReturnedBy(e.target.value)}
          />
        </Field>
      </div>

      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 14,
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
          Return breakdown (max {remaining})
        </div>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <Field label="Returned Good (stock +)" labelColor="var(--green)">
            <input
              type="number"
              min={0}
              max={remaining}
              className="innovic-input"
              value={good}
              onChange={(e) => setGood(e.target.value)}
              style={{
                fontSize: 16,
                fontWeight: 700,
                textAlign: 'center',
                color: 'var(--green)',
                border: '2px solid rgba(34,197,94,0.4)',
              }}
            />
          </Field>
          <Field label="Damaged" labelColor="var(--red)">
            <input
              type="number"
              min={0}
              max={remaining}
              className="innovic-input"
              value={damaged}
              onChange={(e) => setDamaged(e.target.value)}
              style={{
                fontSize: 16,
                fontWeight: 700,
                textAlign: 'center',
                color: 'var(--red)',
                border: '2px solid rgba(239,68,68,0.4)',
              }}
            />
          </Field>
          <Field label="Consumed / Used Up" labelColor="var(--amber)">
            <input
              type="number"
              min={0}
              max={remaining}
              className="innovic-input"
              value={consumed}
              onChange={(e) => setConsumed(e.target.value)}
              style={{
                fontSize: 16,
                fontWeight: 700,
                textAlign: 'center',
                color: 'var(--amber)',
                border: '2px solid rgba(245,158,11,0.4)',
              }}
            />
          </Field>
        </div>
      </div>

      <Field label="Remarks">
        <input
          type="text"
          className="innovic-input"
          placeholder="Condition notes..."
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
        />
      </Field>

      {err ? <ErrorBanner msg={err} /> : null}
    </ModalShell>
  );
}

// ─── Shared modal helpers ─────────────────────────────────────────────────

// Mirrors legacy showModal (L28015-31): .overlay > .modal > .modal-hdr / .modal-body /
// .modal-footer. showModal takes exactly three args, so the footer is always Cancel / Save.
function ModalShell({
  title,
  onClose,
  footer,
  children,
}: {
  title: string;
  onClose: () => void;
  footer: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-hdr">
          <span className="modal-title">{title}</span>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer}
      </div>
    </div>
  );
}

function Field({
  label,
  labelColor,
  full,
  children,
}: {
  label: string;
  labelColor?: string;
  full?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={full ? 'form-grp form-full' : 'form-grp'}>
      <label className="form-label" style={labelColor ? { color: labelColor } : undefined}>
        {label}
      </label>
      {children}
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string }): React.JSX.Element {
  return (
    <div
      style={{
        marginTop: 12,
        padding: 8,
        background: 'rgba(239,68,68,0.08)',
        color: 'var(--red)',
        fontSize: 12,
        borderRadius: 4,
      }}
    >
      {msg}
    </div>
  );
}

// showModal hard-codes Cancel / Save (L28026-27). _toolReturn passes a 4th 'Save Return'
// arg (L24125) but showModal takes only three, so that label is dead in legacy.
function ModalFooter({
  onClose,
  onSave,
  saving,
}: {
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}): React.JSX.Element {
  return (
    <div className="modal-footer">
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
      <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving}>
        {saving ? (
          <>
            <Loader2 size={14} className="inline animate-spin" /> Saving…
          </>
        ) : (
          'Save'
        )}
      </button>
    </div>
  );
}
