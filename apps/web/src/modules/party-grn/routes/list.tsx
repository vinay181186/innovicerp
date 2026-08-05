// Party Material GRN (Store slice 2) — client-supplied raw material received
// against a JW order. Multi-line per receipt.
// Mirrors legacy renderPartyGRN (HTML L24251) + addPartyGRN (L24298).

import {
  type CreatePartyGrnInput,
  type CreatePartyGrnLineInput,
  type JobWorkOrderLine,
  type PartyGrnListItem,
  type PartyMaterialListItem,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2, Plus, Trash2, XCircle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { todayLocal } from '@/lib/date';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useJobWorkOrder, useJobWorkOrdersList } from '../../job-work-orders/api';
import { usePartyMaterialsList } from '../../party-materials/api';
import {
  useCancelPartyGrn,
  useCreatePartyGrn,
  useNextPartyGrnCode,
  usePartyGrnList,
} from '../api';

const PAGE_SIZE = 50;

export const partyGrnListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'party-grn',
  component: PartyGrnListPage,
});

function PartyGrnListPage(): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [cancelRow, setCancelRow] = useState<PartyGrnListItem | null>(null);

  const { data, isLoading, isError, error } = usePartyGrnList({
    search: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));
  const summary = data?.summary ?? { totalGrns: 0, totalReceived: 0, today: 0 };

  return (
    <div>
      {/* Home for client-supplied (party) material receipts against a JW order. */}
      <div
        style={{
          background: '#FEF3C7',
          border: '2px solid #F59E0B',
          borderRadius: 8,
          padding: '12px 16px',
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 24 }}>📥</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, color: '#92400E', fontSize: 14, marginBottom: 2 }}>
            Record Party Material GRNs here
          </div>
          <div style={{ fontSize: 12, color: '#78350F' }}>
            This is the home for client-supplied (party) material. When a client sends raw
            material against a Job Work order, record its receipt right here — just click{' '}
            <b>+ New Party GRN</b>. Every party-material receipt is entered and tracked on this
            screen.
          </div>
        </div>
      </div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">📥 Party Material GRN</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Search JWSO, client, material…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            style={{ width: 260, fontSize: 12 }}
          />
          {canWrite ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowModal(true)}
            >
              <Plus size={14} /> New Party GRN
            </button>
          ) : null}
        </div>
      </div>

      <div
        className="stat-grid"
        style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 14 }}
      >
        <div className="stat-card cyan">
          <div className="stat-label">TOTAL GRNs</div>
          <div className="stat-val">{summary.totalGrns}</div>
        </div>
        <div className="stat-card green">
          <div className="stat-label">TOTAL RECEIVED</div>
          <div className="stat-val" style={{ color: 'var(--green)' }}>
            {summary.totalReceived}
          </div>
        </div>
        <div className="stat-card amber">
          <div className="stat-label">TODAY</div>
          <div className="stat-val" style={{ color: 'var(--amber)' }}>
            {summary.today}
          </div>
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
              {error instanceof Error ? error.message : 'Failed to load party GRNs'}
            </div>
          </div>
        ) : data ? (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>GRN No.</th>
                  <th>Date</th>
                  <th>Client</th>
                  <th>JWSO No.</th>
                  <th>Client PO</th>
                  <th>DC No.</th>
                  <th className="td-ctr">Lines</th>
                  <th className="td-ctr" style={{ color: 'var(--green)' }}>
                    Received Qty
                  </th>
                  <th>Remarks</th>
                  <th>Received By</th>
                  {canWrite ? <th className="td-ctr">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={canWrite ? 11 : 10} className="empty-state">
                      No party material GRNs — click + New Party GRN
                    </td>
                  </tr>
                ) : null}
                {data.items.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <span className="td-code" style={{ color: 'var(--cyan)' }}>
                        {g.code}
                      </span>
                    </td>
                    <td className="text2" style={{ fontSize: 11 }}>
                      {g.grnDate}
                    </td>
                    <td className="fw-700">{g.clientName ?? g.clientCodeText ?? '—'}</td>
                    <td
                      className="mono fw-700"
                      style={{ fontSize: 11, color: 'var(--purple)' }}
                    >
                      {g.jwCodeText ?? '—'}
                    </td>
                    <td className="mono text2" style={{ fontSize: 11 }}>
                      {g.clientPoNo ?? '—'}
                    </td>
                    <td className="mono text3" style={{ fontSize: 11 }}>
                      {g.dcNo ?? '—'}
                    </td>
                    <td className="td-ctr mono">{g.linesCount}</td>
                    <td
                      className="td-ctr mono fw-700"
                      style={{ fontSize: 14, color: 'var(--green)' }}
                    >
                      {g.totalReceivedQty}
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
                      title={g.remarks ?? ''}
                    >
                      {g.remarks ?? '—'}
                    </td>
                    <td>{g.receivedByText ?? '—'}</td>
                    {canWrite ? (
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
                          onClick={() => setCancelRow(g)}
                          title="Cancel this GRN and take the qty back off party stock"
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
              ? 'No GRNs'
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

      <div className="text3" style={{ fontSize: 11, marginTop: 6, padding: '0 4px' }}>
        💡 Party Material GRN records raw material received from clients for Job Work. Received qty
        is added to Party Material stock. Linked to JWSO No. / Client PO.
      </div>

      {showModal ? <NewPartyGrnModal onClose={() => setShowModal(false)} /> : null}
      {cancelRow ? (
        <CancelPartyGrnModal row={cancelRow} onClose={() => setCancelRow(null)} />
      ) : null}
    </div>
  );
}

// ─── Cancel Party GRN modal (ADR-102) ──────────────────────────────────────

function CancelPartyGrnModal({
  row,
  onClose,
}: {
  row: PartyGrnListItem;
  onClose: () => void;
}): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const cancelMut = useCancelPartyGrn();

  const onConfirm = (): void => {
    setErr(null);
    if (!reason.trim()) {
      setErr('Give a reason — it is stored on the cancelled GRN.');
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
          This takes <b style={{ color: 'var(--green)' }}>{row.totalReceivedQty}</b> back off party
          material stock for <b>{row.jwCodeText ?? 'this JWSO'}</b>, and lowers how much production
          that JWSO line is allowed to start. It cannot be undone.
          <br />
          If some of this material has already been issued to a Job Card, the cancel will be
          refused — reverse the issue first.
        </div>
        <Field label="Reason ★">
          <input
            type="text"
            className="innovic-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. entered twice by mistake"
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
              'Cancel GRN'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── New Party GRN modal ───────────────────────────────────────────────────

interface UiLine {
  partyMaterialId: string | null;
  receivedQty: string;
  jwLineNoText: string;
  remarks: string;
  /** Local search box value for the material picker (per-line). */
  materialSearch: string;
}

function NewPartyGrnModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [date, setDate] = useState(todayLocal());
  const [jwSearch, setJwSearch] = useState('');
  const [jwId, setJwId] = useState<string | null>(null);
  const [dcNo, setDcNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<UiLine[]>([
    { partyMaterialId: null, receivedQty: '', jwLineNoText: '', remarks: '', materialSearch: '' },
  ]);
  const [err, setErr] = useState<string | null>(null);

  const nextCodeQ = useNextPartyGrnCode();
  const jwQuery = useJobWorkOrdersList({
    search: jwSearch.trim() || undefined,
    status: 'open',
    limit: 50,
    offset: 0,
  });
  const jwData = jwQuery.data;
  // The JW list is one row per JWSO (#6); no dedupe needed.
  const jwHeaders = jwData?.items ?? [];
  const selectedJw = useMemo(
    () => jwHeaders.find((j) => j.jwId === jwId) ?? null,
    [jwHeaders, jwId],
  );
  // Bug 3.3: once a JWSO is picked, surface ITS line item codes so the user can
  // see/pick them in the JW Line box. Lines come from the JWSO detail (the
  // master list no longer carries per-line rows).
  const jwDetailQ = useJobWorkOrder(jwId ?? undefined);
  const jwLinesForSelected = jwDetailQ.data?.lines ?? [];

  // ADR-102: only the selected JWSO's client's materials. Party material is
  // customer-owned — showing every client's codes invited receiving one
  // client's material against another's order (the API refuses it now, but the
  // picker should not offer it in the first place). Disabled until a JWSO is
  // picked, so the client is always known.
  const { data: pmData } = usePartyMaterialsList(
    {
      search: undefined,
      clientId: selectedJw?.clientId ?? undefined,
      limit: 200,
      offset: 0,
    },
    { enabled: Boolean(selectedJw?.clientId) },
  );
  const pmAll = pmData?.items ?? [];

  const createMut = useCreatePartyGrn();

  const setLine = (idx: number, patch: Partial<UiLine>): void => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const addLine = (): void => {
    setLines((prev) => [
      ...prev,
      { partyMaterialId: null, receivedQty: '', jwLineNoText: '', remarks: '', materialSearch: '' },
    ]);
  };

  const removeLine = (idx: number): void => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const onSave = (): void => {
    setErr(null);
    if (!jwId) {
      setErr('Select a JWSO');
      return;
    }
    const validLines: CreatePartyGrnLineInput[] = [];
    for (const [i, l] of lines.entries()) {
      // Bug 3.4: a typed-but-not-clicked material left partyMaterialId null and
      // blocked save. Resolve the typed text to a material id by exact code/name
      // match (case-insensitive) before giving up.
      let pmId = l.partyMaterialId;
      if (!pmId) {
        const typed = l.materialSearch.trim().toLowerCase();
        const match = typed
          ? pmAll.find((p) => p.code.toLowerCase() === typed || p.name.toLowerCase() === typed)
          : undefined;
        if (match) pmId = match.id;
      }
      if (!pmId) {
        setErr(
          `Line ${i + 1}: pick a material from the list, or type an exact material code. Not listed? Add it in Party Material Master first.`,
        );
        return;
      }
      const q = Number(l.receivedQty);
      if (!Number.isFinite(q) || q <= 0) {
        setErr(`Line ${i + 1}: qty must be ≥ 1`);
        return;
      }
      // ADR-102: the JWSO line is mandatory — the order-qty cap and the
      // first-op material gate both key off it.
      const lnNo = l.jwLineNoText.trim();
      if (!lnNo) {
        setErr(`Line ${i + 1}: pick which JWSO line this material is for.`);
        return;
      }
      const jwLine = jwLinesForSelected.find((j) => String(j.lineNo) === lnNo);
      // ADR-102: refuse a material that is not that line's part.
      const pm = pmAll.find((p) => p.id === pmId);
      if (jwLine && pm && pm.itemId != null && jwLine.itemId != null && pm.itemId !== jwLine.itemId) {
        setErr(
          `Line ${i + 1}: ${pm.code} is "${pm.name}", but JWSO line ${lnNo} is "${jwLine.partName}". Pick the material for this part, or pick the line this material belongs to.`,
        );
        return;
      }
      const ln: CreatePartyGrnLineInput = {
        partyMaterialId: pmId,
        receivedQty: q,
        jwLineNoText: lnNo,
      };
      if (l.remarks.trim()) ln.remarks = l.remarks.trim();
      validLines.push(ln);
    }
    if (validLines.length === 0) {
      setErr('Add at least one line');
      return;
    }
    const input: CreatePartyGrnInput = {
      grnDate: date,
      jobWorkOrderId: jwId,
      lines: validLines,
    };
    if (dcNo.trim()) input.dcNo = dcNo.trim();
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
          width: 'min(1100px, 96vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          📥 New Party Material GRN
        </div>

        {/* ADR-102: the JWSO-line datalist is gone — the line box is a real
            <select> of jwLinesForSelected now, so free text is impossible. */}
        {/* Party materials for the line pickers. A native datalist (not a custom
            absolute dropdown) so it is never clipped by the modal / table
            overflow — the earlier custom dropdown was invisible for exactly that
            reason, leaving the material box unselectable. */}
        <datalist id="dlPGrnMaterial">
          {pmAll.map((p) => (
            <option key={p.id} value={p.code}>
              {p.name}
              {p.material ? ` · ${p.material}` : ''}
            </option>
          ))}
        </datalist>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="GRN No.">
            <input
              type="text"
              className="innovic-input"
              value={nextCodeQ.data?.code ?? ''}
              readOnly
              style={{
                background: 'var(--bg4)',
                fontWeight: 700,
                color: 'var(--cyan)',
              }}
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

          <div style={{ gridColumn: 'span 2' }}>
            <Field label="JWSO No. ★">
              <SearchableSelect
                id="pgrn-jwso"
                value={jwId}
                onChange={setJwId}
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

          <Field label="Client">
            <input
              type="text"
              className="innovic-input"
              value={selectedJw?.customerName ?? ''}
              readOnly
              style={{ background: 'var(--bg4)', color: 'var(--text3)' }}
            />
          </Field>
          <Field label="Client PO No.">
            <input
              type="text"
              className="innovic-input"
              value={selectedJw?.clientPoNo ?? ''}
              readOnly
              style={{ background: 'var(--bg4)', color: 'var(--text3)' }}
            />
          </Field>

          <Field label="DC / Challan No.">
            <input
              type="text"
              className="innovic-input"
              value={dcNo}
              onChange={(e) => setDcNo(e.target.value)}
              placeholder="Delivery challan no."
            />
          </Field>
          <Field label="Remarks">
            <input
              type="text"
              className="innovic-input"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Condition, lot info, etc."
            />
          </Field>
        </div>

        <div style={{ marginTop: 18 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 11,
              color: 'var(--amber)',
              fontFamily: 'var(--mono)',
              fontWeight: 700,
              letterSpacing: '.06em',
              marginBottom: 6,
            }}
          >
            <span>▸ INWARD LINE ITEMS</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={addLine}
            >
              + Add Line
            </button>
          </div>
          <div
            style={{
              border: '1px solid var(--border2)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden',
            }}
          >
            <table style={{ width: '100%' }}>
              <thead>
                <tr style={{ background: 'var(--bg4)' }}>
                  <th style={{ padding: 6, fontSize: 11 }}>#</th>
                  <th style={{ padding: 6, fontSize: 11, width: 80 }}>JWSO Line</th>
                  <th style={{ padding: 6, fontSize: 11, minWidth: 220 }}>
                    Material (Party Material Master) ★
                  </th>
                  <th style={{ padding: 6, fontSize: 11 }}>Material Name</th>
                  <th style={{ padding: 6, fontSize: 11, color: 'var(--green)', width: 100 }}>
                    Qty ★
                  </th>
                  <th style={{ padding: 6, fontSize: 11, width: 60 }}>UOM</th>
                  <th style={{ padding: 6, fontSize: 11 }}>Remarks</th>
                  <th style={{ padding: 6, fontSize: 11, width: 32 }}></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <LineRow
                    key={i}
                    idx={i}
                    line={l}
                    pmAll={pmAll}
                    jwLines={jwLinesForSelected}
                    onChange={(patch) => setLine(i, patch)}
                    onRemove={() => removeLine(i)}
                  />
                ))}
              </tbody>
            </table>
            {lines.length === 0 ? (
              <div className="empty-state" style={{ padding: 16, fontSize: 12 }}>
                No line items — click <strong>+ Add Line</strong>.
              </div>
            ) : null}
          </div>
          <div className="text3" style={{ fontSize: 10, marginTop: 4 }}>
            📌 Items must exist in Party Material Master first.
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
              'Save GRN'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function LineRow({
  idx,
  line,
  pmAll,
  jwLines,
  onChange,
  onRemove,
}: {
  idx: number;
  line: UiLine;
  pmAll: PartyMaterialListItem[];
  jwLines: JobWorkOrderLine[];
  onChange: (patch: Partial<UiLine>) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const selected = useMemo(
    () => pmAll.find((p) => p.id === line.partyMaterialId) ?? null,
    [pmAll, line.partyMaterialId],
  );
  const pickedLine = useMemo(
    () => jwLines.find((j) => String(j.lineNo) === line.jwLineNoText) ?? null,
    [jwLines, line.jwLineNoText],
  );
  // ADR-102: the material must BE the picked line's part. Mirrors the API
  // guard so the user sees it while typing, not after Save.
  const mismatch =
    selected != null &&
    pickedLine != null &&
    selected.itemId != null &&
    pickedLine.itemId != null &&
    selected.itemId !== pickedLine.itemId;
  const bg = idx % 2 === 0 ? 'var(--bg)' : 'var(--bg3)';

  return (
    <tr style={{ background: bg }}>
      <td
        className="td-ctr mono fw-700"
        style={{ padding: 6, fontSize: 11 }}
      >
        {idx + 1}
      </td>
      {/* ADR-102: a real <select> of THIS JWSO's lines, not free text. Every
          downstream check keys off this value; a typed line number that did not
          exist silently disabled the order-qty cap. */}
      <td style={{ padding: 6 }}>
        <select
          className="innovic-select"
          value={line.jwLineNoText}
          onChange={(e) => onChange({ jwLineNoText: e.target.value })}
          style={{
            width: '100%',
            fontSize: 11,
            ...(line.jwLineNoText ? {} : { border: '2px solid var(--amber)' }),
          }}
        >
          <option value="">{jwLines.length ? 'Select…' : 'Pick a JWSO first'}</option>
          {jwLines.map((j) => (
            <option key={j.id} value={String(j.lineNo)}>
              L{j.lineNo} · {j.itemCodeText ?? ''} · {j.partName}
            </option>
          ))}
        </select>
      </td>
      <td style={{ padding: 6 }}>
        <input
          type="text"
          className="innovic-input"
          list="dlPGrnMaterial"
          placeholder={pmAll.length ? '🔍 Pick material code…' : 'Pick a JWSO first'}
          disabled={pmAll.length === 0}
          value={selected ? selected.code : line.materialSearch}
          onChange={(e) => {
            const v = e.target.value;
            const match = pmAll.find((p) => p.code.toLowerCase() === v.trim().toLowerCase());
            onChange({ partyMaterialId: match ? match.id : null, materialSearch: v });
          }}
          style={{
            width: '100%',
            fontSize: 12,
            fontWeight: 600,
            color: mismatch ? 'var(--red)' : 'var(--purple)',
          }}
        />
      </td>
      {/* ADR-102: show the material's linked item code next to its name, and
          flag a part mismatch before the user hits Save. */}
      <td style={{ padding: 6, fontSize: 11, color: mismatch ? 'var(--red)' : 'var(--text2)' }}>
        {selected ? (
          <>
            {selected.name}
            {selected.itemCode ?? selected.itemCodeText ? (
              <span className="mono text3" style={{ fontSize: 10, marginLeft: 4 }}>
                ({selected.itemCode ?? selected.itemCodeText})
              </span>
            ) : null}
            {mismatch ? (
              <div style={{ fontSize: 10, fontWeight: 700 }}>
                ⚠ not L{line.jwLineNoText} — that line is {pickedLine?.partName}
              </div>
            ) : null}
          </>
        ) : (
          ''
        )}
      </td>
      <td style={{ padding: 6 }}>
        <input
          type="number"
          min={1}
          className="innovic-input"
          value={line.receivedQty}
          onChange={(e) => onChange({ receivedQty: e.target.value })}
          placeholder="0"
          style={{
            width: '100%',
            fontSize: 14,
            fontWeight: 700,
            textAlign: 'center',
            border: '2px solid var(--green)',
            borderRadius: 4,
          }}
        />
      </td>
      <td
        className="td-ctr"
        style={{ padding: 6, fontSize: 11, color: 'var(--text3)' }}
      >
        {selected?.uom ?? 'NOS'}
      </td>
      <td style={{ padding: 6 }}>
        <input
          type="text"
          className="innovic-input"
          placeholder="Remarks"
          value={line.remarks}
          onChange={(e) => onChange({ remarks: e.target.value })}
          style={{ width: '100%', fontSize: 11 }}
        />
      </td>
      <td style={{ padding: 6, textAlign: 'center' }}>
        <button
          type="button"
          className="btn btn-sm"
          style={{
            background: 'rgba(239,68,68,0.08)',
            color: 'var(--red)',
            border: '1px solid rgba(239,68,68,0.3)',
            padding: '2px 6px',
          }}
          onClick={onRemove}
          title="Remove"
        >
          <Trash2 size={12} />
        </button>
      </td>
    </tr>
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

