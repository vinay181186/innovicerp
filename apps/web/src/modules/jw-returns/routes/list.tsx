// JW Return Challan — returns machined goods to the customer against a Job Work
// Order line (ADR-079). Guard is server-side: qty <= produced − already returned.

import { type CreateJwReturnChallanInput } from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useJobWorkOrder, useJobWorkOrdersList } from '../../job-work-orders/api';
import { useCreateJwReturnChallan, useJwReturnsList } from '../api';

export const jwReturnsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'jw-returns',
  component: JwReturnsListPage,
});

function JwReturnsListPage(): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);

  const { data, isLoading, isError, error } = useJwReturnsList();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = data?.items ?? [];
    if (!q) return items;
    return items.filter((r) =>
      [r.code, r.jwCodeText, r.clientName, r.partName, r.transport, r.vehicleNo]
        .filter((v): v is string => Boolean(v))
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [data?.items, search]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">📦 JW Return Challan</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Search return no., JWSO, client, part…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 260, fontSize: 12 }}
          />
          {canWrite ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowModal(true)}
            >
              <Plus size={14} /> New Return
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
              {error instanceof Error ? error.message : 'Failed to load JW returns'}
            </div>
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Return No.</th>
                  <th>Date</th>
                  <th>JWSO</th>
                  <th>Client</th>
                  <th>Part</th>
                  <th className="td-ctr" style={{ color: 'var(--green)' }}>
                    Qty
                  </th>
                  <th>Transport</th>
                  <th>Vehicle</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty-state">
                      No JW returns — click + New Return
                    </td>
                  </tr>
                ) : null}
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="td-code" style={{ color: 'var(--cyan)' }}>
                        {r.code}
                      </span>
                    </td>
                    <td className="text2" style={{ fontSize: 11 }}>
                      {r.returnDate}
                    </td>
                    <td
                      className="mono fw-700"
                      style={{ fontSize: 11, color: 'var(--purple)' }}
                    >
                      {r.jwCodeText ?? '—'}
                    </td>
                    <td className="fw-700">{r.clientName ?? '—'}</td>
                    <td className="text2">{r.partName ?? '—'}</td>
                    <td
                      className="td-ctr mono fw-700"
                      style={{ fontSize: 14, color: 'var(--green)' }}
                    >
                      {r.qty}
                    </td>
                    <td className="text3" style={{ fontSize: 11 }}>
                      {r.transport ?? '—'}
                    </td>
                    <td className="mono text3" style={{ fontSize: 11 }}>
                      {r.vehicleNo ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text3" style={{ fontSize: 11, marginTop: 6, padding: '0 4px' }}>
        💡 JW Return Challan returns machined goods to the customer against a Job Work Order
        line. Return qty cannot exceed what has been produced (QC-accepted) minus already
        returned.
      </div>

      {showModal ? <NewJwReturnModal onClose={() => setShowModal(false)} /> : null}
    </div>
  );
}

// ─── New JW Return modal ────────────────────────────────────────────────────

function NewJwReturnModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [jwSearch, setJwSearch] = useState('');
  const [jwId, setJwId] = useState<string | null>(null);
  const [jobWorkOrderLineId, setJobWorkOrderLineId] = useState('');
  const [qty, setQty] = useState('');
  const [transport, setTransport] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const jwQuery = useJobWorkOrdersList({
    search: jwSearch.trim() || undefined,
    status: 'open',
    limit: 50,
    offset: 0,
  });
  const jwHeaders = jwQuery.data?.items ?? [];

  const jwDetailQ = useJobWorkOrder(jwId ?? undefined);
  const jwLines = jwDetailQ.data?.lines ?? [];

  const createMut = useCreateJwReturnChallan();

  const onSave = (): void => {
    setErr(null);
    if (!jwId) {
      setErr('Select a JWSO');
      return;
    }
    if (!jobWorkOrderLineId) {
      setErr('Select a JW line');
      return;
    }
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) {
      setErr('Qty must be ≥ 1');
      return;
    }
    const input: CreateJwReturnChallanInput = {
      returnDate,
      jobWorkOrderLineId,
      qty: q,
    };
    if (transport.trim()) input.transport = transport.trim();
    if (vehicleNo.trim()) input.vehicleNo = vehicleNo.trim();
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
          📦 New JW Return Challan
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Date">
            <input
              type="date"
              className="innovic-input"
              value={returnDate}
              onChange={(e) => setReturnDate(e.target.value)}
            />
          </Field>
          <div />

          <div style={{ gridColumn: 'span 2' }}>
            <Field label="JWSO No. ★">
              <SearchableSelect
                id="jwret-jwso"
                value={jwId}
                onChange={(id) => {
                  setJwId(id);
                  setJobWorkOrderLineId('');
                }}
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
            <Field label="JW Line ★">
              <select
                className="innovic-input"
                value={jobWorkOrderLineId}
                onChange={(e) => setJobWorkOrderLineId(e.target.value)}
                disabled={!jwId || jwDetailQ.isFetching}
                style={{ width: '100%' }}
              >
                <option value="">
                  {!jwId
                    ? 'Select a JWSO first'
                    : jwDetailQ.isFetching
                      ? 'Loading lines…'
                      : jwLines.length === 0
                        ? 'No lines'
                        : 'Select a line…'}
                </option>
                {jwLines.map((l) => (
                  <option key={l.id} value={l.id}>
                    L{l.lineNo} · {l.partName} · Qty {l.orderQty}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Qty ★">
            <input
              type="number"
              min={1}
              className="innovic-input"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="0"
              style={{
                fontWeight: 700,
                border: '2px solid var(--green)',
                borderRadius: 4,
              }}
            />
          </Field>
          <Field label="Transport">
            <input
              type="text"
              className="innovic-input"
              value={transport}
              onChange={(e) => setTransport(e.target.value)}
              placeholder="Transporter name"
            />
          </Field>

          <Field label="Vehicle No.">
            <input
              type="text"
              className="innovic-input"
              value={vehicleNo}
              onChange={(e) => setVehicleNo(e.target.value)}
              placeholder="Vehicle number"
            />
          </Field>
          <Field label="Remarks">
            <input
              type="text"
              className="innovic-input"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Notes"
            />
          </Field>
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
              'Save Return'
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
