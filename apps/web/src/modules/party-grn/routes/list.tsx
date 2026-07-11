// Party Material GRN (Store slice 2) — client-supplied raw material received
// against a JW order. Multi-line per receipt.
// Mirrors legacy renderPartyGRN (HTML L24251) + addPartyGRN (L24298).

import {
  type CreatePartyGrnInput,
  type CreatePartyGrnLineInput,
  type PartyMaterialListItem,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useJobWorkOrder, useJobWorkOrdersList } from '../../job-work-orders/api';
import { usePartyMaterialsList } from '../../party-materials/api';
import { useCreatePartyGrn, useNextPartyGrnCode, usePartyGrnList } from '../api';

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
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 10,
          marginBottom: 14,
        }}
      >
        <KpiTile label="Total GRNs" value={summary.totalGrns} color="var(--cyan)" />
        <KpiTile label="Total Received" value={summary.totalReceived} color="var(--green)" />
        <KpiTile label="Today" value={summary.today} color="var(--amber)" />
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
        ) : data && data.items.length === 0 ? (
          <div className="panel-body">
            <div className="empty-state">
              <div className="empty-icon">📥</div>
              No party material GRNs — click <strong>+ New Party GRN</strong>.
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
                </tr>
              </thead>
              <tbody>
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
                        maxWidth: 120,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={g.remarks ?? ''}
                    >
                      {g.remarks ?? '—'}
                    </td>
                    <td className="text3" style={{ fontSize: 11 }}>
                      {g.receivedByText ?? '—'}
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

      <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
        💡 Party Material GRN records raw material received from clients for Job Work. Received qty
        is added to Party Material stock. Linked to JWSO No. / Client PO.
      </div>

      {showModal ? <NewPartyGrnModal onClose={() => setShowModal(false)} /> : null}
    </div>
  );
}

function KpiTile({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}): React.JSX.Element {
  return (
    <div
      style={{
        padding: 14,
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        borderTop: `3px solid ${color}`,
        borderRadius: 6,
        textAlign: 'center',
      }}
    >
      <div
        className="text3"
        style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}
      >
        {label}
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color }}>
        {value}
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
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
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

  const { data: pmData } = usePartyMaterialsList({
    search: undefined,
    limit: 200,
    offset: 0,
  });
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
      const ln: CreatePartyGrnLineInput = {
        partyMaterialId: pmId,
        receivedQty: q,
      };
      if (l.jwLineNoText.trim()) ln.jwLineNoText = l.jwLineNoText.trim();
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

        {/* JW line codes for the selected JWSO (bug 3.3) — feeds the JW Line box. */}
        <datalist id="dlPGrnJwLine">
          {jwLinesForSelected.map((j) => (
            <option key={j.id} value={String(j.lineNo)}>
              L{j.lineNo} · {j.itemCodeText ?? ''} · {j.partName}
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
              border: '1px solid var(--border)',
              borderRadius: 6,
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
  onChange,
  onRemove,
}: {
  idx: number;
  line: UiLine;
  pmAll: PartyMaterialListItem[];
  onChange: (patch: Partial<UiLine>) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const selected = useMemo(
    () => pmAll.find((p) => p.id === line.partyMaterialId) ?? null,
    [pmAll, line.partyMaterialId],
  );
  const filtered = useMemo(() => {
    const q = line.materialSearch.trim().toLowerCase();
    if (!q) return pmAll;
    return pmAll.filter(
      (p) =>
        p.code.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.material ?? '').toLowerCase().includes(q),
    );
  }, [pmAll, line.materialSearch]);

  // Auto-clear search once selection is made
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    if (selectedId && line.materialSearch !== '') {
      onChange({ materialSearch: '' });
    }
  }, [selectedId, line.materialSearch, onChange]);

  const bg = idx % 2 === 0 ? 'var(--bg)' : 'var(--bg3)';

  return (
    <tr style={{ background: bg }}>
      <td
        className="td-ctr mono fw-700"
        style={{ padding: 6, fontSize: 11 }}
      >
        {idx + 1}
      </td>
      <td style={{ padding: 6 }}>
        <input
          type="text"
          className="innovic-input"
          list="dlPGrnJwLine"
          placeholder="Line"
          value={line.jwLineNoText}
          onChange={(e) => onChange({ jwLineNoText: e.target.value })}
          style={{ width: '100%', fontSize: 11 }}
        />
      </td>
      <td style={{ padding: 6, position: 'relative' }}>
        <input
          type="text"
          className="innovic-input"
          placeholder="🔍 Type material code or name…"
          value={
            selected
              ? `${selected.code} — ${selected.name}`
              : line.materialSearch
          }
          onChange={(e) => {
            onChange({ partyMaterialId: null, materialSearch: e.target.value });
          }}
          style={{ width: '100%', fontSize: 12, color: 'var(--purple)', fontWeight: 600 }}
        />
        {!selected && line.materialSearch.trim() && filtered.length > 0 ? (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 6,
              right: 6,
              border: '1px solid var(--border)',
              borderRadius: 4,
              background: 'var(--bg2)',
              marginTop: 2,
              maxHeight: 180,
              overflowY: 'auto',
              zIndex: 10,
            }}
          >
            {filtered.slice(0, 20).map((pm) => (
              <div
                key={pm.id}
                onClick={() => onChange({ partyMaterialId: pm.id, materialSearch: '' })}
                style={{
                  padding: '6px 10px',
                  cursor: 'pointer',
                  fontSize: 12,
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{pm.code}</span> —{' '}
                {pm.name}
                {pm.material ? (
                  <span style={{ color: 'var(--text3)' }}> · {pm.material}</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
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

