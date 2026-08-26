// Party Material Issue (ADR-079 — job-work cycle completion) — folded in as the
// "Issue" tab of the Party Material screen (formerly standalone
// /party-material-issues). Issues client-supplied ("party") material to a Job
// Card for in-house machining; debits the separate party stock, never own-stock
// store_transactions. Self-contained: its own hooks + inline modals.

import {
  type CreatePartyMaterialIssueInput,
  type PartyMaterialIssueListItem,
} from '@innovic/shared';
import { Loader2, Plus, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { todayLocal } from '@/lib/date';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useJobCardsList } from '@/modules/job-cards/api';
import { useJobWorkOrdersList } from '@/modules/job-work-orders/api';
import { usePartyMaterialsList } from '@/modules/party-materials/api';
import {
  useCancelPartyMaterialIssue,
  useCreatePartyMaterialIssue,
  usePartyMaterialIssuesList,
} from '../api';

export function PartyMaterialIssueView(): React.JSX.Element {
  // Tier-driven, per department (party_create sits in Store). This view renders
  // as the Issue tab of /party-grn, so it has to gate itself — the host screen
  // passes it no props. Cancel reverses an issued quantity, so it is the L5+
  // pair only L5/L6 hold: L3 has edit without approve, L4 approve without edit.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'party_create');
  const canIssue = perms.entry;
  const canCancel = perms.edit && perms.approve;
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [cancelRow, setCancelRow] = useState<PartyMaterialIssueListItem | null>(null);

  const { data, isLoading, isError, error } = usePartyMaterialIssuesList();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = data?.items ?? [];
    if (!q) return items;
    return items.filter(
      (it) =>
        it.code.toLowerCase().includes(q) ||
        (it.jwCodeText ?? '').toLowerCase().includes(q) ||
        (it.partyMaterialCodeText ?? '').toLowerCase().includes(q),
    );
  }, [data?.items, search]);

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
      <div className="mb-3 flex items-center justify-end gap-3">
        <input
          type="text"
          className="innovic-input"
          placeholder="🔍 Search Issue No., JWSO, material…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 260, fontSize: 12 }}
        />
        {canIssue ? (
          <button type="button" className="btn btn-primary" onClick={() => setShowModal(true)}>
            <Plus size={14} /> New Issue
          </button>
        ) : null}
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
              {error instanceof Error ? error.message : 'Failed to load party material issues'}
            </div>
          </div>
        ) : data ? (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Issue No.</th>
                  <th>Date</th>
                  <th>JWSO</th>
                  <th>Job Card</th>
                  <th>Material</th>
                  <th className="td-ctr" style={{ color: 'var(--green)' }}>
                    Qty
                  </th>
                  <th>Remarks</th>
                  {canCancel ? <th className="td-ctr">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={canCancel ? 8 : 7} className="empty-state">
                      No party material issues — click + New Issue
                    </td>
                  </tr>
                ) : null}
                {filtered.map((it) => (
                  <tr key={it.id}>
                    <td>
                      <span className="td-code" style={{ color: 'var(--cyan)' }}>
                        {it.code}
                      </span>
                    </td>
                    <td className="text2" style={{ fontSize: 11 }}>
                      {it.issueDate}
                    </td>
                    <td className="mono fw-700" style={{ fontSize: 11, color: 'var(--purple)' }}>
                      {it.jwCodeText ?? '—'}
                    </td>
                    <td className="mono text2" style={{ fontSize: 11 }}>
                      {it.jcCodeText ?? '—'}
                    </td>
                    <td className="fw-700">
                      <span style={{ color: 'var(--purple)' }}>
                        {it.partyMaterialCodeText ?? '—'}
                      </span>
                      {it.partyMaterialName ? (
                        <span className="text3" style={{ fontSize: 11 }}>
                          {' '}
                          — {it.partyMaterialName}
                        </span>
                      ) : null}
                    </td>
                    <td
                      className="td-ctr mono fw-700"
                      style={{ fontSize: 14, color: 'var(--green)' }}
                    >
                      {it.qty}
                    </td>
                    <td
                      className="text3"
                      style={{
                        fontSize: 11,
                        maxWidth: 140,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={it.remarks ?? ''}
                    >
                      {it.remarks ?? '—'}
                    </td>
                    {canCancel ? (
                      <td className="td-ctr">
                        <button
                          type="button"
                          className="btn btn-sm"
                          style={{
                            background: 'rgba(239,68,68,0.08)',
                            color: 'var(--red)',
                            border: '1px solid rgba(239,68,68,0.3)',
                            padding: '2px 8px',
                          }}
                          onClick={() => setCancelRow(it)}
                          title="Cancel this issue and put the qty back on party stock"
                        >
                          <XCircle size={12} /> Cancel
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="text3" style={{ fontSize: 11, marginTop: 6, padding: '0 4px' }}>
        💡 Party Material Issue debits client-supplied (party) stock when it is issued to a Job Card
        for in-house machining. Linked to JWSO No. / Job Card.
      </div>

      {showModal ? <NewPartyMaterialIssueModal onClose={() => setShowModal(false)} /> : null}
      {cancelRow ? <CancelIssueModal row={cancelRow} onClose={() => setCancelRow(null)} /> : null}
    </div>
  );
}

function CancelIssueModal({
  row,
  onClose,
}: {
  row: PartyMaterialIssueListItem;
  onClose: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const cancelMut = useCancelPartyMaterialIssue();

  const onConfirm = (): void => {
    setErr(null);
    if (!reason.trim()) {
      setErr('Give a reason — it is stored on the cancelled issue.');
      return;
    }
    cancelMut.mutate(
      { id: row.id, reason: reason.trim() },
      {
        onSuccess: () => onClose(),
        onError: (e) => setErr(e instanceof Error ? e.message : 'Failed to cancel'),
      },
    );
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
          width: 'min(520px, 94vw)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 12 }}>
          ⚠ Cancel {row.code}
        </div>
        <div className="text2" style={{ fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
          This returns <b style={{ color: 'var(--green)' }}>{row.qty}</b> of{' '}
          <b>{row.partyMaterialCodeText ?? 'the material'}</b> to party stock and lowers what{' '}
          <b>{row.jcCodeText ?? 'the job card'}</b> is allowed to produce.
          <br />
          If those pieces have already been machined the cancel will be refused — that material is
          used, so record a scrap/adjustment instead.
        </div>
        <Field label="Reason ★">
          <input
            type="text"
            className="innovic-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. wrong qty entered"
            autoFocus
          />
        </Field>
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Keep it
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={cancelMut.isPending}
            onClick={onConfirm}
          >
            {cancelMut.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Cancelling…
              </>
            ) : (
              'Cancel Issue'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewPartyMaterialIssueModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [issueDate, setIssueDate] = useState(todayLocal());
  const [jwSearch, setJwSearch] = useState('');
  const [jobWorkOrderId, setJobWorkOrderId] = useState<string | null>(null);
  const [jcSearch, setJcSearch] = useState('');
  const [jobCardId, setJobCardId] = useState<string | null>(null);
  const [pmSearch, setPmSearch] = useState('');
  const [partyMaterialId, setPartyMaterialId] = useState<string | null>(null);
  const [qty, setQty] = useState('');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const jwQuery = useJobWorkOrdersList({
    search: jwSearch.trim() || undefined,
    status: 'open',
    limit: 50,
    offset: 0,
  });
  const jwHeaders = jwQuery.data?.items ?? [];

  const jcQuery = useJobCardsList({ search: jcSearch.trim() || undefined, limit: 50, offset: 0 });
  const jcItems = jcQuery.data?.items ?? [];

  const { data: pmData, isFetching: pmFetching } = usePartyMaterialsList({
    search: pmSearch.trim() || undefined,
    limit: 200,
    offset: 0,
  });
  const pmAll = pmData?.items ?? [];
  const selectedPm = useMemo(
    () => pmAll.find((p) => p.id === partyMaterialId) ?? null,
    [pmAll, partyMaterialId],
  );

  const createMut = useCreatePartyMaterialIssue();

  const onSave = (): void => {
    setErr(null);
    if (!jobWorkOrderId) {
      setErr('Select a JWSO');
      return;
    }
    if (!jobCardId) {
      setErr('Select the Job Card this material is for — work cannot start without it.');
      return;
    }
    if (!partyMaterialId) {
      setErr('Select a party material');
      return;
    }
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      setErr('Qty must be ≥ 1');
      return;
    }
    const input: CreatePartyMaterialIssueInput = {
      issueDate,
      jobWorkOrderId,
      jobCardId,
      partyMaterialId,
      qty: q,
    };
    if (remarks.trim()) input.remarks = remarks.trim();

    createMut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) => setErr(e instanceof Error ? e.message : 'Failed to create'),
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
          width: 'min(680px, 96vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          📤 New Party Material Issue
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Issue Date">
            <input
              type="date"
              className="innovic-input"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </Field>
          <Field label="Qty ★">
            <input
              type="number"
              min={1}
              className="innovic-input"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              style={{
                fontSize: 14,
                fontWeight: 700,
                border: '2px solid var(--green)',
                borderRadius: 4,
              }}
            />
          </Field>

          <div style={{ gridColumn: 'span 2' }}>
            <Field label="JWSO No. ★">
              <SearchableSelect
                id="pmi-jwso"
                value={jobWorkOrderId}
                onChange={setJobWorkOrderId}
                onSearch={setJwSearch}
                loading={jwQuery.isFetching}
                placeholder="🔍 Select JWSO — type number or customer…"
                options={jwHeaders.map((j) => ({
                  id: j.jwId,
                  code: j.code,
                  name: j.customerName ?? '',
                }))}
              />
            </Field>
          </div>

          <div style={{ gridColumn: 'span 2' }}>
            <Field label="Job Card ★">
              <SearchableSelect
                id="pmi-jc"
                value={jobCardId}
                onChange={setJobCardId}
                onSearch={setJcSearch}
                loading={jcQuery.isFetching}
                placeholder="🔍 Select Job Card — type number…"
                options={jcItems.map((jc) => ({ id: jc.id, code: jc.code, name: jc.itemName }))}
              />
            </Field>
          </div>

          <div style={{ gridColumn: 'span 2' }}>
            <Field label="Party Material ★">
              <SearchableSelect
                id="pmi-material"
                value={partyMaterialId}
                onChange={setPartyMaterialId}
                onSearch={setPmSearch}
                loading={pmFetching}
                placeholder="🔍 Select party material — type code or name…"
                options={pmAll.map((p) => ({
                  id: p.id,
                  code: p.code,
                  name: `${p.name} · stock ${p.stockQty}`,
                }))}
              />
            </Field>
            {selectedPm ? (
              <div className="text3" style={{ fontSize: 11, marginTop: 4 }}>
                Available party stock:{' '}
                <span style={{ color: 'var(--green)', fontWeight: 700 }}>
                  {selectedPm.stockQty}
                </span>{' '}
                {selectedPm.uom}
              </div>
            ) : null}
          </div>

          <div style={{ gridColumn: 'span 2' }}>
            <Field label="Remarks">
              <input
                type="text"
                className="innovic-input"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Lot info, purpose, etc."
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

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
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
