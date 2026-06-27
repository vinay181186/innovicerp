// JWSO Inward section (customer-supplied material) — routes to the EXISTING
// POST /party-grn (createPartyGrnInputSchema → party_grn + party_materials.stock_qty).
//
// Mirrors the proven NewPartyGrnModal flow (party-grn/routes/list.tsx): pick a
// JWSO (job work order) — REQUIRED per the confirmed contract — the client is
// shown read-only from that order; line materials are picked from Party Material
// Master only (partyMaterialId uuid). No backend change; the live Party GRN
// screen is untouched.

import type { CreatePartyGrnInput, CreatePartyGrnLineInput } from '@innovic/shared';
import { useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useJobWorkOrdersList } from '@/modules/job-work-orders/api';
import { usePartyMaterialsList } from '@/modules/party-materials/api';
import { useCreatePartyGrn } from '@/modules/party-grn/api';

const today = (): string => new Date().toISOString().slice(0, 10);

interface UiLine {
  partyMaterialId: string | null;
  receivedQty: string;
  remarks: string;
}

const blankLine = (): UiLine => ({ partyMaterialId: null, receivedQty: '', remarks: '' });

export function JwsoInwardSection(): React.JSX.Element {
  const navigate = useNavigate();
  const create = useCreatePartyGrn();

  const [date, setDate] = useState(today());
  const [jwSearch, setJwSearch] = useState('');
  const [jwId, setJwId] = useState<string | null>(null);
  const [dcNo, setDcNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<UiLine[]>([blankLine()]);
  const [err, setErr] = useState<string | null>(null);

  // JWSO picker — the list returns one row per line; dedupe to one per header.
  const jwQuery = useJobWorkOrdersList({
    search: jwSearch.trim() || undefined,
    status: 'open',
    limit: 50,
    offset: 0,
  });
  const jwHeaders = useMemo(() => {
    const seen = new Set<string>();
    return (jwQuery.data?.items ?? []).filter((j) =>
      seen.has(j.jwId) ? false : (seen.add(j.jwId), true),
    );
  }, [jwQuery.data]);
  const selectedJw = useMemo(() => jwHeaders.find((j) => j.jwId === jwId) ?? null, [jwHeaders, jwId]);

  // Party Material Master (small master — load once, picker filters client-side).
  const { data: pmData } = usePartyMaterialsList({ limit: 200, offset: 0 });
  const pmOptions = useMemo(
    () => (pmData?.items ?? []).map((p) => ({ id: p.id, code: p.code, name: p.name })),
    [pmData],
  );

  const setLine = (idx: number, patch: Partial<UiLine>): void =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const addLine = (): void => setLines((prev) => [...prev, blankLine()]);
  const removeLine = (idx: number): void => setLines((prev) => prev.filter((_, i) => i !== idx));

  const onSave = async (): Promise<void> => {
    setErr(null);
    if (!jwId) {
      setErr('Select a JWSO (job work order) first.');
      return;
    }
    const validLines: CreatePartyGrnLineInput[] = [];
    for (const [i, l] of lines.entries()) {
      if (!l.partyMaterialId) {
        setErr(`Line ${i + 1}: pick a material from Party Material Master. Not listed? Add it there first.`);
        return;
      }
      const q = Number(l.receivedQty);
      if (!Number.isFinite(q) || q <= 0) {
        setErr(`Line ${i + 1}: received qty must be ≥ 1.`);
        return;
      }
      const ln: CreatePartyGrnLineInput = { partyMaterialId: l.partyMaterialId, receivedQty: q };
      if (l.remarks.trim()) ln.remarks = l.remarks.trim();
      validLines.push(ln);
    }
    if (validLines.length === 0) {
      setErr('Add at least one line.');
      return;
    }
    const input: CreatePartyGrnInput = {
      grnDate: date,
      jobWorkOrderId: jwId,
      lines: validLines,
    };
    if (dcNo.trim()) input.dcNo = dcNo.trim();
    if (remarks.trim()) input.remarks = remarks.trim();
    try {
      await create.mutateAsync(input);
      await navigate({ to: '/party-grn' });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to record JWSO inward.');
    }
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          fontSize: 11,
          color: 'var(--purple)',
          fontFamily: 'var(--mono)',
          fontWeight: 700,
          marginBottom: 6,
        }}
      >
        ▸ JWSO INWARD (CUSTOMER-SUPPLIED MATERIAL)
      </div>

      <div className="form-grid">
        <div className="form-grp" style={{ gridColumn: 'span 2' }}>
          <label className="form-label">
            JWSO No. <span className="req">★</span>
          </label>
          <SearchableSelect
            id="grn-jwso-inward"
            value={jwId}
            onChange={setJwId}
            onSearch={setJwSearch}
            loading={jwQuery.isFetching}
            placeholder="🔍 Select JWSO — type number or customer…"
            options={jwHeaders.map((j) => ({ id: j.jwId, code: j.code, name: j.customerName ?? '' }))}
          />
        </div>
        <div className="form-grp">
          <label className="form-label">GRN Date</label>
          <input
            type="date"
            className="innovic-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Client</label>
          <input
            className="innovic-input"
            value={selectedJw?.customerName ?? ''}
            readOnly
            style={{ background: 'var(--bg4)', color: 'var(--text3)' }}
            placeholder="From selected JWSO"
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Client PO No.</label>
          <input
            className="innovic-input"
            value={selectedJw?.clientPoNo ?? ''}
            readOnly
            style={{ background: 'var(--bg4)', color: 'var(--text3)' }}
            placeholder="From selected JWSO"
          />
        </div>
        <div className="form-grp">
          <label className="form-label">DC / Challan No.</label>
          <input
            className="innovic-input"
            value={dcNo}
            onChange={(e) => setDcNo(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="form-grp">
          <label className="form-label">Remarks</label>
          <input
            className="innovic-input"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ fontSize: 11, color: 'var(--purple)', fontWeight: 700 }}>▸ PARTY MATERIAL LINES</div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={addLine}>
          + Add Line
        </button>
      </div>

      <div className="tbl-wrap" style={{ marginTop: 6 }}>
        <table className="innovic-table">
          <thead>
            <tr>
              <th>#</th>
              <th style={{ minWidth: 240 }}>
                Material (Party Material Master) <span className="req">★</span>
              </th>
              <th className="td-ctr" style={{ width: 110 }}>
                Received Qty <span className="req">★</span>
              </th>
              <th>Remarks</th>
              <th style={{ width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-state">
                  No lines — click <strong>+ Add Line</strong>.
                </td>
              </tr>
            ) : (
              lines.map((l, idx) => (
                <tr key={idx}>
                  <td>{idx + 1}</td>
                  <td>
                    <SearchableSelect
                      id={`grn-jwso-mat-${idx}`}
                      value={l.partyMaterialId}
                      onChange={(id) => setLine(idx, { partyMaterialId: id })}
                      onSearch={() => {}}
                      options={pmOptions}
                      placeholder="🔍 Pick material…"
                    />
                  </td>
                  <td className="td-ctr">
                    <input
                      className="innovic-input"
                      style={{ width: 90, textAlign: 'right' }}
                      type="number"
                      min={1}
                      value={l.receivedQty}
                      onChange={(e) => setLine(idx, { receivedQty: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="innovic-input"
                      value={l.remarks}
                      onChange={(e) => setLine(idx, { remarks: e.target.value })}
                      placeholder="Optional"
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => removeLine(idx)}
                      title="Remove line"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="text3" style={{ fontSize: 10, marginTop: 4 }}>
        📌 Materials must exist in Party Material Master. Client is taken from the selected JWSO.
      </div>

      {err ? (
        <div className="form-error" style={{ marginTop: 8 }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={create.isPending}
          onClick={() => void onSave()}
        >
          {create.isPending ? <Loader2 className="inline h-3 w-3 animate-spin" /> : null} Save JWSO Inward
        </button>
      </div>
    </div>
  );
}
