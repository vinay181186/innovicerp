// JW Delivery Challan (Store slice 3) — outward + inward tabs.
// Mirrors legacy renderJWDC (HTML L24434) — single route, tab switcher.

import {
  type CreateJwDcInwardInput,
  type CreateJwDcInwardLineInput,
  type CreateJwDcOutwardInput,
  type CreateJwDcOutwardLineInput,
  type JwDcOutwardListItem,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { usePurchaseOrdersList } from '../../purchase-orders/api';
import {
  useCreateJwDcInward,
  useCreateJwDcOutward,
  useJwDcInwardList,
  useJwDcOutwardDetail,
  useJwDcOutwardList,
  useJwDcPoLines,
} from '../api';

const PAGE_SIZE = 50;
type TabKey = 'outward' | 'inward';

const searchSchema = z.object({
  tab: z.enum(['outward', 'inward']).optional(),
});

export const jwDcListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'jw-dc',
  validateSearch: (search) => searchSchema.parse(search),
  component: JwDcPage,
});

function JwDcPage(): React.JSX.Element {
  const search = jwDcListRoute.useSearch();
  const navigate = jwDcListRoute.useNavigate();
  const tab: TabKey = search.tab ?? 'outward';

  const setTab = (next: TabKey): void => {
    void navigate({ search: { tab: next === 'outward' ? undefined : next } });
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        <TabButton
          active={tab === 'outward'}
          color="var(--purple)"
          onClick={() => setTab('outward')}
        >
          📤 Outward (to Vendor)
        </TabButton>
        <TabButton
          active={tab === 'inward'}
          color="var(--green)"
          onClick={() => setTab('inward')}
        >
          📥 Inward (Return from Vendor)
        </TabButton>
      </div>

      {tab === 'outward' ? <OutwardView /> : <InwardView />}
    </div>
  );
}

function TabButton({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={onClick}
      style={{
        fontWeight: 700,
        background: active ? color : 'var(--bg4)',
        color: active ? '#fff' : 'var(--text2)',
        border: `1px solid ${active ? color : 'var(--border)'}`,
      }}
    >
      {children}
    </button>
  );
}

// ─── Outward view ─────────────────────────────────────────────────────────

function OutwardView(): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useJwDcOutwardList({
    search: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">📤 Outward Register (Returnable Gate Pass)</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Search DC, JWPO, vendor…"
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
              <Plus size={14} /> New Outward DC
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
              {error instanceof Error ? error.message : 'Failed to load outward DCs'}
            </div>
          </div>
        ) : data && data.items.length === 0 ? (
          <div className="panel-body">
            <div className="empty-state">
              <div className="empty-icon">📤</div>
              No outward DCs. Click <strong>+ New Outward DC</strong>.
            </div>
          </div>
        ) : data ? (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>DC No.</th>
                  <th>Date</th>
                  <th>JWPO</th>
                  <th>Vendor</th>
                  <th className="td-ctr">Items</th>
                  <th className="td-ctr" style={{ color: 'var(--purple)' }}>
                    Sent
                  </th>
                  <th className="td-ctr" style={{ color: 'var(--green)' }}>
                    Returned
                  </th>
                  <th className="td-ctr" style={{ color: 'var(--red)' }}>
                    Pending
                  </th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((dc) => (
                  <OutwardRow key={dc.id} dc={dc} onView={(id) => setViewId(id)} />
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
              ? 'No DCs'
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
        💡 Material returns are tracked in 📥 Inward tab. ⚠ RETURNABLE — material comes back after
        processing.
      </div>

      {showModal ? <NewOutwardModal onClose={() => setShowModal(false)} /> : null}
      {viewId ? (
        <ViewOutwardModal id={viewId} onClose={() => setViewId(null)} />
      ) : null}
    </div>
  );
}

function OutwardRow({
  dc,
  onView,
}: {
  dc: JwDcOutwardListItem;
  onView: (id: string) => void;
}): React.JSX.Element {
  const stColor =
    dc.returnStatus === 'fully_returned'
      ? 'var(--green)'
      : dc.returnStatus === 'partial'
        ? 'var(--cyan)'
        : 'var(--red)';
  const stLabel =
    dc.returnStatus === 'fully_returned'
      ? 'Fully Returned'
      : dc.returnStatus === 'partial'
        ? 'Partial'
        : 'Out';

  return (
    <tr>
      <td>
        <span
          className="mono fw-700"
          style={{ color: 'var(--purple)', cursor: 'pointer' }}
          onClick={() => onView(dc.id)}
        >
          {dc.code}
        </span>
      </td>
      <td className="text2" style={{ fontSize: 11 }}>
        {dc.dcDate}
      </td>
      <td className="mono" style={{ fontSize: 11, color: 'var(--cyan)' }}>
        {dc.jwpoCodeText ?? '—'}
      </td>
      <td className="fw-700">{dc.vendorNameText ?? dc.vendorCodeText ?? '—'}</td>
      <td className="td-ctr">{dc.linesCount}</td>
      <td
        className="td-ctr mono fw-700"
        style={{ color: 'var(--purple)' }}
      >
        {dc.totalSentQty}
      </td>
      <td className="td-ctr mono" style={{ color: 'var(--green)' }}>
        {dc.totalReturnedQty}
      </td>
      <td
        className="td-ctr mono fw-700"
        style={{ color: dc.pendingQty > 0 ? 'var(--red)' : 'var(--green)' }}
      >
        {dc.pendingQty}
      </td>
      <td>
        <span style={{ fontWeight: 700, color: stColor }}>{stLabel}</span>
      </td>
      <td>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => onView(dc.id)}
          style={{ fontSize: 10 }}
        >
          👁 View
        </button>
      </td>
    </tr>
  );
}

// ─── Inward view ──────────────────────────────────────────────────────────

function InwardView(): React.JSX.Element {
  const { data: me } = useSession();
  const canWrite = me?.role === 'admin' || me?.role === 'manager';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);

  const { data, isLoading, isError, error } = useJwDcInwardList({
    search: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">📥 Inward Register (JW DC Returns)</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Search…"
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
              <Plus size={14} /> New Inward Entry
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
              {error instanceof Error ? error.message : 'Failed to load inward entries'}
            </div>
          </div>
        ) : data && data.items.length === 0 ? (
          <div className="panel-body">
            <div className="empty-state">
              <div className="empty-icon">📥</div>
              No inward entries. Click <strong>+ New Inward Entry</strong> when material returns
              from vendor.
            </div>
          </div>
        ) : data ? (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Inward No.</th>
                  <th>Date</th>
                  <th>DC No.</th>
                  <th>Vendor</th>
                  <th>Vendor Challan</th>
                  <th className="td-ctr">Received</th>
                  <th className="td-ctr" style={{ color: 'var(--green)' }}>
                    OK
                  </th>
                  <th className="td-ctr" style={{ color: 'var(--red)' }}>
                    Rejected
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((inv) => (
                  <tr key={inv.id}>
                    <td className="mono fw-700" style={{ color: 'var(--green)' }}>
                      {inv.code}
                    </td>
                    <td className="text2" style={{ fontSize: 11 }}>
                      {inv.inwardDate}
                    </td>
                    <td
                      className="mono"
                      style={{ color: 'var(--purple)', fontSize: 11 }}
                    >
                      {inv.dcCodeText ?? '—'}
                    </td>
                    <td className="fw-700">{inv.vendorNameText ?? '—'}</td>
                    <td style={{ fontSize: 11 }}>{inv.vendorChallanNo ?? '—'}</td>
                    <td className="td-ctr mono fw-700">{inv.totalReceivedQty}</td>
                    <td className="td-ctr mono" style={{ color: 'var(--green)' }}>
                      {inv.totalOkQty}
                    </td>
                    <td className="td-ctr mono" style={{ color: 'var(--red)' }}>
                      {inv.totalRejectedQty > 0 ? inv.totalRejectedQty : '—'}
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
              ? 'No inward entries'
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

      {showModal ? <NewInwardModal onClose={() => setShowModal(false)} /> : null}
    </div>
  );
}

// ─── New Outward modal ────────────────────────────────────────────────────

interface OutwardLineUi {
  purchaseOrderLineId: string;
  itemCode: string;
  itemName: string;
  processText: string | null;
  poQty: number;
  alreadySent: number;
  available: number;
  sendQty: number;
  checked: boolean;
}

function NewOutwardModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [poId, setPoId] = useState<string | null>(null);
  const [poSearch, setPoSearch] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<OutwardLineUi[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const { data: poData } = usePurchaseOrdersList({
    poType: 'job_work',
    search: poSearch.trim() || undefined,
    limit: 50,
    offset: 0,
  });
  const selectedPo = useMemo(
    () => poData?.items.find((p) => p.id === poId) ?? null,
    [poData, poId],
  );

  const { data: poLines } = useJwDcPoLines(poId ?? undefined);
  // Sync lines from server response once
  useMemo(() => {
    if (poLines) {
      setLines(
        poLines.lines.map((l) => ({
          purchaseOrderLineId: l.purchaseOrderLineId,
          itemCode: l.itemCode,
          itemName: l.itemName,
          processText: l.processText,
          poQty: l.poQty,
          alreadySent: l.alreadySent,
          available: l.available,
          sendQty: l.available,
          checked: l.available > 0,
        })),
      );
    } else {
      setLines([]);
    }
  }, [poLines]);

  const createMut = useCreateJwDcOutward();

  const onSave = (): void => {
    setErr(null);
    if (!poId) {
      setErr('Select a JWPO');
      return;
    }
    const valid: CreateJwDcOutwardLineInput[] = lines
      .filter((l) => l.checked && l.sendQty > 0)
      .map((l) => ({ purchaseOrderLineId: l.purchaseOrderLineId, sentQty: l.sendQty }));
    if (valid.length === 0) {
      setErr('Check at least one line and enter qty to send');
      return;
    }
    const input: CreateJwDcOutwardInput = {
      dcDate: date,
      purchaseOrderId: poId,
      lines: valid,
    };
    if (vehicleNo.trim()) input.vehicleNo = vehicleNo.trim();
    if (remarks.trim()) input.remarks = remarks.trim();

    createMut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) => setErr(e instanceof Error ? e.message : 'Failed to create'),
    });
  };

  const setLine = (i: number, patch: Partial<OutwardLineUi>): void => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };

  return (
    <ModalShell onClose={onClose} title="📤 New Outward DC (Returnable Gate Pass)">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Date">
          <input
            type="date"
            className="innovic-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <div></div>
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="JWPO ★ (type to search)">
            <input
              type="text"
              className="innovic-input"
              placeholder="🔍 Type JWPO number…"
              value={
                selectedPo
                  ? `${selectedPo.code} — ${selectedPo.vendorName ?? selectedPo.vendorCodeText ?? ''}`
                  : poSearch
              }
              onChange={(e) => {
                setPoId(null);
                setPoSearch(e.target.value);
              }}
            />
            {!poId && poSearch && poData ? (
              <Picklist
                items={poData.items.slice(0, 20).map((p) => ({
                  id: p.id,
                  label: `${p.code} — ${p.vendorName ?? p.vendorCodeText ?? ''}`,
                  sub: null,
                }))}
                onPick={(id) => {
                  setPoId(id);
                  setPoSearch('');
                }}
              />
            ) : null}
          </Field>
        </div>
        <Field label="Vehicle No.">
          <input
            type="text"
            className="innovic-input"
            value={vehicleNo}
            onChange={(e) => setVehicleNo(e.target.value)}
            placeholder="GJ-05-XX-1234"
          />
        </Field>
        <Field label="Remarks">
          <input
            type="text"
            className="innovic-input"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Packing, handling notes…"
          />
        </Field>
      </div>

      {selectedPo ? (
        <div
          style={{
            marginTop: 14,
            padding: '8px 12px',
            background: 'var(--bg3)',
            borderRadius: 6,
            border: '1px solid var(--border)',
            fontSize: 12,
          }}
        >
          <b>Vendor:</b> {selectedPo.vendorName ?? selectedPo.vendorCodeText ?? '—'} |{' '}
          <b>PO:</b> {selectedPo.code} | <b>Lines:</b> {lines.length}
        </div>
      ) : null}

      {lines.length > 0 ? (
        <div
          style={{
            marginTop: 14,
            border: '1px solid var(--border)',
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              background: 'var(--bg4)',
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            PO Lines — Select items to send
          </div>
          <table style={{ width: '100%' }}>
            <thead>
              <tr style={{ background: 'var(--bg4)' }}>
                <th style={{ width: 30, padding: 6 }}>☑</th>
                <th style={{ padding: 6 }}>Item</th>
                <th style={{ color: 'var(--purple)', padding: 6 }}>Process</th>
                <th style={{ padding: 6 }}>PO Qty</th>
                <th style={{ color: 'var(--amber)', padding: 6 }}>Already Sent</th>
                <th style={{ color: 'var(--green)', padding: 6 }}>Available</th>
                <th style={{ color: 'var(--cyan)', padding: 6 }}>Qty to Send</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const hasQty = l.available > 0;
                return (
                  <tr
                    key={l.purchaseOrderLineId}
                    style={{
                      background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg3)',
                      opacity: hasQty ? 1 : 0.4,
                    }}
                  >
                    <td className="td-ctr" style={{ padding: 6 }}>
                      <input
                        type="checkbox"
                        checked={hasQty && l.checked}
                        disabled={!hasQty}
                        onChange={(e) => setLine(i, { checked: e.target.checked })}
                        style={{ width: 16, height: 16 }}
                      />
                    </td>
                    <td style={{ padding: 6, fontSize: 12 }}>
                      <b>{l.itemCode}</b>{' '}
                      <span style={{ color: 'var(--text3)' }}>{l.itemName}</span>
                    </td>
                    <td
                      style={{ padding: 6, fontSize: 11, color: 'var(--purple)' }}
                    >
                      {l.processText ?? '—'}
                    </td>
                    <td className="td-ctr mono" style={{ padding: 6 }}>
                      {l.poQty}
                    </td>
                    <td
                      className="td-ctr mono"
                      style={{ padding: 6, color: 'var(--amber)' }}
                    >
                      {l.alreadySent > 0 ? l.alreadySent : '0'}
                    </td>
                    <td
                      className="td-ctr mono fw-700"
                      style={{
                        padding: 6,
                        color: l.available > 0 ? 'var(--green)' : 'var(--red)',
                      }}
                    >
                      {l.available}
                    </td>
                    <td style={{ padding: 6 }}>
                      <input
                        type="number"
                        min={0}
                        max={l.available}
                        value={l.sendQty}
                        disabled={!hasQty}
                        onChange={(e) =>
                          setLine(i, {
                            sendQty: Math.min(Number(e.target.value) || 0, l.available),
                          })
                        }
                        style={{
                          width: 70,
                          fontSize: 14,
                          fontWeight: 700,
                          textAlign: 'center',
                          color: 'var(--cyan)',
                          border: '2px solid var(--cyan)',
                          borderRadius: 4,
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {err ? <ErrorBox message={err} /> : null}

      <ModalActions
        onClose={onClose}
        onSave={onSave}
        saving={createMut.isPending}
        saveLabel="Save Outward DC"
      />
    </ModalShell>
  );
}

// ─── View Outward modal ───────────────────────────────────────────────────

function ViewOutwardModal({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}): React.JSX.Element {
  const { data, isLoading } = useJwDcOutwardDetail(id);

  return (
    <ModalShell
      onClose={onClose}
      title={`📤 Outward DC — ${data?.code ?? ''}`}
    >
      {isLoading || !data ? (
        <div className="text3" style={{ fontSize: 12 }}>
          <Loader2 size={14} className="inline animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <div
            style={{
              padding: 12,
              background: 'var(--bg3)',
              borderRadius: 6,
              marginBottom: 14,
              display: 'flex',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <span className="text3" style={{ fontSize: 10 }}>
                DC NO.
              </span>
              <br />
              <b style={{ color: 'var(--purple)' }}>{data.code}</b>
            </div>
            <div>
              <span className="text3" style={{ fontSize: 10 }}>
                DATE
              </span>
              <br />
              <b>{data.dcDate}</b>
            </div>
            <div>
              <span className="text3" style={{ fontSize: 10 }}>
                JWPO
              </span>
              <br />
              <b style={{ color: 'var(--cyan)' }}>{data.jwpoCodeText ?? '—'}</b>
            </div>
            <div>
              <span className="text3" style={{ fontSize: 10 }}>
                VENDOR
              </span>
              <br />
              <b>{data.vendorNameText ?? data.vendorCodeText ?? '—'}</b>
            </div>
            <div>
              <span className="text3" style={{ fontSize: 10 }}>
                TOTAL SENT
              </span>
              <br />
              <b style={{ color: 'var(--purple)' }}>{data.totalSentQty} pcs</b>
            </div>
            {data.vehicleNo ? (
              <div>
                <span className="text3" style={{ fontSize: 10 }}>
                  VEHICLE
                </span>
                <br />
                <b>{data.vehicleNo}</b>
              </div>
            ) : null}
          </div>

          <table style={{ width: '100%' }}>
            <thead>
              <tr style={{ background: 'var(--bg4)' }}>
                <th style={{ padding: 6 }}>#</th>
                <th style={{ padding: 6 }}>Item Code</th>
                <th style={{ padding: 6 }}>Item Name</th>
                <th style={{ padding: 6 }}>Process</th>
                <th style={{ padding: 6 }}>PO Qty</th>
                <th style={{ padding: 6, color: 'var(--cyan)' }}>Sent</th>
                <th style={{ padding: 6, color: 'var(--green)' }}>Returned</th>
                <th style={{ padding: 6, color: 'var(--amber)' }}>Pending</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l, i) => (
                <tr
                  key={l.id}
                  style={{ background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg3)' }}
                >
                  <td style={{ padding: 6 }}>{l.lineNo}</td>
                  <td style={{ padding: 6 }}>{l.itemCodeText}</td>
                  <td style={{ padding: 6 }}>{l.itemNameText ?? '—'}</td>
                  <td style={{ padding: 6, color: 'var(--purple)' }}>
                    {l.processText ?? '—'}
                  </td>
                  <td className="td-ctr mono" style={{ padding: 6 }}>
                    {l.poQty}
                  </td>
                  <td
                    className="td-ctr mono fw-700"
                    style={{ padding: 6, color: 'var(--cyan)' }}
                  >
                    {l.sentQty}
                  </td>
                  <td className="td-ctr mono" style={{ padding: 6, color: 'var(--green)' }}>
                    {l.alreadyReturned}
                  </td>
                  <td
                    className="td-ctr mono"
                    style={{
                      padding: 6,
                      color: l.pending > 0 ? 'var(--amber)' : 'var(--green)',
                    }}
                  >
                    {l.pending}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {data.remarks ? (
            <div className="text3" style={{ fontSize: 11, marginTop: 8 }}>
              Remarks: {data.remarks}
            </div>
          ) : null}
        </>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </ModalShell>
  );
}

// ─── New Inward modal ─────────────────────────────────────────────────────

interface InwardLineUi {
  outwardLineId: string;
  itemCode: string;
  itemName: string;
  processText: string | null;
  sentQty: number;
  alreadyReturned: number;
  pending: number;
  receivedQty: number;
  okQty: number;
  rejectedQty: number;
}

function NewInwardModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dcId, setDcId] = useState<string | null>(null);
  const [vendorChallan, setVendorChallan] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<InwardLineUi[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // Outward DCs with pending returns (filter client-side)
  const { data: outData } = useJwDcOutwardList({ limit: 200, offset: 0 });
  const pendingDcs = useMemo(
    () => (outData?.items ?? []).filter((d) => d.pendingQty > 0),
    [outData],
  );

  const { data: detail } = useJwDcOutwardDetail(dcId ?? undefined);
  useMemo(() => {
    if (detail) {
      setLines(
        detail.lines.map((l) => ({
          outwardLineId: l.id,
          itemCode: l.itemCodeText,
          itemName: l.itemNameText ?? '',
          processText: l.processText,
          sentQty: l.sentQty,
          alreadyReturned: l.alreadyReturned,
          pending: l.pending,
          receivedQty: l.pending,
          okQty: l.pending,
          rejectedQty: 0,
        })),
      );
    } else {
      setLines([]);
    }
  }, [detail]);

  const createMut = useCreateJwDcInward();

  const onSave = (): void => {
    setErr(null);
    if (!dcId) {
      setErr('Select a DC');
      return;
    }
    const valid: CreateJwDcInwardLineInput[] = [];
    for (const l of lines) {
      if (l.receivedQty <= 0) continue;
      if (l.okQty + l.rejectedQty !== l.receivedQty) {
        setErr(`Line ${l.itemCode}: OK + Rejected must equal Received`);
        return;
      }
      valid.push({
        jwDcOutwardLineId: l.outwardLineId,
        receivedQty: l.receivedQty,
        okQty: l.okQty,
        rejectedQty: l.rejectedQty,
      });
    }
    if (valid.length === 0) {
      setErr('Enter received qty for at least one line');
      return;
    }
    const input: CreateJwDcInwardInput = {
      inwardDate: date,
      jwDcOutwardId: dcId,
      lines: valid,
    };
    if (vendorChallan.trim()) input.vendorChallanNo = vendorChallan.trim();
    if (vehicleNo.trim()) input.vehicleNo = vehicleNo.trim();
    if (remarks.trim()) input.remarks = remarks.trim();

    createMut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) => setErr(e instanceof Error ? e.message : 'Failed to create'),
    });
  };

  const setLine = (i: number, patch: Partial<InwardLineUi>): void => {
    setLines((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l;
        const next = { ...l, ...patch };
        // Re-clamp to pending bound
        next.receivedQty = Math.min(Math.max(0, next.receivedQty), l.pending);
        next.okQty = Math.min(Math.max(0, next.okQty), next.receivedQty);
        next.rejectedQty = Math.min(
          Math.max(0, next.rejectedQty),
          next.receivedQty - next.okQty,
        );
        return next;
      }),
    );
  };

  return (
    <ModalShell onClose={onClose} title="📥 New Inward Entry">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Date">
          <input
            type="date"
            className="innovic-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <div></div>
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="JW DC ★ (with pending returns)">
            <select
              className="innovic-select"
              value={dcId ?? ''}
              onChange={(e) => setDcId(e.target.value || null)}
            >
              <option value="">-- Select DC --</option>
              {pendingDcs.map((dc) => (
                <option key={dc.id} value={dc.id}>
                  {dc.code} — {dc.vendorNameText ?? dc.vendorCodeText ?? ''} ({dc.jwpoCodeText})
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Vendor Challan No.">
          <input
            type="text"
            className="innovic-input"
            value={vendorChallan}
            onChange={(e) => setVendorChallan(e.target.value)}
            placeholder="Vendor reference"
          />
        </Field>
        <Field label="Vehicle No.">
          <input
            type="text"
            className="innovic-input"
            value={vehicleNo}
            onChange={(e) => setVehicleNo(e.target.value)}
            placeholder="GJ-05-XX-5678"
          />
        </Field>
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Remarks">
            <input
              type="text"
              className="innovic-input"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Condition notes, issues…"
            />
          </Field>
        </div>
      </div>

      {lines.length > 0 ? (
        <div
          style={{
            marginTop: 14,
            border: '1px solid var(--border)',
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              background: 'var(--bg4)',
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            DC Lines — Enter received quantities
          </div>
          <table style={{ width: '100%' }}>
            <thead>
              <tr style={{ background: 'var(--bg4)' }}>
                <th style={{ padding: 6 }}>Item</th>
                <th style={{ padding: 6, color: 'var(--purple)' }}>Process</th>
                <th style={{ padding: 6 }}>Sent</th>
                <th style={{ padding: 6, color: 'var(--green)' }}>Already Returned</th>
                <th style={{ padding: 6, color: 'var(--amber)' }}>Pending</th>
                <th style={{ padding: 6 }}>Received</th>
                <th style={{ padding: 6, color: 'var(--green)' }}>OK</th>
                <th style={{ padding: 6, color: 'var(--red)' }}>Rejected</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const hasPending = l.pending > 0;
                return (
                  <tr
                    key={l.outwardLineId}
                    style={{
                      background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg3)',
                      opacity: hasPending ? 1 : 0.4,
                    }}
                  >
                    <td style={{ padding: 6, fontSize: 12 }}>
                      <b>{l.itemCode}</b>{' '}
                      <span style={{ color: 'var(--text3)' }}>{l.itemName}</span>
                    </td>
                    <td
                      style={{ padding: 6, fontSize: 11, color: 'var(--purple)' }}
                    >
                      {l.processText ?? '—'}
                    </td>
                    <td className="td-ctr mono" style={{ padding: 6 }}>
                      {l.sentQty}
                    </td>
                    <td
                      className="td-ctr mono"
                      style={{ padding: 6, color: 'var(--green)' }}
                    >
                      {l.alreadyReturned > 0 ? l.alreadyReturned : '0'}
                    </td>
                    <td
                      className="td-ctr mono fw-700"
                      style={{
                        padding: 6,
                        color: l.pending > 0 ? 'var(--amber)' : 'var(--green)',
                      }}
                    >
                      {l.pending}
                    </td>
                    <td style={{ padding: 6 }}>
                      <input
                        type="number"
                        min={0}
                        max={l.pending}
                        value={l.receivedQty}
                        disabled={!hasPending}
                        onChange={(e) => {
                          const r = Math.min(Number(e.target.value) || 0, l.pending);
                          setLine(i, { receivedQty: r, okQty: r, rejectedQty: 0 });
                        }}
                        style={{
                          width: 65,
                          fontSize: 13,
                          fontWeight: 700,
                          textAlign: 'center',
                        }}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <input
                        type="number"
                        min={0}
                        max={l.receivedQty}
                        value={l.okQty}
                        disabled={!hasPending}
                        onChange={(e) => {
                          const v = Math.min(Number(e.target.value) || 0, l.receivedQty);
                          setLine(i, { okQty: v, rejectedQty: l.receivedQty - v });
                        }}
                        style={{
                          width: 65,
                          fontSize: 13,
                          fontWeight: 700,
                          textAlign: 'center',
                          color: 'var(--green)',
                        }}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <input
                        type="number"
                        min={0}
                        max={l.receivedQty}
                        value={l.rejectedQty}
                        disabled={!hasPending}
                        onChange={(e) => {
                          const v = Math.min(Number(e.target.value) || 0, l.receivedQty);
                          setLine(i, { rejectedQty: v, okQty: l.receivedQty - v });
                        }}
                        style={{
                          width: 65,
                          fontSize: 13,
                          fontWeight: 700,
                          textAlign: 'center',
                          color: 'var(--red)',
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {err ? <ErrorBox message={err} /> : null}

      <ModalActions
        onClose={onClose}
        onSave={onSave}
        saving={createMut.isPending}
        saveLabel="Save Inward"
      />
    </ModalShell>
  );
}

// ─── Shared bits ──────────────────────────────────────────────────────────

function ModalShell({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
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
          width: 'min(1100px, 95vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({
  onClose,
  onSave,
  saving,
  saveLabel,
}: {
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  saveLabel: string;
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
      <button type="button" className="btn btn-primary" disabled={saving} onClick={onSave}>
        {saving ? (
          <>
            <Loader2 size={14} className="inline animate-spin" /> Saving…
          </>
        ) : (
          saveLabel
        )}
      </button>
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

function Picklist({
  items,
  onPick,
}: {
  items: Array<{ id: string; label: string; sub: string | null }>;
  onPick: (id: string) => void;
}): React.JSX.Element {
  return (
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
      {items.map((it) => (
        <div
          key={it.id}
          onClick={() => onPick(it.id)}
          style={{
            padding: '6px 10px',
            cursor: 'pointer',
            fontSize: 12,
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{it.label}</span>
          {it.sub ? (
            <span style={{ color: 'var(--text3)', marginLeft: 6 }}>· {it.sub}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ErrorBox({ message }: { message: string }): React.JSX.Element {
  return (
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
      {message}
    </div>
  );
}
